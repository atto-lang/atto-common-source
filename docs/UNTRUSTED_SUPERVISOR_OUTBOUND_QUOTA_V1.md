# UNTRUSTED -> parent/supervisor outbound quota v1

**Status:** proposed contract; no backend enforcement or executed guest conformance is claimed.
Tracking: [common #69](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/69), [Java #1265](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1265), [LLVM #589](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/589), [conformance #87](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/87).

## Trust and placement

Only the trusted runtime transport admission layer owns and mutates quota state, clocks, supervision identities, capability routing and mailbox reservations. Nothing exposed to an UNTRUSTED actor (including actor-local arena, host bridge, ActorRef, serialized envelope, hot-reload hook or API parameter) is an enforcement authority. A private arena is not a memory-protection boundary; LLVM's raw in-process UNTRUSTED scheduler domain remains unfit for arbitrary untrusted native machine code.

In GraalVM keep the designated pooled untrusted engine/isolate: **do not allocate an isolate per actor**. The runtime must authenticate the source execution context rather than accept a sender ID from the guest. Verify that *all* parent-bound user delivery routes (send, respond, output, proxy, FFI/IPC) funnel through admission. An internal helper that is not connected to every send path is only a prototype.

## Hierarchical admission

Each delivered user message consumes **one message token, serialized wire bytes, and one bounded outstanding credit** at every applicable scope:
- stable supervision-child lineage (not ephemeral actor incarnation), including an inherited descendant aggregate,
- destination supervisor and route,
- tenant/global budget.

An actor cannot replenish quota by restarting, hot reloading, spawning, joining a group or changing destination refs. CONTROL may raise limits only through privileged, authenticated supervisor policy; guests never receive writable policy state or raw host handles. Atomic multi-scope admission must reject without charging when any level refuses. A **provisional reservation rejected internally before publication** may roll back all scopes together under the same trusted gate lock. However a **published reservation retains its start-rate token charge even if it is later cancelled or the network operation fails**, otherwise the caller could accumulate refundable reservations and mint new bursts after the clock refills. Outstanding concurrency/byte storage credits (not sustained-rate tokens) are released on completion/cancellation, with exactly-once settlement on drain and retirement. No partial scope charging, double-spend, overflow or underflow. Shutdown/revocation must prevent new reservations and deterministically settle in-flight ones.

Use a trusted monotonic clock (integer nanoseconds). Clamp backwards readings; reject unknown/missing clocks and inconsistent policy, avoid time overflow, bound bursts and avoid double refill. A token bucket bounds *average* rate plus burst, **not** an exact rolling 1-second maximum; use a separately specified sliding window if strict any-second guarantees are requested. Suggested *illustrative*, not production-validated knobs: 20 messages/s, burst 5, 64 KiB/s, 32 outstanding per child, plus supervisor/tenant aggregates.

Apply size limits before allocating/copying large input. Never park CONTROL or a carrier thread while throttled, never queue denied sends without a separate bounded reservation. Return deterministic RateLimited/Backpressure/CapabilityDenied/Closed outcomes (language API lowering remains a separate decision). Charge expensive rejected attempts against actor CPU/fuel budgets.

## Independent runtime-originated control

Genuine panic/exit/stop/cancel notifications travel through an **authenticated, separately bounded** runtime control path not charged to user message quota. It is impossible for guest data to claim that lane. Coalesce repeated failures, bound restart storms, and maintain supervisor liveness even when user data traffic is exhausted. The control lane is not an unrestricted escape route.

## Allocation tiers

Freestanding `core` contains only optional policy/semantic types and does not require heap, OS or monotonic clock. Concrete clock, bucket storage, mutex/atomic and transport hooks belong to the trusted runtime/`alloc` tier. Optional `stdlib/otp/supervisor` owns configuration/escalation interfaces, **not** admission enforcement. LLVM must avoid tracing GC; Java/GraalVM should minimize GC but may retain trusted managed bookkeeping.

## Evidence required before ready-for-review

- Test adversarial sends from a *real* UNTRUSTED guest, not a host helper invoking itself; confirm route coverage and physical isolation separately.
- Simultaneous send races, N+1 burst/refill, byte overflow, rollback/ack, full mailbox, monotonic rollback, restart, fanout, spoofed identity, control spoof/real panic, shutdown races, and actual runtime no-guest-escape assertions.
- Native sanitizer builds and Java isolated-guest tests; attach exact commit SHAs and executed test logs. A schema/model test is not execution parity.
- Unsupported protected execution must fail closed, including LLVM's raw in-process scheduler domain.

## Additional outbound network budgets (proposed; NOT yet enforced)

Default UNTRUSTED egress budgets (tunable only by trusted supervisor policy):

| Budget | Initial default | What consumes a slot |
| --- | ---: | --- |
| HTTP starts | 10 starts/s (burst 2) | Every outgoing HTTP request dispatched, including retries and redirects |
| HTTP concurrency | 10 in flight | Until response is fully consumed, aborted, cancelled or timed out |
| Raw outbound TCP live sockets | 10 | From reservation before DNS/connect through actual socket close |
| TCP connection starts | separately configurable | Opening attempts, including failures and rapid reconnect loops |

HTTP requests/s and concurrency are **independent limits**. A static token bucket does not enforce a strict rolling second unless a sliding window is added. HTTP/2 streams each count against in-flight HTTP requests even when multiplexing onto one socket; physical sockets must still count against any configured *total egress socket* cap, including pooled HTTP keepalive connections.

The network broker must authenticate originating actor, enforce network permissions on the original hostname and resolved IP, prevent DNS rebinding and SSRF, disallow unreviewed redirects, block raw FFI/socket bypasses, and reserve quotas **before** DNS, TCP connect or HTTP dispatch. An untrusted actor cannot configure its own limits or counters or call a privileged broker API without a supervisor-provided capability. On guest cancellation, wait for the host operation's actual terminal state (or forcibly close it) before refunding any live connection credit. RAII/AutoCloseable alone is not proof of proper async lifetime.

**Current Java untrusted actors have zero ambient network capabilities, and LLVM raw native UNTRUSTED execution is not isolated. Preserve both fail-closed defaults.** The contract and host helper are not permission to relax those restrictions. Existing tracing / metrics/logging cannot become an unrestricted unaccounted outbound path.

## Audit correction: delayed cancellation cannot mint bursts (2026-10-17)

A previous token refund rule admitted a credit-laundering attack: reserve two starts at t=0, refill two by t=1s, consume those, then cancel the original two to mint another two starts at the same instant. Thus **published reservations always spend start-rate tokens**, even when never submitted; only concurrency/socket slots return on cancellation. Partial reservations rejected internally before visibility may roll back token charges atomically. Revocation must reject already-reserved but *not yet committed* operations; committed I/O must be cancelled and drained by the trusted broker. Pre-allocate lease/envelope objects before changing quota state wherever possible so host allocation failure cannot strand credits.
