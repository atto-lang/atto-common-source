# Freestanding core and optional OTP standard library — contract v1

**Status: normative layout and admission requirements only.** This document does **not** claim eight Oreslang OTP modules have been implemented, compiled or executed. See [OTP behaviours proposal](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/65) in open RFC #65 for callback and runtime details (until merged).

## Decision

## Public library profiles

Oreslang has **exactly two public library profiles**:

| Profile | Contract |
| --- | --- |
| `core` | Freestanding/no-OS library surface. It must remain linkable without an OS, libc, ambient allocator, scheduler, filesystem, sockets, process APIs, or runtime initialization. |
| `std` | Hosted/platform library surface. It builds on `core` and may expose explicitly admitted OS/platform services. |

`alloc`, `actor`, and `otp` remain real architectural capability tiers and import namespaces where applicable, but they are **not public library profiles**. A `core` build may opt into caller-provided allocation, a bounded actor executor, or OTP behaviours without becoming `std`, provided the transitive closure remains OS-independent.

Backends must reject profile/target combinations they cannot actually certify rather than silently weakening the requested profile. The public profile vocabulary is therefore just `core` and `std`; older contract-only names such as `freestanding-core`, `freestanding-actor`, `freestanding-otp`, and `hosted` are superseded as public profile names.

The `core` **layer** is freestanding: compiling or linking the base layer itself must not need Linux, POSIX, libc, JVM, an OS allocator, a scheduler, a filesystem, a clock, threads, sockets or runtime initialization. Scalar values, fixed layouts, `Option`/`Result`, ownership/effects and panic/abort contracts belong here. No heap is required.

`alloc` is optional, explicit allocation: callers furnish the provider/arena; no implicit ambient allocator. Pure dynamic codecs that require owned growable storage—including JSON—belong here rather than in `core`. `core` may still expose allocation-free JSON-adjacent contracts—token kinds, borrowed-input cursors, caller-provided encode sinks, and static codec markers—provided those contracts neither allocate nor require an ambient allocator. An owned `JsonValue` tree, owned JSON `String`, growable array/object, parser DOM, or generated codec scratch storage is never pulled into the allocator-free `core` closure. The canonical JSON namespace is `alloc/json`: `JsonValue`, owned strings/arrays/objects, parsing, encoding, and generated typed codecs may depend on `alloc` but require no OS capability. Hosted `std/*` I/O/network adapters may feed bytes to or consume bytes from `alloc/json`, but neither `alloc/json` nor its transitive dependencies may import those adapters. A `core` profile can therefore use JSON when it supplies an explicit allocator provider and resource quotas; this does not create a third public profile.

`actor` is optional and OS-independent: it needs a **provided** scheduler/executor and bounded mailbox storage. Actor-only deployments MAY use fixed slots/arenas and never import `alloc`. Dynamic actor and OTP variants may import `alloc` only through a declared optional dependency and an explicit allocator provider; that opt-in does not weaken the freestanding `core` closure. The CONTROL lane is runtime-owned, distinct from USER/DATA; library code does not create privileged CONTROL messages.

`stdlib/otp` is an **optional library behaviour tier above `actor`**, not a built-in part of `core` and not an OS dependency.

The physical layout is `stdlib/otp/<module>.ores`, but the **proposed canonical import** is `otp/<module>` (for example `otp/gen_server`), *not* `std/otp/<module>`. The existing Java packaged resolver currently only accepts `std/*`, so this requires a new closed, compiler-owned `otp/*` resolver plus AOT resource registration. An optional hosted `std/otp/*` facade must not become a dependency of freestanding OTP. These canonical paths are a **proposal**, not currently accepted import syntax or an implementation claim. Consumers can choose a static fixed-capacity variant or pass an explicit allocator as necessary. A hosted OS adapter can provide clock/threads/IO, but OTP behaviour code itself must never call the host directly. Even a target that does not support actors must still compile `core`.

