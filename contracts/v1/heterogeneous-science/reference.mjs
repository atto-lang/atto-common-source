// Host-only admission/reference oracles. NOT Oreslang guest execution, a device
// allocator, an RTOS scheduler, a quantum simulator or a security authority.
export class ContractError extends Error {
  constructor(code) { super(code); this.name = "ContractError"; this.code = code; }
}
const die = code => { throw new ContractError(code); };
const requireThat = (condition, code) => { if (!condition) die(code); };
const LIMIT = (1n << 63n) - 1n;
const integer = n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
function bounded(n) {
  if (typeof n === "bigint") {
    requireThat(n >= 0n && n <= LIMIT, "INVALID_NONNEGATIVE_INTEGER");
    return n;
  }
  requireThat(integer(n), "INVALID_NONNEGATIVE_INTEGER");
  return BigInt(n);
}
function addBounded(a, b) {
  const sum = a + b;
  requireThat(sum <= LIMIT, "INTEGER_OVERFLOW");
  return sum;
}
function mulBounded(a, b) {
  const product = a * b;
  requireThat(product <= LIMIT, "INTEGER_OVERFLOW");
  return product;
}

export function tensorView({shape, strides, elementBytes, capacityBytes, mutable = false}) {
  requireThat(Array.isArray(shape) && Array.isArray(strides) &&
    shape.length === strides.length && shape.length <= 8, "INVALID_TENSOR_LAYOUT");
  requireThat(integer(elementBytes) && elementBytes > 0 && integer(capacityBytes),
    "INVALID_TENSOR_LAYOUT");
  let count = 1n;
  let maxElementOffset = 0n;
  let empty = false;
  for (let i = 0; i < shape.length; i++) {
    requireThat(integer(shape[i]) && integer(strides[i]), "INVALID_TENSOR_LAYOUT");
    if (mutable) requireThat(shape[i] <= 1 || strides[i] !== 0, "ALIASING_MUTABLE_VIEW");
    if (shape[i] === 0) empty = true;
    count = mulBounded(count, bounded(shape[i]));
    if (shape[i] > 0)
      maxElementOffset = addBounded(maxElementOffset,
        mulBounded(BigInt(shape[i] - 1), bounded(strides[i])));
  }
  const endBytes = empty ? 0n : mulBounded(addBounded(maxElementOffset, 1n), bounded(elementBytes));
  requireThat(endBytes <= bounded(capacityBytes), "TENSOR_OUT_OF_BOUNDS");
  return Object.freeze({elements: count, endBytes});
}

export function broadcastShape(a, b) {
  requireThat(Array.isArray(a) && Array.isArray(b) && a.length <= 8 && b.length <= 8,
    "INVALID_TENSOR_LAYOUT");
  requireThat([...a, ...b].every(integer), "INVALID_TENSOR_LAYOUT");
  const len = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const x = a[a.length - len + i] ?? 1;
    const y = b[b.length - len + i] ?? 1;
    requireThat(x === y || x === 1 || y === 1, "TENSOR_SHAPE_MISMATCH");
    out.push(x === 1 ? y : x);
  }
  return Object.freeze(out);
}

export function admitEffects(contract, profile, effects) {
  requireThat(contract?.status === "REFERENCE_MODEL_ONLY" &&
    Object.hasOwn(contract?.profiles ?? {}, profile) && Array.isArray(effects),
    "UNKNOWN_EXECUTION_PROFILE");
  const allowed = contract.profiles[profile].allowed_effects;
  requireThat(effects.every(x => typeof x === "string" && allowed.includes(x)),
    "EFFECT_NOT_ADMITTED");
  return true; // The profile's additional target requirements are checked separately.
}

export function deadlineAdmission({deadlineUs, wcetUs, blockingUs, interferenceUs, jitterUs,
                                    aot, preallocated, timingEvidence, rtosAdmitted}) {
  requireThat(aot && preallocated && timingEvidence && rtosAdmitted, "UNBOUNDED_DEADLINE");
  const total = [wcetUs, blockingUs, interferenceUs, jitterUs]
    .map(bounded).reduce((s, n) => addBounded(s, n), 0n);
  requireThat(total <= bounded(deadlineUs), "DEADLINE_EXCEEDED");
  return Object.freeze({totalUs: total, deadlineUs: BigInt(deadlineUs)});
}

