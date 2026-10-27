# Freestanding core and optional OTP standard library — contract v1

**Status: normative layout and admission requirements only.** This document does **not** claim eight Oreslang OTP modules have been implemented, compiled or executed. See [OTP behaviours proposal](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/65) in open RFC #65 for callback and runtime details (until merged).

## Decision

## Public library profiles

Oreslang has **exactly two public library profiles**:

| Profile | Contract |
| --- | --- |
| `core` | Freestanding/no-OS library surface. It must remain linkable without an OS, libc, ambient allocator, scheduler, filesystem, sockets, process APIs, or runtime initialization. |
| `std` | Hosted/platform library surface. It builds on `core` and may expose explicitly admitted OS/platform services. |

Allocation, actor execution, OTP behaviours, clocks, and related services are explicit **provider/capability families**, not additional library layers or public profiles. Canonical compiler-owned library imports live under `ores.core/*` or `ores.std/*`. A `core` build may opt into caller-provided allocation, a bounded actor executor, or OTP behaviours without becoming `std`, provided the complete transitive closure remains OS-independent.

Backends must reject profile/target combinations they cannot actually certify rather than silently weakening the requested profile. The public profile vocabulary is therefore just `core` and `std`; older contract-only names such as `freestanding-core`, `freestanding-actor`, `freestanding-otp`, and `hosted` are superseded as public profile names.

The `core` **layer** is freestanding: compiling or linking the base layer itself must not need Linux, POSIX, libc, JVM, an OS allocator, a scheduler, a filesystem, a clock, threads, sockets or runtime initialization. Scalar values, fixed layouts, `Option`/`Result`, ownership/effects and panic/abort contracts belong here. No heap is required.

Explicit allocation is a provider requirement, not a library layer: callers furnish the allocator/arena and no ambient allocator is implied. Host-independent owned strings, vectors, maps, JSON trees, codecs, or similar dynamic facilities may remain in `ores.core/*` when their compiler-inferred closure requires only an explicit allocator provider. Hosted I/O/network adapters belong in `ores.std/*` and may feed bytes to or consume bytes from those core facilities, but `ores.core/*` may never import `ores.std/*`. There is no canonical top-level `alloc/*` library namespace.

Actor execution is optional and may remain in `ores.core/*` when it needs only explicitly provided executor/scheduler authority, bounded mailbox storage, trusted CONTROL capability, and optional allocator/monotonic-clock providers. Hosted thread, process, filesystem, network, or wall-clock adapters belong in `ores.std/*`. The CONTROL lane is runtime-owned, distinct from USER/DATA; ordinary library code does not manufacture privileged CONTROL messages.

`stdlib/otp` is the physical source location for optional OTP behaviour modules. Logically those modules are part of the `core` library layer when their provider/effect closure is host-independent; OTP is not a third library layer.

The physical layout is `stdlib/otp/<module>.ores`, while the canonical logical import is `ores.core/otp/<module>` (for example `ores.core/otp/gen_server`). The older `std/otp/*` Java draft spelling is transitional only and must never create a second module identity. A closed compiler-owned resolver plus AOT resource registration is required before these imports are advertised as implemented. Consumers may use fixed-capacity storage or explicit allocator/clock providers as necessary. Hosted OS adapters can supply threads, I/O, networking, or wall-clock services only through `ores.std/*`; OTP behaviour code in `ores.core/*` must never acquire them implicitly.

`ores.std/io`, `ores.std/fs`, `ores.std/net`, and `ores.std/process` are separately gated hosted capabilities and are never dependencies of the eight core OTP modules. The canonical eight physical distribution paths remain `stdlib/otp/*.ores`; the logical import namespace is `ores.core/otp/*`. Compiler resolvers must explicitly map those paths, reject missing modules, and never fall back to project, ambient filesystem, or classpath resolution.

## Import namespace staging audit (2026-10-17)

The future portable canonical import is **`ores.core/otp/<module>`**. Java/Graal draft
PR [#1216](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1216)
currently admits **`std/otp/<module>`** for the original six pure source protocol/policy
slices. This is a transitional Java resolver spelling, **not** proof that
`otp/*` works or that any GenServer/supervisor actor behaviour is complete.
LLVM draft [#560](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/560)
rejects OTP imports fail-closed until source module linking is implemented.

Migration gate: implement a closed compiler-owned `ores.core/otp/*` resolver with exact
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

1. **Source/import closure:** the compiler resolves every direct/transitive import, effect, provider requirement, and generated-code edge before emitting code. `ores.core/*` may import only `ores.core/*`; `ores.std/*` may import `ores.core/*` or `ores.std/*`. No hosted target selection can retroactively make `ores.core -> ores.std`, Java interop, project/ambient source, or an OS/host intrinsic legal.
2. **Explicit providers:** allocator, actor executor, bounded mailbox, trusted lifecycle CONTROL, and monotonic-clock requirements are compiler-inferred provider demands rather than library layers. Missing providers fail closed. Timed features must never silently consult an ambient wall clock.
3. **Bounded execution:** fixed slots, bounded mailboxes, bounded event-handler sets, finite restart budgets and eventual cancellation/teardown; no unbounded busy restart loops, hidden threads or invisible retries. A chosen dynamic policy may require `allocator.explicit`, but no allocator is implied by the `core` layer itself.
4. **Ownership and trust:** actor-owned state is sealed; refs and response capabilities are generation-fenced; no raw pointer/object/OS handle, live reply token or forged CONTROL passes via ordinary sendable payload. A `cast` receipt means *admission*, not processing or delivery.
5. **No keyword proliferation:** behaviours are Oreslang-authored library modules over existing actor, channel/future and CONTROL intrinsics. No `gen_server`/ `supervisor` special compiler keyword is required.
6. **Profile intent:** the public profile vocabulary and library-layer vocabulary are exactly `core` and `std`. `core` is the freestanding/no-OS surface and may use explicitly granted allocator, actor, OTP, or clock providers without gaining hosted authority. `std` additionally admits hosted/platform adapters. Provider families are not library layers or public profiles.
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
