# AttoLang actor runtime loops — reference safety contract (candidate v1)

**Status:** source-free transition oracle plus executable model tests. **Not** a production NIO reactor, worker scheduler, compiled Atto guest, or OS isolation proof. Existing `contracts/actor-trace-v2.json` remains authoritative for observable actor CONTROL precedence.

## Responsibility boundaries

| Subsystem | Owns | Must not do |
| --- | --- | --- |
| **NIO reactor** | Kernel readiness registration, one-shot disarm/rearm, cancellation, wakeup and deadline transport | Execute guest handlers, block on a mailbox, or free an actor's memory |
| **Carrier-thread scheduler** | Bounded runnable queues, worker admission, serial-actor exclusion, fair round-robin among eligible DATA actors | Process supervisor panic as ordinary actor DATA; reuse stale continuation frames |
| **Supervisor control loop** | Priority CONTROL queue, termination policy, incarnation fencing, drain/cancel orchestration | Run guest handlers or let a full DATA inbox block CONTROL admission |
| **Mailman/broker** | Message envelope ownership, mailbox admission and delivery receipts | Treat successful enqueue as successful handling or settle by unscoped message ID |

No carrier thread may hold a critical actor-state loan while blocking in a kernel selector. A scheduler may have multiple carriers, but a serial actor has **at most one** outstanding receive turn; a nonserial actor requires separate validated logical stacks and shared-state lease gates.

## Reactor: cancellation and lost-wakeup protocol

- Register with an immutable token including actor ID/incarnation, OS handle, and monotonically changing registration generation. A raw numeric fd is **not** registration authority. An old ready event or cancel must not affect a recycled descriptor.
- A readiness signal disarms the one-shot registration and records at most one pending event. Rearm only after that readiness has been consumed and a fresh interest decision made. Repeated kernel notifications must not enqueue duplicates.
- Park is legal only after checking the pending work predicate; a concurrent enqueue must wake or invalidate the impending sleep. Real implementations need an atomic arm/check/park handshake and level/edge-triggered validation; the deterministic model cannot prove the memory ordering.
- If mailbox admission is full, **keep pending readiness** and retry when capacity is available; do not busy-spin, drop readiness, or permanently disable the channel.
- Cancellation and actor retirement invalidate registration tokens. Registered kernel resources and pinned buffers must be revoked only after in-flight operations quiesce; do not use `close(fd)` as proof that another thread has ceased using the fd.

## Scheduler: admission and shutdown

- DATA admission has one linearization point. Rejected mail retains payload ownership at the sender; accepted mail has one of queued, running, completed, failed, abandoned.
- Ready actors are queued once; a serial actor runs no second receive while one is in flight. Round-robin among runnable DATA actors bounds interference when no CONTROL is pending; a production runtime also needs per-tenant quotas, watchdog budgets and time limits.
- `await` / `select` suspension must park a logical continuation rather than block the carrier. Borrowed memory, stack handles and locks crossing suspension need explicit compiler proofs.
- Graceful STOP fences new admission while draining accepted work. PANIC immediately fences new dispatch, abandons queued mail with accounting, and waits for running turns to fail/acknowledge cancellation. **Never reclaim arena/stack memory before physical quiescence.**

## Supervisor control and the three meanings of `select`

**Do not confuse:** (1) OS/NIO selector readiness, (2) runtime supervisor event arbitration, and (3) the Atto language `select` expression/statement. They are distinct implementation boundaries, even if the compiler eventually lowers an actor `select` into the runtime.

Per the existing actor-trace-v2 contract, an admitted supervisor CONTROL notice is dispatched **before** any new DATA receive start. Priority is strict, not randomized or round-robin across CONTROL and DATA. Within DATA, preserve fair actor scheduling. CONTROL flood can delay DATA indefinitely; mitigate with finite generation-scoped pending slots, event coalescing, rate limits, supervised overload policy and explicit admission errors—not by silently demoting pending PANIC notices. A STOP-to-PANIC escalation must preserve the stronger reason. The reference supports one pending terminal notice per actor incarnation and fails on CONTROL capacity exhaustion; a production fault path must escalate an exhausted reserve without dropping fatal notices.

## Mailmen and delivery semantics

- Carry actor incarnation, message ID, ownership state, and, for external brokers, channel/subscription generation and lease tag. ACK must settle **that exact lease** once.
- `send` / `try_send` success means admission only; completion is a separate event and `get_done()` is not synthesized from admission.
- A full or closed mailbox must reject atomically without consuming the sender's buffer/affine reference. A crash/disconnect must either produce a typed outcome or retain recoverable unsettled identities; no silent loss or double settlement.
- Mailmen may perform wire I/O and broker routing, but must never execute actor guest code on a reactor or supervisor thread. Network delivery retries are at-least-once unless backed by a durable deduplication protocol; do not claim exactly-once consumer side effects from ACK accounting.

## Evidence gates

`reference/runtime_loops.py` and `reference/test_runtime_loops.py` exercise deterministic edge-case sequences for generation fences, FIFO/round-robin, pending one-shot readiness, backpressure, strict CONTROL ordering, STOP/PANIC escalation, admitted-message conservation and idempotent settlement. They **do not** establish thread safety or actual NIO behavior.

For Java/GraalVM, LLVM, .NET, Wasm, Rust/Cranelift and Forge, request independent executable proofs before declaring runtime parity:

1. Run 4+ concurrent producers and multiple tenants through a bounded mailbox while checking exact admitted/settled counts and neighbor progress.
2. Perturb real selector registration/cancellation/close/wakeup orders, including fd reuse, capacity exhaustion, in-flight close and timers. Assert no lost wakeups, busy loops or duplicate dispatch.
3. Force a guest panic while CONTROL and DATA queues are saturated; demonstrate priority, no reentry, fencing, supervisor acknowledgement and physical quiescence before arena release.
4. Run native memory safety tools (ASan/UBSan/TSan where supported), long-run soak, blocked-worker watchdog and deadline tests; provide actual log/trace evidence and zero skipped-required steps.

Use immutable SHA-pinned source and compiler receipts. Mark each backend **PASS / FAIL / UNSUPPORTED / NOT_EXECUTED**, with no promotion from source-free model evidence to guest-runtime certification. If source GitHub Actions cannot execute, use an approved private exact-tree mirror and verify every source blob before claiming equivalent CI evidence.