export function admitDispatch({requestedDevice, availableDevices, workgroup, maxInvocations,
                               explicitCpuFallback = false}) {
  requireThat(Array.isArray(availableDevices) && typeof requestedDevice === "string" &&
    Array.isArray(workgroup) && workgroup.length > 0 && workgroup.length <= 3,
    "INVALID_DISPATCH");
  const device = availableDevices.find(d => d.id === requestedDevice);
  // Never select CPU because a GPU request failed, regardless of fallback flag.
  requireThat(device && device.kind === "gpu", "UNSUPPORTED_DEVICE");
  requireThat(workgroup.every(n => integer(n) && n > 0), "INVALID_DISPATCH");
  const count = workgroup.reduce((n, x) => mulBounded(n, bounded(x)), 1n);
  requireThat(count <= bounded(maxInvocations) && count <= bounded(device.maxInvocations),
    "INVALID_DISPATCH");
  void explicitCpuFallback;
  return Object.freeze({deviceId: device.id, invocations: count});
}

export class ResourceLedger {
  #next = 1;
  #nextLoan = 1;
  #nextFence = 1;
  #resources = new Map();
  #loans = new Map();
  allocate(owner, domain, bytes) {
    requireThat(Number.isSafeInteger(owner) && owner > 0 &&
      ["host","pinned_host","gpu","remote","qpu"].includes(domain) &&
      integer(bytes), "INVALID_RESOURCE");
    const id = this.#next++;
    this.#resources.set(id, {owner, domain, bytes, generation: 1,
      readers: 0, writer: false, fence: null, retired: false});
    return Object.freeze({id, generation: 1});
  }
  #get(handle, owner) {
    const r = this.#resources.get(handle?.id);
    requireThat(r && !r.retired && r.generation === handle?.generation, "STALE_HANDLE");
    requireThat(r.owner === owner, "FOREIGN_OWNER");
    return r;
  }
  borrow(handle, owner, mode) {
    const r = this.#get(handle, owner);
    requireThat(mode === "read" || mode === "write", "INVALID_LOAN");
    requireThat(r.fence === null && !r.writer && (mode === "read" || r.readers === 0),
      "BUFFER_LOAN_ACTIVE");
    if (mode === "read") r.readers++; else r.writer = true;
    const token = this.#nextLoan++;
    this.#loans.set(token, {id: handle.id, mode});
    return token; // Only a host-model receipt; NOT an unforgeable runtime capability.
  }
  releaseLoan(token) {
    const loan = this.#loans.get(token);
    requireThat(loan, "UNKNOWN_LOAN");
    const r = this.#resources.get(loan.id);
    if (loan.mode === "read") r.readers--; else r.writer = false;
    this.#loans.delete(token);
  }
  #idle(r) {
    requireThat(!r.writer && r.readers === 0, "BUFFER_LOAN_ACTIVE");
    requireThat(r.fence === null, "FENCE_IN_FLIGHT");
  }
  copy(handle, owner, {explicitTransfer = false} = {}) {
    const r = this.#get(handle, owner); this.#idle(r);
    requireThat(r.domain !== "qpu", "QUBIT_NOT_COPYABLE");
    requireThat(explicitTransfer, "IMPLICIT_DEVICE_TRANSFER");
    return this.allocate(owner, r.domain, r.bytes);
  }
  move(handle, owner, newOwner, newDomain, {explicitTransfer = false} = {}) {
    const r = this.#get(handle, owner); this.#idle(r);
    requireThat(r.domain !== "qpu" && newDomain !== "qpu", "QUBIT_NOT_COPYABLE");
    requireThat(["host","pinned_host","gpu","remote"].includes(newDomain) &&
      integer(newOwner) && newOwner > 0, "INVALID_RESOURCE");
    requireThat(r.domain === newDomain || explicitTransfer, "IMPLICIT_DEVICE_TRANSFER");
    r.owner = newOwner; r.domain = newDomain;
    r.generation++;
    return Object.freeze({id: handle.id, generation: r.generation});
  }
  submitGpu(handle, owner) {
    const r = this.#get(handle, owner); this.#idle(r);
    requireThat(r.domain === "gpu", "UNSUPPORTED_DEVICE");
    const fence = this.#nextFence++;
    r.fence = {id: fence, cancelled: false};
    return Object.freeze({resourceId: handle.id, fence});
  }
  requestCancel(handle, owner, fence) {
    const r = this.#get(handle, owner);
    requireThat(r.fence?.id === fence, "INVALID_FENCE");
    r.fence.cancelled = true; // Cancellation does not prove completion/quiescence.
  }
  completeFence(handle, owner, fence) {
    const r = this.#get(handle, owner);
    requireThat(r.fence?.id === fence, "INVALID_FENCE");
    r.fence = null;
  }
  retire(handle, owner) {
    const r = this.#get(handle, owner); this.#idle(r);
    r.retired = true; r.generation++;
  }
}

