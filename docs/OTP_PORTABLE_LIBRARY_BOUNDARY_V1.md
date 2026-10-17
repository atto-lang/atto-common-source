# Portable OTP behaviours and the Oreslang core boundary (v1)

**Status: normative proposed contract, NOT implemented source-level OTP support.** This document complements [OTP_BEHAVIOURS_V1.md](OTP_BEHAVIOURS_V1.md) and the existing Java-side [core/alloc/actor/std boundary](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/CORE_ALLOC_STD_BOUNDARY.md). A source path in the inventory means a required deliverable, **not** that a working `.ores` file exists or that the compiler recognizes the import.

## Resolution: core must stay freestanding; OTP must stay optional

Erlang is the language and primitive process runtime; OTP is a collection of behaviours and applications built on those primitives. We want similar ergonomics **without putting OTP inside freestanding `core`**.

Logical dependency direction (transitive, including implicit intrinsics):

```text
core               (pure scalars, Result, Option, fixed-size data; NO heap/OS)
  ├── alloc         (explicit allocator: arenas/pools; NO OS)
  └── actor         (messages, ActorRef, CONTROL, supervisor identity,
       │             mailbox admission, reply capability, executor protocol)
       └── otp      (optional Oreslang-native behaviours; may also use alloc)
            └── std (host/device adapters and convenience facades)
```

In graph notation: `core <- alloc`, `core <- actor`, `{actor, alloc} <- otp`, `{core, alloc, actor, otp} <- std`; **never** `core -> otp`, `actor -> otp`, or `otp -> std` for portable modules. `alloc` must not require OS malloc; `actor` can be implemented with a statically provisioned, cooperative, single-core executor and bounded mailboxes. `otp` is a separately selected **library layer**, *not* a synonym for the standard library, a mandatory prelude, or a new language keyword.

Physical source layout after the resolver migration:

```text
stdlib/
  core/...
  alloc/...
  actor/...
  otp/
    gen_server.ores
    supervisor.ores
    gen_statem.ores
    application.ores
    event_manager.ores
    registry.ores
  std/...
  std/otp/....            # optional hosted extension facades ONLY, never prerequisites
```

The **canonical import** for these portable behaviours is `otp/<name>`, backed by `stdlib/otp/<name>.ores`. `std/otp/<name>` may be provided as a hosted compatibility facade later but must not be required by a freestanding actor program. Current Java `CoreLibrarySources` only admits `std/*` from a closed packaged registry, and `stdlib/core.ores` is still `std/core`. Thus neither canonical `core/*` nor `otp/*` resolution is currently claimed to work. The resolver, intrinsic registry, prelude and AOT resource registry must migrate together. Do **not** register empty placeholder modules and then advertise OTP support.

## Exact portable module deliverables

| File / canonical import | Required semantics | Optional external services |
| --- | --- | --- |
| `gen_server.ores` / `otp/gen_server` | Typed `call`/`cast`, one-shot reply capability, `init`/`handle_call`/`handle_cast`/`handle_info`/`terminate`, state loan ownership, admitted mailbox/backpressure | Deadline/cancel clock provided by runtime; no ambient wall clock |
| `supervisor.ores` / `otp/supervisor` | Child specs, runtime-authenticated CONTROL failures, restart types `permanent/transient/temporary`, `one_for_one/one_for_all/rest_for_one`, escalation, bounded restart intensity | Tick clock for time windows; policy must have deterministic no-timer alternative |
| `gen_statem.ores` / `otp/gen_statem` | Typed state/event/data, transitions, actions, deferred-event limits, state enter/exit, deterministic dispatch | Injected timers only |
| `application.ores` / `otp/application` | Typed application spec, acyclic dependency validation, supervised start, reverse stop, failed-start rollback | Persistence/release deployment is NOT part of portable Application |
| `event_manager.ores` / `otp/event_manager` | Typed handler registration, ordered local dispatch where promised, bounded fanout/handler budgets and failure containment | No mandatory network/logging |
| `registry.ores` / `otp/registry` | Bounded local names and group registrations, actor incarnation/epoch fencing, capability-scoped lookup, teardown removal | No mandatory distributed discovery |

Proposed expansion: `otp/release` is a separate capability-gated hot upgrade orchestration library; `otp/shared_table` is an owned/quotad ETS analogue that needs `alloc` (or fixed slots) and explicit access grants; a Mnesia-like transactional distributed store is a distinct **hosted** package. Never claim equivalence from an ordinary hashmap or process-local dictionary.

The behaviours remain **Oreslang source modules** (with callback signature/type checking performed by the language compiler), while a deliberately small privileged runtime implements opaque reply identity, admitted mailboxes, failure CONTROL, incarnation fencing, executor wakeups and actor lifecycle. No ordinary guest code can mint or forge a CONTROL event, reply token, supervisor identity or process owner. Neither callback code nor a public `call` method may directly invoke another actor's user handler.

## Serial behaviour versus concurrent actor configuration