`stdlib/io`, `stdlib/fs`, `stdlib/net` and `stdlib/process` are separately gated host-capability adapters, never dependencies of the eight OTP modules. These names are conceptual namespace layout; existing backend packaging/import spellings remain separately gated. The canonical eight distribution paths are `stdlib/otp/*.ores`; the proposed logical import namespace is `otp/*`. Compiler resolvers must explicitly map those paths, reject missing modules, and never fall back to host/classpath resolution.

## Import namespace staging audit (2026-10-17)

The future portable canonical import is **`otp/<module>`**. Java/Graal draft
PR [#1216](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1216)
currently admits **`std/otp/<module>`** for the original six pure source protocol/policy
slices. This is a transitional Java resolver spelling, **not** proof that
`otp/*` works or that any GenServer/supervisor actor behaviour is complete.
LLVM draft [#560](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/560)
rejects OTP imports fail-closed until source module linking is implemented.

Migration gate: implement a closed compiler-owned `otp/*` resolver with exact
eight-module resource mapping and stable unit identities, then run import,
typecheck and actual guest-source execution tests. Alias compatibility with
`std/otp/*` is a separate explicit decision; never allow duplicate module
instances, shadowed classpath sources, implicit hosted fallback or different
module identities for two spellings.

## Exact public module inventory

| Physical source path | Behaviour | Mandatory provider surface (conceptual) |
| --- | --- | --- |
| `stdlib/otp/gen_server.ores` | `GenServer<State,Call,Reply,Cast>` | typed serial actor, bounded USER inbox, one-shot correlation-safe reply |
| `stdlib/otp/supervisor.ores` | `Supervisor<Spec>` | lifecycle authority, authenticated CONTROL failures, restart accounting |
| `stdlib/otp/gen_statem.ores` | `GenStateMachine<State,Event,Data>` | serial actor, typed transition/action, optional explicit timer |
| `stdlib/otp/application.ores` | `Application` | startup order, dependency DAG, rollback/stop, supervisor ownership |
| `stdlib/otp/event_manager.ores` | `EventManager<Event>` | typed bounded subscriptions, admission/backpressure, handler failure policy |
| `stdlib/otp/registry.ores` | `ActorRegistry<Name,Ref>` | scoped names, actor incarnation fencing, revocation/unregister |
| `stdlib/otp/pg.ores` | `ProcessGroup<Message>` | named/scoped ActorGroup facade, bounded idempotent membership, incarnation fencing |
| `stdlib/otp/ets.ores` | `Table<Key,Value>` family | runtime-owned typed table domain, bounded capacity, atomic operations, explicit access policy |

`gen_event` is represented by `event_manager`, not a separate primitive. `pg` is discovery/membership over ActorGroup, never supervision or consensus; local membership is linearizable while a distributed provider may be explicitly eventually consistent. `ets` is shared runtime-owned table storage, never actor-private heap aliasing. Release management and durable/distributed stores remain separate follow-on facilities.

## Freestanding build and capability discipline

1. **Source/import closure:** compiler resolves every direct/transitive import, effect and target requirement before emitting code. Import-layer edges must be legal **regardless of host target**: `core` cannot import `alloc`, `actor`, `stdlib`, Java interop or an OS/host intrinsic, including through generated code. `actor` and `otp` may import `alloc` only via an explicitly declared optional edge and provided allocator. A hosted compilation flag does not retroactively make `core -> host-adapter` legal.
2. **Explicit providers:** `actor` requires a scheduler/executor, mailbox storage and trusted lifecycle CONTROL capability supplied by the embedding runtime. Calls requiring time (restart intensity windows, deadlines, state timers) require a monotonic clock provider; without one they must reject or disable the particular timed feature, never silently consult a wall clock.
3. **Bounded execution:** fixed slots, bounded mailboxes, bounded event-handler sets, finite restart budgets and eventual cancellation/teardown; no unbounded busy restart loops, hidden threads or invisible retries. Backend may require `alloc` for a chosen dynamic policy, but not by default for `core`.
4. **Ownership and trust:** actor-owned state is sealed; refs and response capabilities are generation-fenced; no raw pointer/object/OS handle, live reply token or forged CONTROL passes via ordinary sendable payload. A `cast` receipt means *admission*, not processing or delivery.
5. **No keyword proliferation:** behaviours are Oreslang-authored library modules over existing actor, channel/future and CONTROL intrinsics. No `gen_server`/ `supervisor` special compiler keyword is required.
6. **Profile intent:** the public profile vocabulary is exactly `core` and `std`. `core` is the freestanding/no-OS surface and may optionally use explicit `alloc`, `actor`, and `otp` providers without gaining hosted authority. `std` adds hosted/platform adapters. `alloc`, `actor`, and `otp` are capability tiers, not public profiles.
7. **Build opt-out syntax:** Rust's `#![no_std]` is an analogy, not accepted Oreslang grammar. Until explicit attributes/effects are implemented, use a versioned target/import manifest for test/admission intent. A future source attribute requires its own syntax RFC and parser tests.

## Milestones / evidence

- G0: canonical inventory + dependency/effect manifest, versioned conformance fixtures and static validation. G0 is **not** an executable OTP library.
- G1: eight concrete `.ores` source implementations (initially GenServer), admitted through the Oreslang stdlib module resolver; compile and run **real guest-source** tests on Java/Graal. The packaging registry must explicitly allow these modules; no classpath ambiguity.
- G2: Supervisor CONTROL, child specs and restart/teardown fault injection; then gen_statem, application, event_manager and registry. Each advertised module needs real handler-level execution and negative admission tests.
- G3: LLVM/native parity (continuations, typed mailboxes, reply/cancel, CONTROL), plus separate tests proving that bare-metal `core` needs no OS/libc/allocator. A Cortex-M scalar AOT or C mailbox reference does **not** certify source-level OTP.
- G4: execute constrained OTP on actual freestanding actor hardware/RTOS with fixed-capacity profiles; examine RAM/stack, restart exhaustion, power failure and stale incarnation tokens.

CI must distinguish: `contract-pass`, `source-compilation-pass`, `runtime-executed-pass`, and `embedded-hardware-pass`. **Only the latter evidence proves corresponding implementation claims.** Pin compiler/backend commits and never export private source trees to unrelated orgs without approval.

## Additional G0 security reference checks

`tests/test_otp_import_closure_contract.py` exercises a parsed-unit **reference model** of closure admission, including hosted-mode core-to-host escapes, missing imports, legal cycles and forbidden-layer edges inside cycles, bounded 4,096-unit/65,536-edge traversal, transitive OTP-to-OS imports, missing actor providers, absent OTP feature primitives, explicit clock requirements and optional allocation. Import cycles are not inherently illegal library dependencies; the real compiler separately enforces static initialization safety and source import validity. These tests do not parse or execute any `.ores` source. An actual compiler must derive imports, effects and generated-code edges itself and must prove the same cases with real positive and negative guest fixtures.

## October 17 implementation status — staged, not promoted

Java/Graal [OTP PR #1216](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1216)
now carries a draft closed `otp/*` resolver mapping to the same packaged
sources and linked unit IDs as `std/otp/*`. This is **branch-local source**,
not merged/released or runner-verified. Therefore this common-source manifest
continues to report `sourceImplementationAvailable=false` and pending
full-behaviour implementation; this is intentional rather than ignorance of
the Java branch. It is not a freestanding LLVM module linker.

Java's [GenServer CallPort bridge](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1216)
also stitches an internal one-shot reply ledger to `OresFuture` for
host/runtime-only use, but **does not yet dispatch actual guest handler
messages**. Authenticated CONTROL supervisor and restart orchestration,
source-level call/cast APIs, semantic effects validation, native typed module
linking, and physical bare-metal proof are still required separately.

A private funded test-org G0 run verifies exact **source-free** metadata and
reference-model Git blobs only; it is not an exact compiler Git-tree mirror or
evidence of OresVM execution. The required evidence labels remain distinct.
