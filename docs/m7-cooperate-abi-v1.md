# M7 cooperative actor safe-point ABI v1

**Status:** candidate cross-backend contract. This is *not* a claim that any compiler already emits this ABI. The current Java M6 watchdog is observational only; it does not suspend guest code. The Rust/Wasm generator runtime already has a separate pull-oriented resumable generator PC, but **that is not a suspended actor receive turn**.

## Compiler-to-runtime boundary

An actor receive handler must lower into a generation-fenced continuation frame with a durable resume PC and typed live slots. The compiler inserts a safe point for every explicit `rt cooperate`, and at loop backedges only after proving no forbidden borrow or critical-state loan spans a suspension. Safe-point lowering returns one of:

- **CONTINUE:** reduction/time budget available; execute the next instruction.
- **YIELD:** budget exhausted or explicit cooperative yield. Store PC and all live typed locals *before* returning to the carrier scheduler. No repeated effects on resumption.
- **DONE:** the whole receive turn completed exactly once; completion becomes observable only after frame state is committed.
- **PANIC:** a guest Error panic becomes an independent priority supervisor CONTROL event; no further actor DATA starts, and accepted queued turns are accounted as abandoned.

The scheduler must not create a second receive while one continuation is **running OR suspended**. A YIELD resumes the **same** in-flight message; it is not new mailbox admission, and it must not increment completed. Success is defined by `accepted == completed + failed + abandoned + queued + in_flight`, with `in_flight` equal to one for either a RUNNING or SUSPENDED message.

`ActorRef` authority and continuation tokens include actor ID/incarnation and a frame generation; an outdated token may never resume a restarted actor. The compiler must forbid `rt borrow`/mutable borrow or a critical read/write state loan crossing a yield unless an explicit pin/loan proof is available; v1 **fails closed** for all such cases. A language `await` or `select` waits on an event/continuation and does not park an OS carrier.

## Scheduling budgets

- Reduction budget is bounded 1–65,536 charged safe points/slice; time budget is checked at the same safe points, never by unsafe asynchronous stack interruption.
- Scheduler ready queue contains an eligible actor at most once. On YIELD, the actor goes to the tail, allowing another runnable actor to progress. A serial actor may resume on any carrier, but **never concurrently** and without replaying the previous PC.
- A CPU loop with no inserted safe point is **uncooperative**. A watchdog can report it but cannot safely claim preemption; no hard-real-time or general latency guarantee follows.
- STOP fences admission but drains the already-accepted in-flight and queued turns (including repeated YIELD). PANIC fences admission and further resumption, abandoning queued turns with conservation; a failed currently running turn must quiesce physically before memory reclamation.
- CONTROL notices remain independently admitted and dispatched before a *new* DATA turn. A repeated STOP coalesces, and a later PANIC upgrades a STOP. Budget exhaustion is **not** a PANIC.

## Evidence / backend matrix policy

A parser accepting `rt cooperate` is not enough. Only **executed compiled** guest code that yields/resumes at observable saved PCs counts as guest support; a standalone host callback frame simulator counts only as host prototype. Report separately for Java/GraalVM, LLVM, Rust/Wasm, Forge, and .NET: **PASS / FAIL / UNSUPPORTED / NOT_EXECUTED**. Require exact immutable source trees and real native/guest test traces. The preexisting actor-trace-v2 CONTROL precedence contract remains authoritative.

## Initial conformance sequences

1. A compiled counter iterates >reductions budget, repeatedly YIELDs/resumes and computes an overflow-checked sum once.
2. A second actor completes while the first is suspended, with maximum one running receive per serial actor.
3. STOP during a suspended continuation fences new admission but lets its accepted work complete.
4. PANIC while an actor is suspended invalidates further continuation dispatch and accounts all previously admitted messages.
5. Forged/recycled continuation-generation tokens cannot resume old PC or release new actor memory.
6. A forbidden critical-state/borrow across `rt cooperate` must fail at compile time; no execution artifact should be generated.
