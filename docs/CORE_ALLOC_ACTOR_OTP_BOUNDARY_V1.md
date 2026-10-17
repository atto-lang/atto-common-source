# Freestanding core and optional OTP standard library — contract v1

**Status: normative layout and admission requirements only.** This document does **not** claim six Oreslang OTP modules have been implemented, compiled or executed. See [OTP behaviours proposal](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/65) in open RFC #65 for callback and runtime details (until merged).

## Decision

`core` is freestanding: compiling or linking it must not need Linux, POSIX, libc, JVM, an OS allocator, a scheduler, a filesystem, a clock, threads, sockets or runtime initialization. Scalar values, fixed layouts, `Option`/`Result`, ownership/effects and panic/abort contracts belong here. No heap is required.

`alloc` is optional, explicit allocation: callers furnish the provider/arena; no implicit ambient allocator. `actor` is optional and OS-independent: it needs a **provided** scheduler/executor and bounded mailbox storage. Actor-only deployments MAY use fixed slots/arenas and never import `alloc`. The CONTROL lane is runtime-owned, distinct from USER/DATA; library code does not create privileged CONTROL messages.

`stdlib/otp` is an **optional library behaviour tier above `actor`**, not a built-in part of `core` and not an OS dependency. Consumers can choose a static fixed-capacity variant or pass an explicit allocator as necessary. A hosted OS adapter can provide clock/threads/IO, but OTP behaviour code itself must never call the host directly. Even a target that does not support actors must still compile `core`.

`stdlib/io`, `stdlib/fs`, `stdlib/net` and `stdlib/process` are separately gated host-capability adapters, never dependencies of the six OTP modules. These names are conceptual namespace layout; existing backend packaging/import spellings remain separately gated.

## Exact public module inventory

| Future import path | Behaviour | Mandatory provider surface (conceptual) |
| --- | --- | --- |
| `stdlib/otp/gen_server.ores` | `GenServer<State,Call,Reply,Cast>` | typed serial actor, bounded USER inbox, one-shot correlation-safe reply |
| `stdlib/otp/supervisor.ores` | `Supervisor<Spec>` | lifecycle authority, authenticated CONTROL failures, restart accounting |
| `stdlib/otp/gen_statem.ores` | `GenStateMachine<State,Event,Data>` | serial actor, typed transition/action, optional explicit timer |
| `stdlib/otp/application.ores` | `Application` | startup order, dependency DAG, rollback/stop, supervisor ownership |
| `stdlib/otp/event_manager.ores` | `EventManager<Event>` | typed bounded subscriptions, admission/backpressure, handler failure policy |
| `stdlib/otp/registry.ores` | `ActorRegistry<Name,Ref>` | scoped names, actor incarnation fencing, revocation/unregister |

`gen_event` is represented by `event_manager`, not a seventh independent primitive. Process groups (`pg`) build on `ActorGroup`; membership must **never** grant supervision authority. Release management, ETS and distributed stores are follow-on modules, not implicit dependencies of these six.

## Freestanding build and capability discipline

1. **Source/import closure:** compiler resolves every direct/transitive import, effect and target requirement before emitting code. `core` cannot import `alloc`, `actor`, `stdlib`, Java interop or an OS/host intrinsic, including through generated code.
2. **Explicit providers:** `actor` requires a scheduler/executor, mailbox storage and trusted lifecycle CONTROL capability supplied by the embedding runtime. Calls requiring time (restart intensity windows, deadlines, state timers) require a monotonic clock provider; without one they must reject or disable the particular timed feature, never silently consult a wall clock.
3. **Bounded execution:** fixed slots, bounded mailboxes, bounded event-handler sets, finite restart budgets and eventual cancellation/teardown; no unbounded busy restart loops, hidden threads or invisible retries. Backend may require `alloc` for a chosen dynamic policy, but not by default for `core`.
4. **Ownership and trust:** actor-owned state is sealed; refs and response capabilities are generation-fenced; no raw pointer/object/OS handle, live reply token or forged CONTROL passes via ordinary sendable payload. A `cast` receipt means *admission*, not processing or delivery.
5. **No keyword proliferation:** behaviours are Oreslang-authored library modules over existing actor, channel/future and CONTROL intrinsics. No `gen_server`/ `supervisor` special compiler keyword is required.
6. **Profile intent:** `freestanding-core` uses only `core`; `freestanding-actor` adds explicit actor runtime providers; `freestanding-otp` adds the six behaviours when their individual requirements exist; `hosted` may additionally grant OS adapters. These are contract profiles, **not** claims that the compiler supports these profile names or syntax today.
7. **Build opt-out syntax:** Rust's `#![no_std]` is an analogy, not accepted Oreslang grammar. Until explicit attributes/effects are implemented, use a versioned target/import manifest for test/admission intent. A future source attribute requires its own syntax RFC and parser tests.

## Milestones / evidence

- G0: canonical inventory + dependency/effect manifest, versioned conformance fixtures and static validation. G0 is **not** an executable OTP library.
- G1: six concrete `.ores` source implementations (initially GenServer), admitted through the Oreslang stdlib module resolver; compile and run **real guest-source** tests on Java/Graal. The packaging registry must explicitly allow these modules; no classpath ambiguity.
- G2: Supervisor CONTROL, child specs and restart/teardown fault injection; then gen_statem, application, event_manager and registry. Each advertised module needs real handler-level execution and negative admission tests.
- G3: LLVM/native parity (continuations, typed mailboxes, reply/cancel, CONTROL), plus separate tests proving that bare-metal `core` needs no OS/libc/allocator. A Cortex-M scalar AOT or C mailbox reference does **not** certify source-level OTP.
- G4: execute constrained OTP on actual freestanding actor hardware/RTOS with fixed-capacity profiles; examine RAM/stack, restart exhaustion, power failure and stale incarnation tokens.

CI must distinguish: `contract-pass`, `source-compilation-pass`, `runtime-executed-pass`, and `embedded-hardware-pass`. **Only the latter evidence proves corresponding implementation claims.** Pin compiler/backend commits and never export private source trees to unrelated orgs without approval.
