// HOST-ONLY abstract control-plane model: NOT compiled Oreslang, NOT actor/GPU execution.
// Run: node --test tests/model-actor-state-versioning-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Only `state` carries simulated guest-owned persistent data. The admission bit is
// test-harness infrastructure, corresponding to a sealed runtime gate.
class VersionedStage {
  constructor({edges = ["left", "right"], capacity = 2, byteBudget = 64} = {}) {
    this.state = {
      run: "run-A", epoch: 4, graph: 7, step: 1, activeVersion: 1,
      versions: new Map([[1, {value: 5, pins: 0, frozen: true}]]),
      contexts: new Map(), pins: new Map(), usedBytes: 0,
      edges: new Set(edges), capacity, byteBudget,
      optimizer: Object.freeze({iteration: 0}),
      prepared: null, committed: new Set(), cancelled: false
    };
    this._runtimeGateHeld = false; // PRIVATE HARNESS METADATA, not actor guest state
  }
  error(code) { throw new Error(code); }
  critical(cb) {
    if (this._runtimeGateHeld) this.error("ML_STATE_LOAN_REENTRANT");
    this._runtimeGateHeld = true;
    try {
      const result = cb(this.state);
      if (result && typeof result.then === "function") this.error("ML_STATE_LOAN_SUSPENDS");
      if (result === this.state) this.error("ML_STATE_LOAN_ESCAPE");
      return result;
    } finally { this._runtimeGateHeld = false; }
  }
  checkIdentity(s, key) {
    if (key.run !== s.run) this.error("ML_RUN_MISMATCH");
    if (key.epoch !== s.epoch) this.error("ML_ACTOR_INCARNATION_MISMATCH");
    if (key.graph !== s.graph) this.error("ML_GRAPH_GENERATION_MISMATCH");
    if (key.step !== s.step) this.error("ML_STEP_MISMATCH");
    if (key.version !== s.activeVersion) this.error("ML_WEIGHT_VERSION_MISMATCH");
  }
  currentKey(microbatch) {
    return this.critical(s => Object.freeze({
      run: s.run, epoch: s.epoch, graph: s.graph,
      step: s.step, version: s.activeVersion, microbatch
    }));
  }
  snapshot() {
    return this.critical(s => {
      const version = s.activeVersion;
      const storage = s.versions.get(version);
      const token = Symbol("immutable-weight-pin");
      storage.pins += 1;
      s.pins.set(token, version);
      // Copy scalar reference data for the simulator. Real code returns an
      // independent, immutable storage lease, not the mutable state record.
      return Object.freeze({token, value: storage.value, version, epoch: s.epoch});
    });
  }
  release(lease) {
    return this.critical(s => {
      const ver = s.pins.get(lease.token);
      if (ver === undefined) this.error("ML_UNKNOWN_OR_EXPIRED_LEASE");
      s.pins.delete(lease.token);
      const storage = s.versions.get(ver);
      storage.pins -= 1;
      if (storage.pins < 0) this.error("ML_NEGATIVE_PINS");
      if (storage.pins === 0 && ver !== s.activeVersion) s.versions.delete(ver);
    });
  }
  forward(key, bytes = 8) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, key);
      if (s.committed.has(key.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (s.contexts.has(key.microbatch)) this.error("ML_DUPLICATE_MICROBATCH");
      if (!Number.isSafeInteger(bytes) || bytes <= 0) this.error("ML_BAD_TENSOR_BYTES");
      if (s.contexts.size >= s.capacity || bytes > s.byteBudget - s.usedBytes)
        this.error("ML_BACKPRESSURE");
      const snapshot = s.versions.get(key.version);
      snapshot.pins += 1; // pinned until commit or cancellation
      s.usedBytes += bytes;
      s.contexts.set(key.microbatch, {
        key, bytes, received: new Set(), finished: false
      });
      return Object.freeze({ ...key, bytes }); // no state loan escapes
    });
  }
  backward(key, edge) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, key);
      const context = s.contexts.get(key.microbatch);
      if (!context) this.error("ML_UNKNOWN_ACTIVATION");
      if (!s.edges.has(edge)) this.error("ML_UNKNOWN_EDGE");
      if (context.received.has(edge)) this.error("ML_DUPLICATE_GRADIENT");
      context.received.add(edge);
      context.finished = context.received.size === s.edges.size;
      return context.finished;
    });
  }
  prepare(step, expectedVersion, candidateValue) {
    // Numeric candidate computation must run OUTSIDE critical. A real
    // optimizer uses gradients and checks finite tensors before entry.
    if (!Number.isFinite(candidateValue)) this.error("ML_NONFINITE_WEIGHTS");
    const frozenCandidate = Object.freeze({value: candidateValue, frozen: true});
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (s.committed.has(step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (step !== s.step) this.error("ML_STEP_MISMATCH");
      if (expectedVersion !== s.activeVersion) this.error("ML_WEIGHT_VERSION_MISMATCH");
      if (!s.contexts.size) this.error("ML_STEP_NO_GRADIENTS");
      if ([...s.contexts.values()].some(c => !c.finished))
        this.error("ML_STEP_NOT_QUIESCENT");
      if (s.prepared) this.error("ML_PREPARE_ALREADY_EXISTS");
      const token = Symbol("prepared-optimizer-candidate");
      s.prepared = {token, step, expectedVersion, weights: frozenCandidate};
      return Object.freeze({token, step, expectedVersion});
    });
  }
  commit(receipt) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (s.committed.has(receipt.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (!s.prepared || s.prepared.token !== receipt.token)
        this.error("ML_UNRECOGNIZED_PREPARE");
      if (receipt.step !== s.step) this.error("ML_STEP_MISMATCH");
      if (receipt.expectedVersion !== s.activeVersion)
        this.error("ML_WEIGHT_VERSION_MISMATCH");
      if (!s.contexts.size || [...s.contexts.values()].some(c => !c.finished))
        this.error("ML_STEP_NOT_QUIESCENT");
      const nextVersion = s.activeVersion + 1;
      if (!Number.isSafeInteger(nextVersion)) this.error("ML_VERSION_OVERFLOW");
      const candidate = s.prepared.weights;
      // Locally atomic publication: weights AND optimizer iteration.
      s.versions.set(nextVersion, {value: candidate.value, pins: 0, frozen: true});
      const previous = s.activeVersion;
      s.activeVersion = nextVersion;
      s.optimizer = Object.freeze({iteration: s.optimizer.iteration + 1});
      for (const ctx of s.contexts.values()) {
        const pinned = s.versions.get(ctx.key.version);
        pinned.pins -= 1;
        if (pinned.pins < 0) this.error("ML_NEGATIVE_PINS");
      }
      if (s.versions.get(previous).pins === 0) s.versions.delete(previous);
      s.contexts.clear();
      s.usedBytes = 0;
      s.prepared = null;
      s.committed.add(receipt.step);
      s.step += 1;
      return Object.freeze({step: receipt.step, version: nextVersion});
    });
  }
  cancel() {
    return this.critical(s => {
      if (s.cancelled) return false;
      if (s.committed.has(s.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      for (const ctx of s.contexts.values()) {
        const pinned = s.versions.get(ctx.key.version);
        pinned.pins -= 1;
        if (pinned.pins < 0) this.error("ML_NEGATIVE_PINS");
      }
      s.contexts.clear();
      s.usedBytes = 0;
      s.prepared = null;
      s.cancelled = true;
      return true;
    });
  }
  status() {
    return this.critical(s => Object.freeze({
      version: s.activeVersion, step: s.step, optimizerIteration: s.optimizer.iteration,
      active: s.contexts.size, bytes: s.usedBytes,
      weightVersions: [...s.versions.keys()].sort((a,b) => a-b)
    }));
  }
}

function completedStep(stage, microbatches = [1]) {
  for (const mb of microbatches) stage.forward(stage.currentKey(mb));
  for (const mb of [...microbatches].reverse()) {
    const key = stage.currentKey(mb);
    stage.backward(key, "right");
    stage.backward(key, "left");
  }
  const receipt = stage.prepare(1, 1, 4.75);
  return stage.commit(receipt);
}

test("all persistent model-stage data is rooted in a single state variable", () => {
  const a = new VersionedStage();
  assert.deepEqual(Object.keys(a).sort(), ["_runtimeGateHeld", "state"]);
  assert.equal(a.state.activeVersion, 1);
  assert.throws(() => a.critical(s => s), /ML_STATE_LOAN_ESCAPE/);
  assert.throws(() => a.critical(() => a.critical(() => 1)),
    /ML_STATE_LOAN_REENTRANT/);
  assert.throws(() => a.critical(() => Promise.resolve(1)),
    /ML_STATE_LOAN_SUSPENDS/);
});

test("two forward microbatches keep the same weight version through out-of-order fan-in", () => {
  const a = new VersionedStage();
  const k1 = a.currentKey(1), k2 = a.currentKey(2);
  a.forward(k1); a.forward(k2);
  assert.equal(a.backward(k2, "right"), false);
  assert.equal(a.backward(k1, "left"), false);
  assert.throws(() => a.prepare(1, 1, 4.9), /ML_STEP_NOT_QUIESCENT/);
  assert.equal(a.backward(k2, "left"), true);
  assert.equal(a.backward(k1, "right"), true);
  const r = a.prepare(1, 1, 4.9);
  assert.deepEqual(a.commit(r), {step: 1, version: 2});
  assert.deepEqual(a.status(), {version: 2, step: 2,
    optimizerIteration: 1, active: 0, bytes: 0, weightVersions: [2]});
});

test("duplicate edge, cross-epoch and stale-version gradients all fail closed", () => {
  const a = new VersionedStage();
  const key = a.currentKey(5);
  a.forward(key);
  a.backward(key, "left");
  assert.throws(() => a.backward(key, "left"), /ML_DUPLICATE_GRADIENT/);
  assert.throws(() => a.backward({...key, epoch: 99}, "right"),
    /ML_ACTOR_INCARNATION_MISMATCH/);
  assert.throws(() => a.backward({...key, version: 2}, "right"),
    /ML_WEIGHT_VERSION_MISMATCH/);
  assert.throws(() => a.backward({...key, graph: 8}, "right"),
    /ML_GRAPH_GENERATION_MISMATCH/);
  assert.throws(() => a.backward({...key, run: "other"}, "right"),
    /ML_RUN_MISMATCH/);
  assert.throws(() => a.backward({...key, step: 5}, "right"),
    /ML_STEP_MISMATCH/);
  assert.throws(() => a.backward(key, "intruder"), /ML_UNKNOWN_EDGE/);
});

test("atomic local commit changes weights and optimizer state once, not twice", () => {
  const a = new VersionedStage();
  const receipt = completedStep(a);
  assert.equal(receipt.version, 2);
  assert.throws(() => a.commit({ ...receipt, token: Symbol("fake") }),
    /ML_STEP_ALREADY_COMMITTED/);
  assert.equal(a.status().optimizerIteration, 1);
  assert.throws(() => a.forward(a.currentKey(1).step === 2 ?
      {...a.currentKey(1), version: 1} : a.currentKey(1)),
    /ML_WEIGHT_VERSION_MISMATCH/);
});

test("frozen snapshot remains unchanged across publication and retires only after release", () => {
  const a = new VersionedStage();
  const frozen = a.snapshot();
  assert(Object.isFrozen(frozen));
  assert.equal(frozen.value, 5);
  completedStep(a);
  assert.equal(frozen.value, 5);
  assert.deepEqual(a.status().weightVersions, [1, 2]);
  a.release(frozen);
  assert.deepEqual(a.status().weightVersions, [2]);
  assert.throws(() => a.release(frozen), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
});

test("bounded activation count and byte-budget backpressure are independent", () => {
  const a = new VersionedStage({capacity: 2, byteBudget: 10});
  a.forward(a.currentKey(1), 6);
  assert.throws(() => a.forward(a.currentKey(2), 5), /ML_BACKPRESSURE/);
  a.forward(a.currentKey(2), 4);
  assert.throws(() => a.forward(a.currentKey(3), 1), /ML_BACKPRESSURE/);
  assert.equal(a.status().bytes, 10);
  assert.throws(() => a.forward(a.currentKey(2), 1), /ML_DUPLICATE_MICROBATCH/);
});

test("prepare receipt cannot be forged, duplicated, or based on a stale version", () => {
  const a = new VersionedStage();
  const k = a.currentKey(1);
  a.forward(k);
  a.backward(k, "left"); a.backward(k, "right");
  assert.throws(() => a.prepare(1, 2, 3), /ML_WEIGHT_VERSION_MISMATCH/);
  assert.throws(() => a.prepare(1, 1, Infinity), /ML_NONFINITE_WEIGHTS/);
  const receipt = a.prepare(1, 1, 4);
  assert.throws(() => a.prepare(1, 1, 4), /ML_PREPARE_ALREADY_EXISTS/);
  assert.throws(() => a.commit({...receipt, token: Symbol("fake")}),
    /ML_UNRECOGNIZED_PREPARE/);
  a.commit(receipt);
  assert.equal(a.status().version, 2);
});

test("cancellation releases reservations once and rejects late gradient/commit", () => {
  const a = new VersionedStage();
  const key = a.currentKey(1);
  a.forward(key, 8);
  assert.equal(a.cancel(), true);
  assert.equal(a.cancel(), false);
  assert.equal(a.status().active, 0);
  assert.equal(a.status().bytes, 0);
  assert.throws(() => a.backward(key, "left"), /ML_RUN_CANCELLED/);
  assert.throws(() => a.prepare(1, 1, 4), /ML_RUN_CANCELLED/);
});

test("next step adopts new version and the prior step cannot commit again", () => {
  const a = new VersionedStage();
  completedStep(a);
  const key = a.currentKey(2);
  assert.equal(key.version, 2);
  assert.equal(key.step, 2);
  a.forward(key);
  a.backward(key, "left"); a.backward(key, "right");
  const next = a.prepare(2, 2, 4.5);
  a.commit(next);
  assert.equal(a.status().version, 3);
  assert.equal(a.status().optimizerIteration, 2);
});
