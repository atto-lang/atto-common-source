// HOST-ONLY abstract control-plane model: NOT compiled Oreslang, NOT actor/GPU execution.
// Run: node --test tests/model-actor-state-versioning-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

// Only `state` carries simulated guest-owned persistent data. The admission bit is
// test-harness infrastructure, corresponding to a sealed runtime gate.
class VersionedStage {
  constructor({edges = ["left", "right"], capacity = 2, byteBudget = 64,
    maxPins = 64, maxReceipts = 1024, maxVersionBytes = 512,
    weightBytes = 8} = {}) {
    if (!Array.isArray(edges) || !edges.length ||
        edges.some(e => typeof e !== "string" || !e.length) ||
        new Set(edges).size !== edges.length ||
        weightBytes > maxVersionBytes ||
        [capacity, byteBudget, maxPins, maxReceipts, maxVersionBytes, weightBytes]
          .some(n => !Number.isSafeInteger(n) || n < 1))
      throw Error("ML_INVALID_STAGE_LIMITS");
    this.state = {
      run: "run-A", epoch: 4, graph: 7, step: 1, activeVersion: 1,
      versions: new Map([[1, {value: 5, pins: 0, frozen: true, bytes: weightBytes}]]),
      contexts: new Map(), contextByTicket: new Map(), pins: new Map(), usedBytes: 0,
      livePins: 0, finishedContexts: 0,
      edges: new Set(edges), capacity, byteBudget, maxPins, maxReceipts,
      maxVersionBytes, weightBytes,
      admissionRevision: 0,
      optimizer: Object.freeze({iteration: 0}),
      prepared: null, committed: new Set(), committedReceipts: new Set(), cancelled: false
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
  copyForwardKey(key) {
    if (!key || typeof key !== "object") this.error("ML_INVALID_FORWARD_KEY");
    // A descriptor-only read rejects accessor properties before entering critical.
    // Proxies/FFI must be rejected by the real compiler/runtime at the trust boundary.
    const descriptors = Object.getOwnPropertyDescriptors(key);
    const fields = ["run", "epoch", "graph", "step", "version", "microbatch"];
    const copied = {};
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !Object.hasOwn(descriptor, "value"))
        this.error("ML_INVALID_FORWARD_KEY");
      copied[field] = descriptor.value;
    }
    return Object.freeze(copied);
  }
  checkIdentity(s, key) {
    if (key.run !== s.run) this.error("ML_RUN_MISMATCH");
    if (key.epoch !== s.epoch) this.error("ML_ACTOR_INCARNATION_MISMATCH");
    if (key.graph !== s.graph) this.error("ML_GRAPH_GENERATION_MISMATCH");
    if (key.step !== s.step) this.error("ML_STEP_MISMATCH");
    if (key.version !== s.activeVersion) this.error("ML_WEIGHT_VERSION_MISMATCH");
  }
  totalPins(s) { return [...s.versions.values()].reduce((n, v) => n + v.pins, 0); }
  retainedWeightBytes(s) {
    return [...s.versions.values()].reduce((n, v) => n + v.bytes, 0);
  }
  nextAdmissionRevision(s) {
    const revision = s.admissionRevision + 1;
    if (!Number.isSafeInteger(revision)) this.error("ML_ADMISSION_REVISION_OVERFLOW");
    return revision;
  }
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
      if (s.livePins >= s.maxPins) this.error("ML_PIN_QUOTA_EXHAUSTED");
      const version = s.activeVersion;
      const storage = s.versions.get(version);
      const token = Symbol("immutable-weight-pin");
      // Host scalar only: production requires an authenticated, immutable buffer lease.
      const lease = Object.freeze({token, value: storage.value, version,
        run: s.run, epoch: s.epoch, graph: s.graph});
      storage.pins += 1;
      s.livePins += 1;
      s.pins.set(lease, version);
      return lease;
    });
  }
  release(lease) {
    return this.critical(s => {
      const version = s.pins.get(lease);
      if (version === undefined) this.error("ML_UNKNOWN_OR_EXPIRED_LEASE");
      const storage = s.versions.get(version);
      if (!storage || storage.pins < 1) this.error("ML_PIN_LEDGER_CORRUPT");
      s.pins.delete(lease);
      storage.pins -= 1;
      s.livePins -= 1;
      this.retireOld(s);
    });
  }
  forward(key, bytes = 8) {
    const trustedKey = this.copyForwardKey(key);
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      this.checkIdentity(s, trustedKey);
      if (s.committed.has(trustedKey.step)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (s.prepared) this.error("ML_STEP_PREPARING");
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      const nextRevision = this.nextAdmissionRevision(s);
      if (!Number.isSafeInteger(trustedKey.microbatch) || trustedKey.microbatch < 0)
        this.error("ML_INVALID_MICROBATCH");
      if (s.contexts.has(trustedKey.microbatch)) this.error("ML_DUPLICATE_MICROBATCH");
      if (!Number.isSafeInteger(bytes) || bytes <= 0) this.error("ML_BAD_TENSOR_BYTES");
      if (s.contexts.size >= s.capacity || bytes > s.byteBudget - s.usedBytes)
        this.error("ML_BACKPRESSURE");
      if (s.livePins >= s.maxPins) this.error("ML_PIN_QUOTA_EXHAUSTED");
      const admission = Symbol("issued-forward-activation");
      const ticket = Object.freeze({...trustedKey, bytes, admission});
      s.versions.get(trustedKey.version).pins += 1;
      s.livePins += 1;
      s.usedBytes += bytes;
      const context = {
        key: trustedKey, ticket, bytes, received: new Set(), finished: false
      };
      s.contexts.set(trustedKey.microbatch, context);
      s.contextByTicket.set(ticket, context);
      s.admissionRevision = nextRevision;
      return ticket;
    });
  }
  backward(ticket, edge) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      const context = s.contextByTicket.get(ticket);
      if (!context || s.contexts.get(context.key.microbatch) !== context)
        this.error("ML_ACTIVATION_LEASE_MISMATCH");
      this.checkIdentity(s, context.key);
      if (s.prepared) this.error("ML_STEP_PREPARING");
      if (!s.edges.has(edge)) this.error("ML_UNKNOWN_EDGE");
      if (context.received.has(edge)) this.error("ML_DUPLICATE_GRADIENT");
      const nextRevision = this.nextAdmissionRevision(s);
      context.received.add(edge);
      context.finished = context.received.size === s.edges.size;
      if (context.finished) s.finishedContexts += 1;
      s.admissionRevision = nextRevision;
      return context.finished;
    });
  }
  abortForward(ticket) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (s.prepared) this.error("ML_STEP_PREPARING");
      const ctx = s.contextByTicket.get(ticket);
      if (!ctx || s.contexts.get(ctx.key.microbatch) !== ctx)
        this.error("ML_UNKNOWN_OR_STALE_ACTIVATION");
      this.checkIdentity(s, ctx.key);
      if (ctx.received.size) this.error("ML_FORWARD_ALREADY_BACKPROPAGATING");
      const nextRevision = this.nextAdmissionRevision(s);
      const storage = s.versions.get(ctx.key.version);
      if (!storage || storage.pins < 1 || ctx.bytes > s.usedBytes)
        this.error("ML_PIN_LEDGER_CORRUPT");
      s.contexts.delete(ctx.key.microbatch);
      s.contextByTicket.delete(ticket);
      s.usedBytes -= ctx.bytes;
      storage.pins -= 1;
      s.livePins -= 1;
      s.admissionRevision = nextRevision;
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
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      if (!s.contexts.size) this.error("ML_STEP_NO_GRADIENTS");
      if (s.finishedContexts !== s.contexts.size)
        this.error("ML_STEP_NOT_QUIESCENT");
      if (s.prepared) this.error("ML_PREPARE_ALREADY_EXISTS");
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      const token = Symbol("prepared-optimizer-candidate");
      const receipt = Object.freeze({token, step, expectedVersion,
        run: s.run, epoch: s.epoch, graph: s.graph});
      s.prepared = {token, receipt, step, expectedVersion, run: s.run,
        epoch: s.epoch, graph: s.graph, revision: s.admissionRevision,
        weights: frozenCandidate};
      // Numerical candidate remains a caller-supplied oracle in this host model.
      return receipt;
    });
  }
  abortPrepare(receipt) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (!s.prepared || s.prepared.receipt !== receipt)
        this.error("ML_UNRECOGNIZED_PREPARE");
      const nextRevision = this.nextAdmissionRevision(s);
      s.prepared = null; // preserve authenticated gradients; revoke old receipt
      s.admissionRevision = nextRevision;
      return true;
    });
  }
  commit(receipt) {
    return this.critical(s => {
      if (s.cancelled) this.error("ML_RUN_CANCELLED");
      if (s.committedReceipts.has(receipt)) this.error("ML_STEP_ALREADY_COMMITTED");
      if (!s.prepared || s.prepared.receipt !== receipt)
        this.error("ML_UNRECOGNIZED_PREPARE");
      if (s.prepared.step !== s.step)
        this.error("ML_STEP_MISMATCH");
      if (s.prepared.expectedVersion !== s.activeVersion)
        this.error("ML_WEIGHT_VERSION_MISMATCH");
      if (s.prepared.run !== s.run ||
          s.prepared.epoch !== s.epoch || s.prepared.graph !== s.graph)
        this.error("ML_PREPARE_GENERATION_MISMATCH");
      if (s.admissionRevision !== s.prepared.revision)
        this.error("ML_PREPARE_INVALIDATED");
      if (!s.contexts.size || s.finishedContexts !== s.contexts.size)
        this.error("ML_STEP_NOT_QUIESCENT");
      // Full preflight before any guest-visible publication.
      const nextVersion = s.activeVersion + 1, nextStep = s.step + 1;
      const nextIteration = s.optimizer.iteration + 1;
      if (![nextVersion, nextStep, nextIteration].every(Number.isSafeInteger))
        this.error("ML_VERSION_OVERFLOW");
      if (s.committed.size >= s.maxReceipts) this.error("ML_RECEIPT_QUOTA_EXHAUSTED");
      if (s.versions.has(nextVersion)) this.error("ML_VERSION_COLLISION");
      if (s.livePins < s.contexts.size) this.error("ML_PIN_LEDGER_CORRUPT");
      const candidate = s.prepared.weights;
      if (!Object.isFrozen(candidate) || !Number.isFinite(candidate.value))
        this.error("ML_INVALID_PREPARED_WEIGHTS");
      const decrements = new Map();
      for (const ctx of s.contexts.values())
        decrements.set(ctx.key.version, (decrements.get(ctx.key.version) || 0) + 1);
      let projectedBytes = s.weightBytes;
      for (const [v, storage] of s.versions) {
        const n = decrements.get(v) || 0;
        if (storage.pins < n || !Number.isSafeInteger(storage.bytes) ||
            storage.bytes < 1) this.error("ML_PIN_LEDGER_CORRUPT");
        // Former active becomes eligible for retirement after publishing.
        if (storage.pins > n) {
          if (storage.bytes > s.maxVersionBytes - projectedBytes)
            this.error("ML_RETAINED_WEIGHT_QUOTA_EXHAUSTED");
          projectedBytes += storage.bytes;
        }
      }
      s.versions.set(nextVersion, {value: candidate.value, pins: 0,
        frozen: true, bytes: s.weightBytes});
      s.activeVersion = nextVersion;
      s.optimizer = Object.freeze({iteration: nextIteration});
      for (const [v, n] of decrements) s.versions.get(v).pins -= n;
      s.livePins -= s.contexts.size;
      this.retireOld(s);
      s.contexts.clear();
      s.contextByTicket.clear();
      s.finishedContexts = 0;
      s.usedBytes = 0;
      s.prepared = null;
      s.committed.add(s.step);
      s.committedReceipts.add(receipt);
      s.step = nextStep;
      return Object.freeze({step: nextStep - 1, version: nextVersion});
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
      if (s.livePins < s.contexts.size) this.error("ML_PIN_LEDGER_CORRUPT");
      for (const [v, n] of decrements) s.versions.get(v).pins -= n;
      s.livePins -= s.contexts.size;
      this.retireOld(s);
      s.contexts.clear();
      s.contextByTicket.clear();
      s.finishedContexts = 0;
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
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward({...ticket, version: 2}, "right"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward({...ticket, graph: 8}, "right"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward({...ticket, run: "other"}, "right"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward({...ticket, step: 5}, "right"),
    /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.backward(ticket, "intruder"), /ML_UNKNOWN_EDGE/);
});

test("atomic local commit changes weights and optimizer state once, not twice", () => {
  const a = new VersionedStage();
  const receipt = completedStep(a);
  assert.equal(receipt.version, 2);
  assert.throws(() => a.commit({ ...receipt, token: Symbol("fake") }),
    /ML_UNRECOGNIZED_PREPARE/);
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
    /ML_UNRECOGNIZED_PREPARE/);
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
  assert.throws(() => a.forward(a.currentKey(2)),
    /ML_RECEIPT_QUOTA_EXHAUSTED/);
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

test("deterministic state-machine interleavings preserve pin, fan-in, and commit invariants", () => {
  for (let seed = 1; seed <= 128; seed++) {
    let rng = seed >>> 0;
    const next = () => {
      rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
      return rng >>> 0;
    };
    const a = new VersionedStage({capacity: 4, byteBudget: 32,
      maxPins: 8, maxReceipts: 3});
    const tickets = [], leases = [], prepares = [];
    for (let i = 0; i < 96; i++) {
      const n = next() % 10;
      try {
        if (n <= 2) {
          const ticket = a.forward(a.currentKey(next() % 5), 1 + next() % 12);
          tickets.push(ticket);
        } else if (n <= 4 && tickets.length) {
          const ticket = tickets[next() % tickets.length];
          a.backward(ticket, (next() & 1) ? "left" : "right");
        } else if (n === 5 && tickets.length) {
          a.abortForward(tickets[next() % tickets.length]);
        } else if (n === 6) {
          leases.push(a.snapshot());
        } else if (n === 7 && leases.length) {
          const index = next() % leases.length;
          const lease = leases[index];
          a.release(lease);
          leases.splice(index, 1);
        } else if (n === 8) {
          prepares.push(a.prepare(a.state.step, a.state.activeVersion, 4.5));
        } else if (n === 9 && prepares.length) {
          a.commit(prepares[next() % prepares.length]);
        }
      } catch (e) {
        // Failure is permitted only through a named, fail-closed protocol gate.
        assert.match(String(e), /ML_[A-Z_]+/);
      }
      const s = a.state;
      assert.equal(s.usedBytes,
        [...s.contexts.values()].reduce((sum, c) => sum + c.bytes, 0));
      assert.equal(s.finishedContexts,
        [...s.contexts.values()].filter(c => c.finished).length);
      assert.equal(s.livePins, a.totalPins(s));
      assert.equal(s.livePins, s.contexts.size + s.pins.size);
      assert.equal(s.contextByTicket.size, s.contexts.size);
      assert.equal(s.committedReceipts.size, s.committed.size);
      assert(a.retainedWeightBytes(s) <= s.maxVersionBytes);
      assert(s.livePins <= s.maxPins);
      assert(s.usedBytes <= s.byteBudget);
      assert(s.contexts.size <= s.capacity);
      assert(s.committed.size <= s.maxReceipts);
      assert.equal(s.optimizer.iteration, s.activeVersion - 1);
      assert(s.versions.has(s.activeVersion));
      assert.equal(s.step, s.activeVersion);
      for (const [version, storage] of s.versions) {
        assert(storage.pins >= 0);
        if (version !== s.activeVersion) assert(storage.pins > 0);
      }
      for (const ctx of s.contexts.values()) {
        assert.equal(ctx.key.step, s.step);
        assert.equal(ctx.key.version, s.activeVersion);
      }
      if (s.prepared) {
        assert(s.contexts.size > 0);
        assert.equal(s.finishedContexts, s.contexts.size);
      }
    }
  }
});

test("admission revision overflow is rejected before reserving bytes or pins", () => {
  const a = new VersionedStage({edges: ["left"]});
  a.critical(s => { s.admissionRevision = Number.MAX_SAFE_INTEGER; });
  assert.throws(() => a.forward(a.currentKey(1)), /ML_ADMISSION_REVISION_OVERFLOW/);
  assert.equal(a.status().active, 0);
  assert.equal(a.state.livePins, 0);
  a.critical(s => { s.admissionRevision = 0; });
  const ticket = a.forward(a.currentKey(1));
  a.critical(s => { s.admissionRevision = Number.MAX_SAFE_INTEGER; });
  assert.throws(() => a.backward(ticket, "left"), /ML_ADMISSION_REVISION_OVERFLOW/);
  assert.equal(a.state.finishedContexts, 0);
  assert.equal(a.state.contexts.get(1).received.size, 0);
});

test("abort prepare restores liveness without permitting replay or dropping gradients", () => {
  const a = new VersionedStage({edges: ["left"]});
  const t = a.forward(a.currentKey(1));
  a.backward(t, "left");
  const old = a.prepare(1, 1, 4.75);
  assert.equal(a.abortPrepare(old), true);
  assert.throws(() => a.commit(old), /ML_UNRECOGNIZED_PREPARE/);
  assert.equal(a.state.finishedContexts, 1);
  assert.equal(a.state.contexts.size, 1);
  const retry = a.prepare(1, 1, 4.5);
  assert.throws(() => a.abortPrepare(old), /ML_UNRECOGNIZED_PREPARE/);
  assert.deepEqual(a.commit(retry), {step: 1, version: 2});
});

test("bounded version bytes fail closed with external pins and become reclaimable", () => {
  const a = new VersionedStage({maxVersionBytes: 8, weightBytes: 8});
  const held = a.snapshot();
  const t = a.forward(a.currentKey(1));
  a.backward(t, "left"); a.backward(t, "right");
  const ready = a.prepare(1, 1, 4.5);
  assert.throws(() => a.commit(ready), /ML_RETAINED_WEIGHT_QUOTA_EXHAUSTED/);
  assert.equal(a.status().version, 1);
  assert.equal(a.status().optimizerIteration, 0);
  assert.equal(a.state.prepared.receipt, ready);
  a.release(held);
  assert.deepEqual(a.commit(ready), {step: 1, version: 2});
  assert.equal(a.retainedWeightBytes(a.state), 8);
});

test("retained version byte cap permits two versions, forbids a third pinned one", () => {
  const a = new VersionedStage({maxVersionBytes: 16, weightBytes: 8, edges: ["left"]});
  const one = a.snapshot();
  let t = a.forward(a.currentKey(1));
  a.backward(t, "left");
  a.commit(a.prepare(1, 1, 4));
  const two = a.snapshot();
  t = a.forward(a.currentKey(2));
  a.backward(t, "left");
  const pending = a.prepare(2, 2, 3.5);
  assert.throws(() => a.commit(pending), /ML_RETAINED_WEIGHT_QUOTA_EXHAUSTED/);
  assert.equal(a.status().version, 2);
  a.release(one);
  assert.deepEqual(a.commit(pending), {step: 2, version: 3});
  assert.deepEqual(a.status().weightVersions, [2, 3]);
  a.release(two);
  assert.deepEqual(a.status().weightVersions, [3]);
});

test("untrusted activation tickets cannot trigger property getters in critical", () => {
  const a = new VersionedStage({edges: ["left"]});
  const good = a.forward(a.currentKey(1));
  let invoked = 0;
  const hostile = {get microbatch() { invoked++; throw Error("untrusted getter"); }};
  assert.throws(() => a.backward(hostile, "left"), /ML_ACTIVATION_LEASE_MISMATCH/);
  assert.throws(() => a.abortForward(hostile), /ML_UNKNOWN_OR_STALE_ACTIVATION/);
  assert.equal(invoked, 0);
  assert.equal(a.backward(good, "left"), true);
});

test("snapshot and prepare capabilities reject copies without invoking getters", () => {
  const a = new VersionedStage({edges: ["left"]});
  const pin = a.snapshot();
  let invoked = 0;
  const hostileLease = {get token() { invoked++; throw Error("untrusted lease getter"); }};
  assert.throws(() => a.release(hostileLease), /ML_UNKNOWN_OR_EXPIRED_LEASE/);
  const t = a.forward(a.currentKey(1));
  a.backward(t, "left");
  const p = a.prepare(1, 1, 4);
  const hostilePrepare = {get token() { invoked++; throw Error("untrusted receipt getter"); }};
  assert.throws(() => a.commit(hostilePrepare), /ML_UNRECOGNIZED_PREPARE/);
  assert.throws(() => a.abortPrepare(hostilePrepare), /ML_UNRECOGNIZED_PREPARE/);
  assert.equal(invoked, 0);
  a.release(pin);
  a.commit(p);
});

test("hostile metadata accessors are rejected before forward state mutation", () => {
  const a = new VersionedStage();
  const key = a.currentKey(1);
  let invoked = 0;
  const bad = {...key};
  Object.defineProperty(bad, "run", {enumerable: true, get() {
    invoked++; throw Error("bad getter");
  }});
  assert.throws(() => a.forward(bad), /ML_INVALID_FORWARD_KEY/);
  assert.equal(invoked, 0);
  assert.equal(a.state.livePins, 0);
  assert.equal(a.state.usedBytes, 0);
  assert.equal(a.state.admissionRevision, 0);
});

test("version byte limits reject invalid or undersized declarations", () => {
  for (const config of [
    {weightBytes: 0}, {maxVersionBytes: 0}, {weightBytes: 9, maxVersionBytes: 8},
    {weightBytes: Number.MAX_SAFE_INTEGER + 1}, {maxVersionBytes: 1.5}
  ]) assert.throws(() => new VersionedStage(config), /ML_INVALID_STAGE_LIMITS/);
});
