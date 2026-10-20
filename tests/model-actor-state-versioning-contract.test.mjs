// HOST-ONLY abstract control-plane model: NOT compiled Oreslang, NOT actor/GPU execution.
// Run: node --test tests/model-actor-state-versioning-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Only `state` carries simulated guest-owned persistent data. The admission bit is
// test-harness infrastructure, corresponding to a sealed runtime gate.
class VersionedStage {
  constructor({edges = ["left", "right"], capacity = 2, byteBudget = 64,
               expectedMicrobatches = 1, plannedMicrobatches = null, receiptLimit = 32} = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 ||
        !Number.isSafeInteger(byteBudget) || byteBudget < 1 ||
        !Number.isSafeInteger(receiptLimit) || receiptLimit < 1)
      this.error("ML_INVALID_RESOURCE_LIMIT");
    if (!Array.isArray(edges) || !edges.length || new Set(edges).size !== edges.length ||
        edges.some(e => typeof e !== "string" || !e.length))
      this.error("ML_INVALID_EDGE_MANIFEST");
    if (plannedMicrobatches !== null &&
        (!Array.isArray(plannedMicrobatches) || !plannedMicrobatches.length ||
         new Set(plannedMicrobatches).size !== plannedMicrobatches.length ||
         plannedMicrobatches.some(id => !Number.isSafeInteger(id) || id < 1)))
      this.error("ML_INVALID_MICROBATCH_MANIFEST");
    if (plannedMicrobatches !== null) expectedMicrobatches = plannedMicrobatches.length;
    if (!Number.isSafeInteger(expectedMicrobatches) || expectedMicrobatches < 1 ||
        expectedMicrobatches > capacity || expectedMicrobatches > byteBudget)
      this.error("ML_INVALID_MICROBATCH_MANIFEST");
    this.state = {
      run: "run-A", epoch: 4, graph: 7, step: 1, activeVersion: 1,
      versions: new Map([[1, {value: 5, pins: 0, frozen: true}]]),
      contexts: new Map(), pins: new Map(), usedBytes: 0,
      edges: new Set(edges), capacity, byteBudget,
      expectedMicrobatches, planned: plannedMicrobatches === null ? null : new Set(plannedMicrobatches),
      receiptLimit,
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
      // A HOST-ONLY defense-in-depth check. The compiler must reject all
      // escapes statically, including closures; runtime graph scans alone
      // cannot enforce lexical borrow lifetimes.
      const resident = new WeakSet();
      const scan = (v, visitor, seen = new WeakSet()) => {
        if (v === null || typeof v !== "object" || seen.has(v)) return false;
        seen.add(v);
        if (visitor(v)) return true;
        if (v instanceof Map) {
          for (const [k, value] of v) if (scan(k, visitor, seen) || scan(value, visitor, seen)) return true;
        } else if (v instanceof Set) {
          for (const value of v) if (scan(value, visitor, seen)) return true;
        }
        for (const prop of Reflect.ownKeys(v)) {
          if (scan(v[prop], visitor, seen)) return true;
        }
        return false;
      };
      scan(this.state, v => {resident.add(v); return false;});
      if (scan(result, v => resident.has(v))) this.error("ML_STATE_LOAN_ESCAPE");
      return result;
    } finally { this._runtimeGateHeld = false; }
  }
  checkIdentity(s, key) {
    if (!key || typeof key !== "object" ||
        !Number.isSafeInteger(key.microbatch) || key.microbatch < 1)
      this.error("ML_INVALID_EXECUTION_KEY");
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
      if (!storage || !Number.isSafeInteger(storage.pins) ||
          storage.pins === Number.MAX_SAFE_INTEGER) this.error("ML_PIN_OVERFLOW");
      // Copy scalar reference data for the simulator. Real code returns an
      // independent, immutable storage lease, not the mutable state record.
      const lease = Object.freeze({token, value: storage.value, version, epoch: s.epoch});
      storage.pins += 1;
      s.pins.set(token, {version, lease});
      return lease;
    });
  }
  release(lease) {
    return this.critical(s => {
      const pin = lease && s.pins.get(lease.token);
      if (!pin) this.error("ML_UNKNOWN_OR_EXPIRED_LEASE");
      if (pin.lease !== lease) this.error("ML_LEASE_MISMATCH");
      const storage = s.versions.get(pin.version);
      if (!storage || storage.pins < 1) this.error("ML_PIN_LEDGER_CORRUPT");
      s.pins.delete(lease.token);
      storage.pins -= 1;
      if (storage.pins === 0 && pin.version !== s.activeVersion)
        s.versions.delete(pin.version);
    });
  }
  forward(key, bytes = 8) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, key);
      if (s.committed.has(key.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (s.prepared) this.error("ML_STEP_PREPARED");
      if (s.planned && !s.planned.has(key.microbatch))
        this.error("ML_UNPLANNED_MICROBATCH");
      if (s.contexts.has(key.microbatch)) this.error("ML_DUPLICATE_MICROBATCH");
      if (!Number.isSafeInteger(bytes) || bytes <= 0) this.error("ML_BAD_TENSOR_BYTES");
      if (s.contexts.size >= s.capacity || bytes > s.byteBudget - s.usedBytes)
        this.error("ML_BACKPRESSURE");
      const snapshot = s.versions.get(key.version);
      if (!snapshot || !Number.isSafeInteger(snapshot.pins) ||
          snapshot.pins === Number.MAX_SAFE_INTEGER) this.error("ML_PIN_OVERFLOW");
      snapshot.pins += 1; // pinned until commit or cancellation
      s.usedBytes += bytes;
      // Own a verified COPY; never retain caller-owned mutable execution keys.
      s.contexts.set(key.microbatch, {
        key: Object.freeze({...key}), bytes, received: new Set(), finished: false
      });
      return Object.freeze({ ...key, bytes }); // no state loan escapes
    });
  }
  backward(key, edge) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, key);
      if (s.prepared) this.error("ML_STEP_PREPARED");
      const context = s.contexts.get(key.microbatch);
      if (!context) this.error("ML_UNKNOWN_ACTIVATION");
      if (["run","epoch","graph","step","version","microbatch"]
          .some(field => context.key[field] !== key[field]))
        this.error("ML_ACTIVATION_IDENTITY_MISMATCH");
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
      if (s.contexts.size !== s.expectedMicrobatches ||
          (s.planned && [...s.planned].some(id => !s.contexts.has(id))))
        this.error("ML_STEP_INCOMPLETE");
      if ([...s.contexts.values()].some(c => !c.finished))
        this.error("ML_STEP_NOT_QUIESCENT");
      if (s.prepared) this.error("ML_PREPARE_ALREADY_EXISTS");
      if (!Number.isSafeInteger(s.optimizer.iteration + 1) ||
          !Number.isSafeInteger(s.activeVersion + 1) ||
          !Number.isSafeInteger(s.step + 1))
        this.error("ML_COUNTER_OVERFLOW");
      const token = Symbol("prepared-optimizer-candidate");
      const receipt = Object.freeze({
        token, run: s.run, epoch: s.epoch, graph: s.graph, step, expectedVersion
      });
      s.prepared = {receipt, weights: frozenCandidate};
      return receipt;
    });
  }
  commit(receipt) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (!receipt || typeof receipt !== "object")
        this.error("ML_UNRECOGNIZED_PREPARE");
      if (s.committed.has(receipt.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      // An immutable, stage-minted receipt is an opaque capability. Copying
      // the token into another object is NOT a valid publication authority.
      if (!s.prepared || s.prepared.receipt !== receipt)
        this.error("ML_UNRECOGNIZED_PREPARE");
      if (receipt.step !== s.step) this.error("ML_STEP_MISMATCH");
      if (receipt.expectedVersion !== s.activeVersion)
        this.error("ML_WEIGHT_VERSION_MISMATCH");
      if (s.contexts.size !== s.expectedMicrobatches ||
          !s.contexts.size || [...s.contexts.values()].some(c => !c.finished))
        this.error("ML_STEP_NOT_QUIESCENT");
      const nextVersion = s.activeVersion + 1;
      const nextStep = s.step + 1;
      const nextIteration = s.optimizer.iteration + 1;
      if (![nextVersion, nextStep, nextIteration].every(Number.isSafeInteger))
        this.error("ML_COUNTER_OVERFLOW");
      if (s.versions.has(nextVersion)) this.error("ML_VERSION_COLLISION");
      const pinReleases = new Map();
      for (const ctx of s.contexts.values())
        pinReleases.set(ctx.key.version, (pinReleases.get(ctx.key.version) || 0) + 1);
      for (const [version, count] of pinReleases) {
        const record = s.versions.get(version);
        if (!record || record.pins < count) this.error("ML_PIN_LEDGER_CORRUPT");
      }
      const candidate = s.prepared.weights;
      // Locally atomic publication: weights AND optimizer iteration.
      s.versions.set(nextVersion, {value: candidate.value, pins: 0, frozen: true});
      const previous = s.activeVersion;
      s.activeVersion = nextVersion;
      s.optimizer = Object.freeze({iteration: nextIteration});
      for (const [version, count] of pinReleases)
        s.versions.get(version).pins -= count;
      if (s.versions.get(previous).pins === 0) s.versions.delete(previous);
      s.contexts.clear();
      s.usedBytes = 0;
      s.prepared = null;
      s.committed.add(receipt.step);
      while (s.committed.size > s.receiptLimit)
        s.committed.delete(s.committed.values().next().value);
      s.step = nextStep;
      return Object.freeze({step: receipt.step, version: nextVersion});
    });
  }
  cancel() {
    return this.critical(s => {
      if (s.cancelled) return false;
      if (s.committed.has(s.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      // Validate the entire refund before the first mutation.
      const refunds = new Map();
      for (const ctx of s.contexts.values())
        refunds.set(ctx.key.version, (refunds.get(ctx.key.version) || 0) + 1);
      for (const [version, count] of refunds) {
        const record = s.versions.get(version);
        if (!record || record.pins < count) this.error("ML_PIN_LEDGER_CORRUPT");
      }
      for (const [version, count] of refunds)
        s.versions.get(version).pins -= count;
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
  const a = new VersionedStage({plannedMicrobatches: [1, 2]});
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

test("an explicit step manifest prevents early, partial, or unplanned optimizer publication", () => {
  const a = new VersionedStage({plannedMicrobatches: [4, 8]});
  const one = a.currentKey(4);
  a.forward(one); a.backward(one, "left"); a.backward(one, "right");
  assert.throws(() => a.prepare(1, 1, 4), /ML_STEP_INCOMPLETE/);
  assert.throws(() => a.forward(a.currentKey(9)), /ML_UNPLANNED_MICROBATCH/);
  const two = a.currentKey(8);
  a.forward(two); a.backward(two, "right"); a.backward(two, "left");
  const receipt = a.prepare(1, 1, 4);
  a.commit(receipt);
  assert.equal(a.status().optimizerIteration, 1);
});

test("mutable caller execution keys are copied, not retained inside the pin ledger", () => {
  const a = new VersionedStage();
  const key = {...a.currentKey(1)};
  a.forward(key);
  key.version = 99;
  key.microbatch = 7;
  a.backward(a.currentKey(1), "left");
  a.backward(a.currentKey(1), "right");
  a.commit(a.prepare(1, 1, 4));
  assert.deepEqual(a.status().weightVersions, [2]);
});

test("a copied snapshot lease cannot release the underlying authority", () => {
  const a = new VersionedStage();
  const lease = a.snapshot();
  assert.throws(() => a.release({...lease}), /ML_LEASE_MISMATCH/);
  assert.deepEqual(a.status().weightVersions, [1]);
  a.release(lease);
  assert.throws(() => a.release(lease), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
});

test("loan callback cannot return an embedded map, weight record, or container with state alias", () => {
  const a = new VersionedStage();
  assert.throws(() => a.critical(s => s.contexts), /ML_STATE_LOAN_ESCAPE/);
  assert.throws(() => a.critical(s => s.versions.get(1)), /ML_STATE_LOAN_ESCAPE/);
  assert.throws(() => a.critical(s => ({nested: [s.optimizer]})), /ML_STATE_LOAN_ESCAPE/);
  assert.equal(a.status().version, 1);
});

test("prepared optimizer candidates freeze the whole step until commit or cancellation", () => {
  const a = new VersionedStage();
  const key = a.currentKey(1);
  a.forward(key); a.backward(key, "left"); a.backward(key, "right");
  const receipt = a.prepare(1, 1, 4);
  assert.throws(() => a.forward(a.currentKey(2)), /ML_STEP_PREPARED/);
  assert.throws(() => a.backward(key, "left"), /ML_STEP_PREPARED/);
  assert.throws(() => a.commit({...receipt}), /ML_UNRECOGNIZED_PREPARE/);
  a.commit(receipt);
  assert.equal(a.status().version, 2);
});

test("prepare preflights overflow without partially publishing weights or step", () => {
  const a = new VersionedStage();
  const key = a.currentKey(1);
  a.forward(key); a.backward(key, "left"); a.backward(key, "right");
  a.critical(s => {s.optimizer = Object.freeze({iteration: Number.MAX_SAFE_INTEGER});});
  assert.throws(() => a.prepare(1, 1, 4), /ML_COUNTER_OVERFLOW/);
  const st = a.status();
  assert.equal(st.version, 1);
  assert.equal(st.step, 1);
  assert.equal(st.active, 1);
});

test("commit validates every pin refund before modifying any committed state", () => {
  const a = new VersionedStage();
  const key = a.currentKey(1);
  a.forward(key); a.backward(key, "left"); a.backward(key, "right");
  const receipt = a.prepare(1, 1, 4);
  a.critical(s => {s.versions.get(1).pins = 0;});
  assert.throws(() => a.commit(receipt), /ML_PIN_LEDGER_CORRUPT/);
  assert.equal(a.status().version, 1);
  assert.equal(a.status().optimizerIteration, 0);
});

test("resource and step manifests fail closed on invalid boundaries", () => {
  assert.throws(() => new VersionedStage({capacity:0}), /ML_INVALID_RESOURCE_LIMIT/);
  assert.throws(() => new VersionedStage({byteBudget:0}), /ML_INVALID_RESOURCE_LIMIT/);
  assert.throws(() => new VersionedStage({edges:["left","left"]}), /ML_INVALID_EDGE_MANIFEST/);
  assert.throws(() => new VersionedStage({plannedMicrobatches:[1,1]}), /ML_INVALID_MICROBATCH_MANIFEST/);
  assert.throws(() => new VersionedStage({expectedMicrobatches:3,capacity:2}), /ML_INVALID_MICROBATCH_MANIFEST/);
  assert.throws(() => new VersionedStage().forward({microbatch:0}), /ML_INVALID_EXECUTION_KEY/);
});

test("recent commit receipts remain bounded while older steps are fenced by monotonic IDs", () => {
  const a = new VersionedStage({receiptLimit:2});
  for (let step = 1; step <= 4; step++) {
    const key = a.currentKey(step);
    a.forward(key); a.backward(key, "left"); a.backward(key, "right");
    a.commit(a.prepare(step, step, 5 - step * 0.25));
  }
  assert.equal(a.status().version, 5);
  assert.equal(a.status().optimizerIteration, 4);
  assert.equal(a.critical(s => s.committed.size), 2);
  assert.throws(() => a.forward({run:"run-A",epoch:4,graph:7,step:1,version:1,microbatch:1}),
    /ML_STEP_MISMATCH/);
});
