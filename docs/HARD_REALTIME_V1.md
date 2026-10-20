# Real-time execution contract v1

This contract is the backend-neutral admission boundary for Oreslang real-time claims.

Hard real-time is fail-closed. A backend may advertise a hard real-time critical path only when all of the following hold:

- the guest call graph is fully ahead-of-time compiled and runtime code generation is disabled;
- no managed/tracing heap is touched by the critical path;
- actor/task memory is preallocated, deterministically reclaimed, and prefaulted before admission;
- scheduler dispatch, synchronization, queue capacity, cancellation cleanup, and external effects have finite bounds;
- blocking I/O, unqualified FFI, dynamic code loading, and untrusted JIT execution are absent from the critical path;
- the deployment supplies an operating-system/RTOS policy that can honor the scheduling assumptions;
- timing evidence establishes WCET, blocking, interference, and release jitter, and their sum does not exceed the declared deadline.

Actor-owned arenas are an enabling mechanism, not by themselves proof of zero GC or hard real time. On LLVM they can be native regions with deterministic lifetime. On Java, ordinary objects and direct buffers remain JVM-managed unless a qualified real-time VM supplies no-heap/scoped-memory semantics or the backend lowers guest state to an explicit native region.

The contract intentionally separates three properties:

1. full guest AOT: no interpreter/JIT is required to execute reachable guest code;
2. zero tracing GC on the critical path: no critical object requires a tracing collector;
3. hard real time: worst-case response time is bounded under a named deployment profile.

A backend must not infer one property from another.

The canonical machine-readable schema is contracts/v1/realtime-execution.v1.schema.json.