A `GenServer` / `GenStateMachine` instance is **serial by contract**, even when the general Oreslang actor model permits a configured `max_threads > 1`. A behaviour must reject multi-executor admission (or prove an explicitly equivalent serialized state transition protocol); do not silently allow multiple handlers concurrently mutating state. Outstanding client requests, accepted mailbox messages and async waits are separate from simultaneous execution. A suspended handler may release a carrier thread but must preserve exclusive logical state-turn semantics.

The runtime must specify self-call deadlock rejection, cancellation of waiters without retroactive un-admission of an accepted message, one-shot reply completion, duplicate/late reply rejection, control queue starvation bounds and terminated-incarnation fencing. Reply acknowledgements are admission receipts, not execution/delivery guarantees.

Supervisor scope and ActorGroup membership stay separate; spawning a child cannot forge supervisor ownership. A supervisor must bind a child spec *before* actor publication and observe exactly one terminal failure per incarnation. Restart order is deterministic, intensity/period counters are bounded, and exhaustion escalates to parent without busy-looping.

## Bare-metal profile matrix (planned admission rules)

| Build profile | What is allowed | What is not silently imported |
| --- | --- | --- |
| `freestanding-core` | `core` | heap, executor, OS, OTP |
| `freestanding-alloc` | `core + alloc` with supplied allocator | OS malloc / std |
| `freestanding-actor` | `core + actor`, optionally `alloc` | OS thread/clock/stdio/network |
| `freestanding-otp` | above + **selected** portable `otp` modules with a supplied bounded actor executor and capacities | filesystem, sockets, host reflection, mandatory timers or heap |
| `hosted` | preceding layers + capability-granted `std` adapters | implicit privileges; network or fs still need explicit grants |
| `hardware-synthesis` | separately verified statically bounded synthesizable subset of `core`; finite state machines may lower only under a restricted hardware model | dynamic actors, scheduler, heap, networked OTP, uncontrolled code upgrade |

The compiler must reject unsupported target/profile/mode combinations **before** generating code, rather than accepting unsupported annotations as no-ops. The `freestanding-otp` name and manifest settings are **proposed**, not parser syntax or an implemented CLI switch. An MCU may require a supplied timer, static mailbox ring, interrupt hook and allocator; "no OS" does not mean "no runtime".

The companion `contracts/otp-library-layout.v1.json` is the machine-readable target inventory. Its `implemented: false` entries intentionally prevent a manifest from being confused with a released implementation. The checked test validates the *contract structure only*; it does not validate `.ores` compilation, privilege isolation or runtime behaviour.

## Verification and promotion gates

1. **Core closure:** compile/link freestanding `core` with no `std`, libc, malloc, OS entrypoint or imports; reject transitive forbidden imports, host intrinsics, project shadowing and unknown sources.
2. **Actor portability:** guest-source spawn/send/receive under fixed-capacity statically provided executor/mailboxes; inspect native linked symbols; prove saturation, cancellation, CONTROL and teardown; no mandatory `pthread`, syscalls, OS clock or Java reflection.
3. **OTP source:** compile the **real six packaged `.ores` modules**, bind their callback/type contracts and execute guest source. Validate package provenance in JIT, Native Image/AOT and LLVM source pipelines. A Java host-only actor test is not a substitute.
4. **GenServer:** 100 clients, serial linearizability, typed wrong-variant rejection, forged/duplicate/late reply rejection, self-call, saturation, cancellation and deadline races.
5. **Supervisor:** three strategies, three restart types, nested supervisor escalation, max-intensity exhaustion, grace stop, startup failure, group close and exactly-once CONTROL.
6. **State manager, application, event and registry:** transition/deferred-event overflow, deterministic start/stop/rollback, fanout backpressure/handler failure, stale-incarnation registry lookup and revoked capability.
7. **Cross backend:** exact-head Java/LLVM guest tests, negative compile fixtures and reproducible runner evidence; only claim profiles with actual freestanding link/map and runtime proofs. Any missing executable backend remains **pending**, never passing.
8. **Isolation/hot upgrade:** private/shared/untrusted actor quotas, ABI validation, generation-pinned continuations, stage/activate/rollback and no stale routing; put release policies behind separately declared target support.

Related open work: [Java supervision #640](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/640), [Java OTP source lowering #641](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/641), [LLVM native supervisor #174](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/174), [OTP guest-source conformance suite](https://github.com/ores-truffle-oreslang/oreslang-hot-loading-tests/pull/1). These are **partial work**, not proof that the six OTP behaviours are complete.

## Separation from hardware compilation

Oreslang can target ASIC/FPGA only through a separately verified bounded synthesis subset and RTL backend. `gen_statem`'s **finite transition logic** may be an HLS candidate if fully statically bounded, but neither Erlang's BEAM nor full Oreslang OTP supervision, dynamic actors or distributed storage becomes synthesizable merely by compiling to LLVM. See [HARDWARE_SYNTHESIS_V1.md](HARDWARE_SYNTHESIS_V1.md).