export class QuantumCircuit {
  #state;
  #ops = [];
  constructor(qubitCount) {
    requireThat(integer(qubitCount) && qubitCount > 0 && qubitCount <= 64,
      "INVALID_QUBIT_COUNT");
    this.#state = Array(qubitCount).fill("live");
  }
  #live(q) {
    requireThat(integer(q) && q < this.#state.length, "INVALID_QUBIT");
    requireThat(this.#state[q] === "live", "QUBIT_ALREADY_MEASURED");
  }
  h(q) { this.#live(q); this.#ops.push(["h", q]); }
  cx(control, target) {
    this.#live(control); this.#live(target);
    requireThat(control !== target, "INVALID_QUANTUM_GATE");
    this.#ops.push(["cx", control, target]);
  }
  measure(q) {
    this.#live(q);
    this.#state[q] = "measured";
    this.#ops.push(["measure", q]);
  }
  toOpenQasm3() {
    const n = this.#state.length;
    const lines = ["OPENQASM 3.0;", 'include "stdgates.inc";',
      "qubit[" + n + "] q;", "bit[" + n + "] c;"];
    for (const op of this.#ops) {
      if (op[0] === "h") lines.push("h q[" + op[1] + "];");
      else if (op[0] === "cx") lines.push("cx q[" + op[1] + "], q[" + op[2] + "];");
      else lines.push("c[" + op[1] + "] = measure q[" + op[1] + "];");
    }
    return lines.join("\n") + "\n";
  }
}

export class Dual {
  constructor(value, tangent) {
    requireThat(Number.isFinite(value) && Number.isFinite(tangent), "INVALID_NUMERIC");
    this.value = value; this.tangent = tangent;
    Object.freeze(this);
  }
  add(that) { return new Dual(this.value + that.value, this.tangent + that.tangent); }
  mul(that) {
    return new Dual(this.value * that.value,
      this.tangent * that.value + this.value * that.tangent);
  }
}
export function fixedOrderSum(values) {
  requireThat(Array.isArray(values) && values.every(Number.isFinite), "INVALID_NUMERIC");
  // Fixed tree for a host oracle; NOT a cross-platform correctly-rounded guarantee.
  let level = values.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const value = i + 1 < level.length ? level[i] + level[i + 1] : level[i];
      requireThat(Number.isFinite(value), "INVALID_NUMERIC");
      next.push(value);
    }
    level = next;
  }
  return level[0] ?? 0;
}

export class PartitionLedger {
  #epoch;
  #next = 0;
  #inflight = new Map();
  #receipts = new Map();
  #capacity;
  #receiptCapacity;
  constructor(epoch, capacity, receiptCapacity = 1024) {
    requireThat(integer(epoch) && epoch > 0 && integer(capacity) && capacity > 0 &&
      integer(receiptCapacity) && receiptCapacity > 0,
      "INVALID_PARTITION");
    this.#epoch = epoch; this.#capacity = capacity;
    this.#receiptCapacity = receiptCapacity;
  }
  admit(epoch, sequence, digest) {
    requireThat(epoch === this.#epoch, "STALE_PARTITION_EPOCH");
    requireThat(integer(sequence) && typeof digest === "string" && digest.length > 0,
      "INVALID_PARTITION");
    if (sequence < this.#next) {
      requireThat(this.#receipts.get(sequence) === digest, "DUPLICATE_PARTITION_SEQUENCE");
      return "duplicate-acked";
    }
    requireThat(sequence === this.#next && !this.#inflight.has(sequence),
      "DUPLICATE_PARTITION_SEQUENCE");
    requireThat(this.#inflight.size < this.#capacity, "PARTITION_BACKPRESSURE");
    // Reserve bounded receipt capacity at admission, never fail when ACK needs it.
    requireThat(this.#receipts.size + this.#inflight.size < this.#receiptCapacity,
      "PARTITION_RECEIPT_BACKPRESSURE");
    this.#inflight.set(sequence, digest); this.#next++;
    return "admitted";
  }
  ack(epoch, sequence, digest) {
    requireThat(epoch === this.#epoch, "STALE_PARTITION_EPOCH");
    requireThat(this.#inflight.get(sequence) === digest, "INVALID_PARTITION_ACK");
    this.#inflight.delete(sequence);
    this.#receipts.set(sequence, digest);
  }
  restart(newEpoch) {
    requireThat(integer(newEpoch) && newEpoch > this.#epoch, "STALE_PARTITION_EPOCH");
    this.#epoch = newEpoch;
    this.#inflight.clear();
    // Durability/replay requires an external checkpoint: this is a local fence.
  }
}
