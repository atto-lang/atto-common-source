// HOST-ONLY abstract control-plane model: NOT compiled Oreslang, NOT actor/GPU execution.
// Run: node --test tests/model-actor-state-versioning-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Only `state` carries simulated guest-owned persistent data. The admission bit is
// test-harness infrastructure, corresponding to a sealed runtime gate.
class VersionedStage {
  constructor({edges = ["left", "right"], capacity = 2, byteBudget = 64,
    maxPins = 64, maxReceipts = 1024} = {}) {
    if (!Array.isArray(edges) || !edges.length ||
        edges.some(e => typeof e !== "string" || !e.length) ||
        new Set(edges).size !== edges.length ||
        [capacity, byteBudget, maxPins, maxReceipts].some(n => !Number.isSafeInteger(n) || n < 1))
      throw Error("ML_INVALID_STAGE_LIMITS");
    this.state = {
      run: "run-A", epoch: 4, graph: 7, step: 1, activeVersion: 1,
      versions: new Map([[1, {value: 5, pins: 0, frozen: true}]]),
      contexts: new Map(), pins: new Map(), usedBytes: 0,
      edges: new Set(edges), capacity, byteBudget, maxPins, maxReceipts,
      admissionRevision: 0,
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
  totalPins(s) { return [...s.versions.values()].reduce((n, v) => n + v.pins, 0); }
  retireOld(s) {
    for (const [version, storage] of s.versions)
      if (version !== s.activeVersion && storage.pins === 0) s.versions.delete(version);
  }
  currentKey(microbatch) {
    return this.critical(s => Object.freeze({
      run: s.run, epoch: s.epoch, graph: s.graph,
      step: s.step, version: s.activeVersion, microbatch
    }));
  }
  snapshot() {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (this.totalPins(s) >= s.maxPins) this.error("ML_PIN_QUOTA_EXHAUSTED");
      const version = s.activeVersion;
      const storage = s.versions.get(version);
      const token = Symbol("immutable-weight-pin");
      // Host scalar only: production requires an authenticated, immutable buffer lease.
      const lease = Object.freeze({token, value: storage.value, version,
        run: s.run, epoch: s.epoch, graph: s.graph});
      storage.pins += 1;
      s.pins.set(token, {version, lease});
      return lease;
    });
  }
  release(lease) {
    return this.critical(s => {
      const record = lease && s.pins.get(lease.token);
      if (!record || record.lease !== lease) this.error("ML_UNKNOWN_OR_EXPIRED_LEASE");
      const storage = s.versions.get(record.version);
      if (!storage || storage.pins < 1) this.error("ML_PIN_LEDGER_CORRUPT");
      s.pins.delete(lease.token);
      storage.pins -= 1;
      this.retireOld(s);
    });
  }
  forward(key, bytes = 8) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, key);
      if (s.committed.has(key.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (s.prepared) this.error("ML_STEP_PREPARING");
      if (!Number.isSafeInteger(key.microbatch) || key.microbatch < 0)
        this.error("ML_INVALID_MICROBATCH");
      if (s.contexts.has(key.microbatch)) this.error("ML_DUPLICATE_MICROBATCH");
      if (!Number.isSafeInteger(bytes) || bytes <= 0) this.error("ML_BAD_TENSOR_BYTES");
      if (s.contexts.size >= s.capacity || bytes > s.byteBudget - s.usedBytes)
        this.error("ML_BACKPRESSURE");
      if (this.totalPins(s) >= s.maxPins) this.error("ML_PIN_QUOTA_EXHAUSTED");
      const admission = Symbol("issued-forward-activation");
      const ticket = Object.freeze({...key, bytes, admission});
      s.versions.get(key.version).pins += 1;
      s.usedBytes += bytes;
      s.contexts.set(key.microbatch, {
        key: Object.freeze({...key}), ticket, bytes, received: new Set(), finished: false
      });
      s.admissionRevision += 1;
      return ticket;
    });
  }
  backward(ticket, edge) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, ticket);
      const context = s.contexts.get(ticket.microbatch);
      if (!context) this.error("ML_UNKNOWN_ACTIVATION");
      if (context.ticket !== ticket) this.error("ML_ACTIVATION_LEASE_MISMATCH");
      if (s.prepared) this.error("ML_STEP_PREPARING");
      if (!s.edges.has(edge)) this.error("ML_UNKNOWN_EDGE");
      if (context.received.has(edge)) this.error("ML_DUPLICATE_GRADIENT");
      context.received.add(edge);
      context.finished = context.received.size === s.edges.size;
      s.admissionRevision += 1;
      return context.finished;
    });
  }
  abortForward(ticket) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (s.prepared) this.error("ML_STEP_PREPARING");
      this.checkIdentity(s, ticket);
      const ctx = s.contexts.get(ticket.microbatch);
      if (!ctx || ctx.ticket !== ticket) this.error("ML_UNKNOWN_OR_STALE_ACTIVATION");
      if (ctx.received.size) this.error("ML_FORWARD_ALREADY_BACKPROPAGATING");
      const storage = s.versions.get(ctx.key.version);
      if (!storage || storage.pins < 1 || ctx.bytes > s.usedBytes)
        this.error("ML_PIN_LEDGER_CORRUPT");
      s.contexts.delete(ticket.microbatch);
      s.usedBytes -= ctx.bytes;
      storage.pins -= 1;
      s.admissionRevision += 1;
      this.retireOld(s);
      return true;
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
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      const token = Symbol("prepared-optimizer-candidate");
      s.prepared = {token, step, expectedVersion, run: s.run,
        epoch: s.epoch, graph: s.graph, revision: s.admissionRevision,
        weights: frozenCandidate};
      // Numerical candidate remains a caller-supplied oracle in this host model.
      return Object.freeze({token, step, expectedVersion,
        run: s.run, epoch: s.epoch, graph: s.graph});
    });
  }
  commit(receipt) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (receipt && s.committed.has(receipt.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (!receipt || !s.prepared || s.prepared.token !== receipt.token)
        this.error("ML_UNRECOGNIZED_PREPARE");
      if (receipt.step !== s.step || receipt.step !== s.prepared.step)
        this.error("ML_STEP_MISMATCH");
      if (receipt.expectedVersion !== s.activeVersion ||
          receipt.expectedVersion !== s.prepared.expectedVersion)
        this.error("ML_WEIGHT_VERSION_MISMATCH");
      if (receipt.run !== s.run || receipt.run !== s.prepared.run ||
          receipt.epoch !== s.epoch || receipt.epoch !== s.prepared.epoch ||
          receipt.graph !== s.graph || receipt.graph !== s.prepared.graph)
        this.error("ML_PREPARE_GENERATION_MISMATCH");
      if (s.admissionRevision !== s.prepared.revision)
        this.error("ML_PREPARE_INVALIDATED");
      if (!s.contexts.size || [...s.contexts.values()].some(c => !c.finished))
        this.error("ML_STEP_NOT_QUIESCENT");
      // Full preflight before any guest-visible publication.
      const nextVersion = s.activeVersion + 1, nextStep = s.step + 1;
      const nextIteration = s.optimizer.iteration + 1;
      if (![nextVersion, nextStep, nextIteration].every(Number.isSafeInteger))
        this.error("ML_VERSION_OVERFLOW");
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      if (s.versions.has(nextVersion)) this.error("ML_VERSION_COLLISION");
      const candidate = s.prepared.weights;
      if (!Object.isFrozen(candidate) || !Number.isFinite(candidate.value))
        this.error("ML_INVALID_PREPARED_WEIGHTS");
      const decrements = new Map();
      for (const ctx of s.contexts.values())
        decrements.set(ctx.key.version, (decrements.get(ctx.key.version) || 0) + 1);
      for (const [v, n] of decrements) {
        const storage = s.versions.get(v);
        if (!storage || storage.pins < n) this.error("ML_PIN_LEDGER_CORRUPT");
      }
      s.versions.set(nextVersion, {value: candidate.value, pins: 0, frozen: true});
      s.activeVersion = nextVersion;
      s.optimizer = Object.freeze({iteration: nextIteration});
      for (const [v, n] of decrements) s.versions.get(v).pins -= n;
      this.retireOld(s);
      s.contexts.clear();
      s.usedBytes = 0;
      s.prepared = null;
      s.committed.add(receipt.step);
      s.step = nextStep;
      return Object.freeze({step: receipt.step, version: nextVersion});
    });
  }
  cancel() {
    return this.critical(s => {
      if (s.cancelled) return false;
      if (s.committed.has(s.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      const decrements = new Map();
      for (const ctx of s.contexts.values())
        decrements.set(ctx.key.version, (decrements.get(ctx.key.version) || 0) + 1);
      for (const [v, n] of decrements) {
        const storage = s.versions.get(v);
        if (!storage || storage.pins < n) this.error("ML_PIN_LEDGER_CORRUPT");
      }
      for (const [v, n] of decrements) s.versions.get(v).pins -= n;
      this.retireOld(s);
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
  const tickets = new Map();
  for (const mb of microbatches) tickets.set(mb, stage.forward(stage.currentKey(mb)));
  for (const mb of [...microbatches].reverse()) {
    const ticket = tickets.get(mb);
    stage.backward(ticket, "right");
    stage.backward(ticket, "left");
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
  const t1 = a.forward(k1), t2 = a.forward(k2);
  assert.equal(a.backward(t2, "right"), false);
  assert.equal(a.backward(t1, "left"), false);
  assert.throws(() => a.prepare(1, 1, 4.9), /ML_STEP_NOT_QUIESCENT/);
  assert.equal(a.backward(t2, "left"), true);
  assert.equal(a.backward(t1, "right"), true);
  const r = a.prepare(1, 1, 4.9);
  assert.deepEqual(a.commit(r), {step: 1, version: 2});
  assert.deepEqual(a.status(), {version: 2, step: 2,
    optimizerIteration: 1, active: 0, bytes: 0, weightVersions: [2]});
});

test("duplicate edge, cross-epoch and stale-version gradients all fail closed", () => {
  const a = new VersionedStage();
  const key = a.currentKey(5);
  const ticket = a.forward(key);
  a.backward(ticket, "left");
  assert.throws(() => a.backward(ticket, "left"), /ML_DUPLICATE_GRADIENT/);
  assert.throws(() => a.backward({...ticket, epoch: 99}, "right"),
    /ML_ACTOR_INCARNATION_MISMATCH/);
  assert.throws(() => a.backward({...ticket, version: 2}, "right"),
    /ML_WEIGHT_VERSION_MISMATCH/);
  assert.throws(() => a.backward({...ticket, graph: 8}, "right"),
    /ML_GRAPH_GENERATION_MISMATCH/);
  assert.throws(() => a.backward({...ticket, run: "other"}, "right"),
    /ML_RUN_MISMATCH/);
  assert.throws(() => a.backward({...ticket, step: 5}, "right"),
    /ML_STEP_MISMATCH/);
  assert.throws(() => a.backward(ticket, "intruder"), /ML_UNKNOWN_EDGE/);
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
  const ticket = a.forward(k);
  a.backward(ticket, "left"); a.backward(ticket, "right");
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
  const ticket = a.forward(key);
  a.backward(ticket, "left"); a.backward(ticket, "right");
  const next = a.prepare(2, 2, 4.5);
  a.commit(next);
  assert.equal(a.status().version, 3);
  assert.equal(a.status().optimizerIteration, 2);
});

test("a backward gradient is bound to the issued forward ticket, not guessable IDs", () => {
  const a = new VersionedStage({edges: ["left"]});
  const t1 = a.forward(a.currentKey(1)), t2 = a.forward(a.currentKey(2));
  assert.throws(() => a.backward({...t1, microbatch: 2}, "left"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward({...t1}, "left"), /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward(a.currentKey(1), "left"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.equal(a.backward(t2, "left"), true);
  assert.equal(a.backward(t1, "left"), true);
  assert.deepEqual(a.commit(a.prepare(1, 1, 4)), {step: 1, version: 2});
});

test("optimizer prepare fences late forward, backward and abort admissions", () => {
  const a = new VersionedStage({edges: ["left"]});
  const t = a.forward(a.currentKey(1));
  a.backward(t, "left");
  const prepared = a.prepare(1, 1, 4);
  assert.throws(() => a.forward(a.currentKey(2)), /ML_STEP_PREPARING/);
  assert.throws(() => a.abortForward(t), /ML_STEP_PREPARING/);
  assert.throws(() => a.backward(t, "left"), /ML_STEP_PREPARING/);
  assert.throws(() => a.commit({...prepared, graph: 999}),
    /ML_PREPARE_GENERATION_MISMATCH/);
  assert.equal(a.status().version, 1);
  assert.deepEqual(a.commit(prepared), {step: 1, version: 2});
});

test("version pin and durable receipt quotas fail closed before mutation", () => {
  const a = new VersionedStage({maxPins: 2, maxReceipts: 1, edges: ["left"]});
  const first = a.snapshot();
  const ticket = a.forward(a.currentKey(1));
  assert.throws(() => a.snapshot(), /ML_PIN_QUOTA_EXHAUSTED/);
  assert.throws(() => a.forward(a.currentKey(2)), /ML_PIN_QUOTA_EXHAUSTED/);
  a.release(first);
  assert.equal(a.snapshot().version, 1);
  // The extra pin stays active through publication: its old version survives.
  a.backward(ticket, "left");
  a.commit(a.prepare(1, 1, 4));
  assert.deepEqual(a.status().weightVersions, [1, 2]);
  const next = a.forward(a.currentKey(2));
  a.backward(next, "left");
  assert.throws(() => a.prepare(2, 2, 3),
    /ML_RECEIPT_QUOTA_EXHAUSTED/);
  assert.equal(a.status().optimizerIteration, 1);
  assert.equal(a.status().version, 2);
});

test("failed forward can release activation quota and never replay its token", () => {
  const a = new VersionedStage({edges: ["left"], capacity: 1, byteBudget: 8});
  const old = a.forward(a.currentKey(1), 8);
  assert.throws(() => a.forward(a.currentKey(2)), /ML_BACKPRESSURE/);
  assert.equal(a.abortForward(old), true);
  assert.equal(a.status().bytes, 0);
  assert.throws(() => a.abortForward(old), /ML_UNKNOWN_OR_STALE_ACTIVATION/);
  const current = a.forward(a.currentKey(1), 8);
  assert.throws(() => a.backward(old, "left"), /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.abortForward({...current}), /ML_UNKNOWN_OR_STALE_ACTIVATION/);
  a.backward(current, "left");
  assert.throws(() => a.abortForward(current),
    /ML_FORWARD_ALREADY_BACKPROPAGATING/);
  a.commit(a.prepare(1, 1, 4));
});

test("frozen storage lease identity prevents cloned release or cross-stage use", () => {
  const a = new VersionedStage(), b = new VersionedStage();
  const lease = a.snapshot();
  assert.throws(() => a.release({...lease}), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
  assert.throws(() => b.release(lease), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
  assert.equal(a.totalPins(a.state), 1);
  a.release(lease);
  assert.equal(a.totalPins(a.state), 0);
  assert.throws(() => a.release(lease), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
});

test("preflight detects pin ledger corruption without partially publishing", () => {
  const a = new VersionedStage({edges: ["left"]});
  const ticket = a.forward(a.currentKey(1));
  a.backward(ticket, "left");
  const prepared = a.prepare(1, 1, 4);
  a.critical(s => { s.versions.get(1).pins = 0; }); // injected internal fault
  assert.throws(() => a.commit(prepared), /ML_PIN_LEDGER_CORRUPT/);
  assert.equal(a.status().version, 1);
  assert.equal(a.status().optimizerIteration, 0);
  a.critical(s => { s.versions.get(1).pins = 1; }); // repair injected fault
  assert.deepEqual(a.commit(prepared), {step: 1, version: 2});
});

test("cancel after prepare leaves external immutable snapshot releasable", () => {
  const a = new VersionedStage({edges: ["left"]});
  const old = a.snapshot(), ticket = a.forward(a.currentKey(1));
  a.backward(ticket, "left");
  const prepared = a.prepare(1, 1, 4);
  assert.equal(a.cancel(), true);
  assert.throws(() => a.commit(prepared), /ML_RUN_CANCELLED/);
  assert.equal(a.status().active, 0);
  assert.equal(a.totalPins(a.state), 1);
  a.release(old);
  assert.equal(a.totalPins(a.state), 0);
});

test("invalid resource limits and duplicate graph edges fail closed", () => {
  for (const config of [
    {capacity: 0}, {byteBudget: -1}, {maxPins: 0},
    {maxReceipts: 0}, {edges: []}, {edges: ["same", "same"]},
    {edges: [null]}, {capacity: 2.5}
  ]) assert.throws(() => new VersionedStage(config), /ML_INVALID_STAGE_LIMITS/);
});
