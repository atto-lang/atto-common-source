// Review-only, source-free reference oracle. NOT an Oreslang compiler or runtime.
// A held logical actor turn is intentionally not a held critical guard.
export class CriticalAdmissionModel {
  constructor(generation = 1, {maxQueued = 1024} = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1) throw Error("invalid generation");
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > 65536)
      throw Error("invalid critical queue capacity");
    this.generation = generation;
    this.maxQueued = maxQueued;
    this.current = null;
    this.queue = [];
    this.nextSequence = 1;
    this.carriersBlocked = 0;
  }
  acquire(task, generation, {tryOnly = false, deadlineMs = null, nowMs = 0} = {}) {
    if (typeof task !== "string" || task.length === 0) throw Error("invalid task");
    if (generation !== this.generation) throw Error("STALE_GENERATION");
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw Error("invalid clock");
    if (deadlineMs !== null && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0)) {
      throw Error("invalid deadline");
    }
    if (deadlineMs !== null && nowMs >= deadlineMs) return {status:"expired"};
    // Fail closed on same-task recursive admission rather than deadlocking
    // behind the task's own guard or minting duplicate queue tickets.
    if ((this.current?.task === task && this.current.generation === generation) ||
        this.queue.some(t => t.task === task && t.generation === generation))
      throw Error("E_CRITICAL_NESTED");
    // A queued waiter owns priority even if no current guard has yet been installed.
    if (this.current === null && this.queue.length === 0) {
      const ticket = this.#ticket(task, generation, "held");
      this.current = ticket;
      return ticket;
    }
    if (tryOnly) return {status:"busy"};
    if (this.queue.length >= this.maxQueued) return {status:"saturated"};
    const ticket = this.#ticket(task, generation, "queued");
    this.queue.push(ticket);
    // This models suspension of a continuation: NO carrier is blocked.
    return ticket;
  }
  #ticket(task, generation, status) {
    return {task, generation, status, sequence:this.nextSequence++, cancellationRequested:false};
  }
  cancel(ticket) {
    if (ticket.status === "queued") {
      this.queue = this.queue.filter(x => x !== ticket);
      ticket.status = "cancelled";
      return true;
    }
    if (ticket.status === "held") {
      // A granted guard cannot be physically stolen during guest mutation.
      ticket.cancellationRequested = true;
    }
    return false;
  }
  expire(nowMs, deadlineBySequence) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw Error("invalid clock");
    if (typeof deadlineBySequence !== "function") throw Error("deadline accessor required");
    // Evaluate all deadline descriptors before mutating tickets, so a
    // malformed comparator cannot cause a half-applied expiry transition.
    const deadlines = this.queue.map(ticket => ({
      ticket, deadline:deadlineBySequence(ticket.sequence)
    }));
    for (const {deadline} of deadlines) {
      if (deadline !== null && deadline !== undefined &&
          (!Number.isSafeInteger(deadline) || deadline < 0))
        throw Error("invalid deadline");
    }
    for (const {ticket, deadline} of deadlines) {
      if (deadline !== null && deadline !== undefined && nowMs >= deadline) {
        this.queue = this.queue.filter(x => x !== ticket);
        ticket.status = "expired";
      }
    }
    if (this.current === null) this.#handoff();
  }
  release(ticket, {trapped = false} = {}) {
    if (ticket !== this.current || ticket.status !== "held") throw Error("INVALID_RELEASE");
    ticket.status = trapped ? "released-after-trap" : "released";
    this.current = null;
    this.#handoff();
  }
  retire(nextGeneration) {
    if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= this.generation) {
      throw Error("invalid retirement generation");
    }
    this.generation = nextGeneration;
    for (const ticket of this.queue) ticket.status = "retired";
    this.queue = [];
    // Physically held old-generation guard must still unwind before a fresh grant.
    if (this.current) this.current.cancellationRequested = true;
  }
  #handoff() {
    if (this.current !== null) return;
    while (this.queue.length) {
      const candidate = this.queue.shift();
      if (candidate.status !== "queued") continue;
      if (candidate.generation !== this.generation) {
        candidate.status = "retired";
        continue;
      }
      candidate.status = "held";
      this.current = candidate;
      return;
    }
  }
  snapshot() {
    return {generation:this.generation, current:this.current?.sequence ?? null,
      pending:this.queue.map(t => t.sequence), carriersBlocked:this.carriersBlocked};
  }
}

export class NonreentrantActorTurnModel {
  constructor(generation = 1, {maxQueued = 1024} = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw Error("invalid actor generation");
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > 65536)
      throw Error("invalid actor queue capacity");
    this.maxQueued = maxQueued;
    this.generation = generation;
    this.turn = null;
    this.dataQueue = [];
    this.controlCount = 0;
    this.physicallyRetired = true;
  }
  enter(task, generation) {
    if (generation !== this.generation) throw Error("STALE_ACTOR");
    if (typeof task !== "string" || task.length === 0) throw Error("invalid task");
    if (this.turn !== null) {
      // A task may not synchronously wait for another admission to the
      // nonreentrant turn it owns. This is distinct from a contended guard.
      if (this.turn.task === task && this.turn.generation === generation)
        throw Error("E_ACTOR_SELF_WAIT");
      if (this.dataQueue.some(t => t.task === task && t.generation === generation))
        throw Error("E_ACTOR_DUPLICATE_TICKET");
      if (this.dataQueue.length >= this.maxQueued) return "saturated";
      this.dataQueue.push({task,generation});
      return "queued";
    }
    this.turn = {task,generation,status:"running"};
    this.physicallyRetired = false;
    return "running";
  }
  suspend(task) {
    if (this.turn?.task !== task || this.turn.status !== "running") throw Error("INVALID_SUSPEND");
    this.turn.status = "suspended";
    // No physical mutex/carrier is retained here.
  }
  resume(task, generation) {
    if (generation !== this.generation || this.turn?.task !== task ||
        this.turn.status !== "suspended") throw Error("STALE_RESUME");
    this.turn.status = "running";
  }
  controlStop() {
    // Supervisor CONTROL can request termination without executing DATA out of turn.
    this.controlCount++;
  }
  finish(task) {
    if (this.turn?.task !== task) throw Error("INVALID_FINISH");
    this.turn = null;
    this.physicallyRetired = true;
    while (this.dataQueue.length) {
      const next = this.dataQueue.shift();
      if (next.generation !== this.generation) continue;
      this.turn = {...next,status:"running"};
      this.physicallyRetired = false;
      break;
    }
  }
  retire(nextGeneration) {
    if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= this.generation) {
      throw Error("invalid retirement generation");
    }
    this.generation = nextGeneration;
    this.dataQueue = [];
    // Suspended old-gen work still requires cleanup before heap/code reclamation.
    if (this.turn) this.turn.status = "retiring";
  }
}

export function checkCriticalEffectSummary({guardOwned, nested = false, effects, trusted = true}) {
  if (!guardOwned) return "E_CRITICAL_OWNER";
  if (nested) return "E_CRITICAL_NESTED";
  if (!trusted || !Array.isArray(effects) ||
      effects.some(e => typeof e !== "string" || !["suspend","block","read","write","alloc","ffi-safe","pure"].includes(e))) {
    return "E_EFFECT_UNKNOWN";
  }
  if (effects.includes("suspend")) return "E_CRITICAL_SUSPENSION";
  if (effects.includes("block")) return "E_CRITICAL_BLOCKING";
  return "accept";
}
