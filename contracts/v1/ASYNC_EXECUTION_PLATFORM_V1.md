# Unified async execution platform v1 — proposed normative contract

**Status:** PROPOSAL / NOT IMPLEMENTED OR RATIFIED. This document specifies observable semantics and admission gates, not a claim of cross-backend support. Draft implementations MUST remain fail-closed for unsupported surfaces. Date: 2026-10-27.

**Design objective:** Ordinary Oreslang source needs no third-party executor, reactor, async runtime, or task scheduler to express or execute supported async work. A compiler may link a target-specific OresVM implementation; execution policies and optional providers vary by target, but observable source semantics must not.

This proposal extends, and does not override, the already normative:
- [Native I/O naming and execution](../../docs/NATIVE_IO_NAMING.md): strict readiness/completion I/O, **no blocking-worker offload**, including for `*_blocking`.
- [Freestanding core and explicit providers](../../docs/CORE_ALLOC_ACTOR_OTP_BOUNDARY_V1.md): exactly two public library layers, `core` and `std`; bounded executors and monotonic clocks are explicit providers, not new public layers.
- [Real-time and AOT qualification](../../docs/REALTIME_AOT_EXECUTION_PROFILES.md): AOT, bounded execution, low GC, and hard-RT qualification are independent proof obligations.
- [Checked exceptional effects](../v2/CHECKED_EXCEPTIONAL_EFFECTS_V2.md): `throws`, `raises`, and `panics` remain distinct; panic is supervisor/process-terminal authority, never a cancellable success.

The portable NIO/physical-turn authority currently lives in [platform-conformance/contracts/v1/NIO_ACTOR_EXECUTION_V1.md](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/main/contracts/v1/NIO_ACTOR_EXECUTION_V1.md). Its pending delta ratification is tracked in [conformance #173](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/173). If a point conflicts, **do not silently broaden the existing contract**; resolve it in review before promotion.

## Foundational rule — one standard execution model, multiple target implementations

**Oreslang MUST provide one standard asynchronous execution model, with target-specific runtime implementations. Application developers MUST NOT be required to assemble, select, or coordinate a Tokio-equivalent userland executor stack to run ordinary, supported Oreslang async code.**

This is a **semantic and library API guarantee**, not a promise of one global OS thread pool or one identical scheduler binary:

1. The compiler owns `async`/`await`, `Task<T>`, `Future<T>`, `select`, source suspension, ownership/effects, and cancellation semantics. A task or Future created by any conforming standard module is awaitable, cancellable where its type permits, and observable through the **same** scheduler, authority, and lifecycle model. The language must not expose runtime-family-specific Future types that fragment compatibility.
2. OresVM owns the standardized executor, I/O readiness/completion integration, timers, admission/backpressure, actor/supervisor lifecycle, and physical retirement contract. Hosted distributions MUST supply the necessary providers for every capability they advertise; applications do not install a separate runtime dependency merely to use standard async networking or channels.
3. Backends MAY use different **implementations**: LLVM/native reactor and bounded carrier scheduling, Java/Graal continuation/runtime integration, .NET Native AOT facilities, WASM host event loops/workers, Forge, or statically provisioned embedded executors. Backend-specific worker topology and tuning may differ; observable task, cancellation, capability, and generation invariants MUST NOT.
4. Freestanding `ores.core` stays OS-independent. Its optional actor/task APIs may require **explicit compile/link-time executor, mailbox, clock, or allocator providers** supplied by the target/platform integrator. Such provisioning is not a competing application-selected async *semantics* stack and MUST NOT introduce ambient hosted dependencies or a new library layer.
5. Libraries MAY add higher-level actor, networking, or concurrency abstractions, but MUST compose with standard Task/Future/Channel/Observable contracts and scheduler/cancellation authority. Third-party scheduling adapters are allowed only through an explicitly checked boundary; they MUST NOT bypass scope ownership, capabilities, physical retirement, or nonblocking-I/O requirements.
6. If a backend cannot provide compliant I/O or a declared async feature, it MUST reject the feature deterministically. It MUST NOT silently switch executors, park an actor/root carrier, use per-operation blocking worker offload, or substitute weaker cancellation/ownership semantics.

**Acceptance gate:** for each supported target, an application using only compiler-owned `ores.core/*` and `ores.std/*` async APIs must compile and execute its advertised Task/Future/Channel/I/O operations **without any third-party async runtime dependency**. The same supported source fixture must preserve terminal and physical-retirement ordering, cancellation, actor generation fencing, and bounded admission across backends. On unsupported targets, compile/admission must fail closed with a precise diagnostic. Executed guest and native-AOT evidence is required before advertising this guarantee.

## 1. Scope, placement, and API staging

- **No additional async runtime dependency:** a backend that advertises async guest support MUST ship the compatible executor/reactor provider itself or statically link a compliant platform adapter. It MUST NOT require source applications to select between incompatible task runtimes.
- **Two existing library layers:** portable, freestanding task/channel primitives may live under `ores.core/*` only with compiler-inferred explicit executor/mailbox/clock/allocator providers; hosted networking/filesystem/process adapters belong under `ores.std/*`. `core -> std` imports are forbidden even on hosted targets.
- **Source API candidates, not accepted grammar or builtins:** `ores.core/task`, `ores.core/channel`, `ores.std/net`, `ores.std/io`, `ores.std/fs`, `ores.std/time`, `ores.std/process`. These do not create new language keywords or imply current resolver support. Stable types and spellings require separate parser/typechecker/resolver tests.
- Actor-local `io.in/out/err/events/meta` is an independent **capability-gated** surface, not a process-global `stdio` alias. An admitted output write receipt may mean **bounded admission**, not physical delivery/flush; completion levels MUST be explicit.
- Standardization fixes semantics, not implementation topology. Backends MAY choose work stealing, bounded cooperative turns, static embedded queues, or host event loops if the same advertised source guarantees hold.

## 2. Task identity, ownership, and structured lifetime

1. Every started guest Task belongs to exactly one authenticated root, lexical TaskScope, actor generation, or supervisor domain. Its identity includes owner/incarnation/generation; guest code cannot forge or transfer these identities.
2. Spawn admission is atomic with capacity reservation, scope-child registration, cancellation-parent attachment, and actor lifetime lease acquisition. Failed admission creates no runnable child. It MUST deliver a typed admission failure and release exactly the resources reserved.
3. Suspended or waiting Tasks do not consume a physical carrier merely by existing. Runnable capacity and pending-work capacity are separate bounded resources.
4. An async helper invocation, named callback, lambda, Future chain, generator producer, or nested `await` preserves **the live lexical scope lineage**, not a stale closure permit or a carrier-local ThreadLocal. M:N migrations MUST NOT change parentage.
5. Normal scope exit closes admission, observes every child outcome, and waits **asynchronously** for physical retirement of admitted descendants; exceptional exit requests cancellation, then observes retirement and propagates uncaught failure according to the declared effect/supervisor contract. No self-join or carrier parking.
6. Detached tasks require a distinct, authorized owning scope and an explicit loss-of-parent-ownership effect; they cannot implicitly keep borrowed actor/local memory alive or bypass quotas.
7. `get_done()`, if exposed as a quiescent completion receipt, MUST NOT settle before terminal outcome, last carrier release, callback/continuation retirement, and descendant lifetime leases are all established. Logical Future settlement and cancellation request are **not** physical-quiescence proofs.

## 3. Cancellation, races, deadlines, and cleanup

1. Cancellation is an idempotent request, **not** rollback and not proof of physical termination. A cancellation reason is safely published before observers see the cancelled state.
2. Cancellation-vs-admission, registration, Future completion, shutdown, and scope transfer are linearized so no admitted Task can be orphaned, resumed twice, silently lost, or prematurely freed. A late observer receives the terminal reason consistently.
3. Progress-sensitive I/O may produce a partial-write/read outcome; cancellation never falsely promises to undo external side effects. Document operation-specific cancellation safety. A transactional guarantee requires an actual atomic provider.
4. Cancellation/timeout removes or safely fences waiter registrations, select losers, reactor interest, and pending completion tokens. Stale descriptor, actor generation, or code epoch callbacks never resume a replacement owner.
5. Cancellation cleanup may suspend, but MUST itself be bounded/owned/accounted and MUST NOT run guest code on a reactor, under actor lifecycle locks, or on an unadmitted carrier. A deadline timeout is not proof that cleanup has finished.
6. Panic is not converted to cancellation or success; it travels on supervisor CONTROL authority. Ordinary throws and raises retain the checked-effects contract. A cancelled task's resource retirement still waits for its outstanding physical work.
7. A monotonic clock is an explicit provider; unavailable clock/deadline semantics reject, rather than silently substituting ambient wall time.

## 4. Readiness/completion-only I/O

1. `ores.std/*` I/O MUST use truly nonblocking readiness/completion for each guest operation. Neither platform threads, virtual threads, fixed pools, nor dedicated workers may hide a blocking per-operation syscall. In particular, filesystem and DNS MUST fail closed if a compliant provider is unavailable.
2. The only permitted host wait in the guest I/O path is a **multiplexed readiness/completion reactor wait**. Reactor callbacks do bounded host bookkeeping only and post completion to the owning scheduler; they MUST NOT execute guest callbacks or arbitrary Future subscribers.
3. `*_blocking` means implicitly suspended source continuation on the **same nonblocking provider**, not a parked thread. Until implicit suspension is compiled, the spelling MUST reject. Bare synchronous I/O names reject. Async names use a typed Future/awaitable contract.
4. Descriptor/operation identities carry owner, incarnation, epoch, and cancellation fence; close/reuse, cancel/complete, host shutdown, and hot-swap races settle once and cannot deliver to stale owners.
5. Admission, bytes, pending completions, deadlines, and backpressure are bounded and quota-accounted. Saturation returns a reasoned failure or separately declared bounded-loss policy. An acknowledgment MUST distinguish admitted, completed, flushed, and durable if applicable.
6. A target lacking a compliant runtime/provider MUST reject unsupported guest I/O before host side effects. Blocking worker offload is not a fallback and must not be described as parity.

## 5. Actor/state and hot-swap barriers

- State is sealed: `critical-read`/`critical-write` authorize scoped state loans; no live mutable actor-state loan crosses `await`, `select`, or other suspension.
- During actor shutdown or generation replacement: stop new admissions, revoke/cancel as required, allow old-generation accepted operations to settle or retire, and prevent any old completion from entering the new generation.
- The old code epoch, actor arena, borrowed views, runtime handles, and supervisor done receipt remain pinned until **physical quiescence**, including scheduler callbacks, pending I/O and descendant task leases. Terminal Future state and actor STOP acknowledgement alone are insufficient.
- CONTROL/failure progress has protected finite capacity independently of DATA saturation. Guest data-plane work may not manufacture CONTROL authority.

## 6. Profiles, native AOT, and fail-closed admission

- LLVM and Java/Graal guest native-AOT profiles MUST compile **all admitted reachable guest async continuations** ahead of the final executable, with no interpreter/JIT fallback in the claimed closure. A host Native Image containing an interpreter is not guest AOT.
- Runtime policy is target-bound configuration, not separate language runtimes: general/throughput, latency, soft-real-time, bounded embedded, deterministic testing, and hardware-qualified strict real-time may make different **explicit** provider demands. These names are explanatory, not already-valid CLI values.
- Strict hard-RT requires a declared target/toolchain/OS/hardware timing proof, bounded WCET/interference, storage, stack, call graph, scheduler, and FFI closure. Unbounded dynamic allocation, unknown waits, unsafe FFI, unresolved network delays, JIT, and unproven OS/GC behavior fail admission. Passing stress tests is not a WCET certificate.
- GraalVM Native Image is not, by itself, hard-RT, near-zero-GC, or complete guest AOT evidence.
- Unsupported scheduling modes, async APIs, multi-turn actors, hosted capabilities, or borrowed-across-await patterns MUST fail closed at the earliest sound static or runtime admission boundary.

## 7. Cross-backend release/verification matrix

For **each advertised feature** and each backend (`java`, `llvm`, `net`, `wasm`, `forge`; optional `js`/embedded where relevant):

| ID | Positive/negative gate | Non-negotiable observation |
|---|---|---|
| ASYNC-01 | Spawn inside scope, exit while child suspended | Scope done waits for child terminal + actual carrier retirement |
| ASYNC-02 | Cancel before, during, after admission (races) | Exactly one outcome; no orphan, double release, or stray resume |
| ASYNC-03 | Parent/helper/Future callback spawns child | Live scope lineage preserved; unowned child rejected |
| ASYNC-04 | Future settle vs await registration vs cancellation | At-most-once owning-domain resumption; no lost terminal |
| ASYNC-05 | Actor STOP with held child carrier | Arena/code epoch/done not finalized early |
| ASYNC-06 | Hot swap with pending I/O and descriptor reuse | Stale epoch completion cannot enter replacement actor |
| ASYNC-07 | One-carrier stalled TCP read + independent runnable task | Other task progresses; no guest carrier parked |
| ASYNC-08 | Cancel/close/read/write/rearm/EOF/partial I/O | One bounded terminal state, partial-progress truth preserved |
| ASYNC-09 | No provider, denied capability, forbidden synchronous name | Fail closed before side effects; no worker-offload fallback |
| ASYNC-10 | Quota exhaustion: tasks/mailboxes/completions/buffers | Bounded rejection, no hidden worker growth or CONTROL starvation |
| ASYNC-11 | `*_blocking` on absent continuation lowering | Reject; on supported profile prove actual suspension over same provider |
| ASYNC-12 | Compile and run real guest `.ores` native executable | Exact source/contract/blob/target/toolchain proof; interpreter fallback excluded |
| ASYNC-13 | Strict-RT unbounded/unknown effects | Static rejection; target-specific WCET/evidence needed for acceptance |
| ASYNC-14 | Suspend while holding mutable actor-state loan | Static rejection |
| ASYNC-15 | Process stdio vs actor-local io | Capability/owner distinction, bounded admission receipt, reserved channels reject |

A static fixture, formal model, host-only test, JSON evidence-shape validator, simulated scheduler, or zero-step workflow is **not** compiler-guest or native execution proof. Each result MUST be classified separately as `not-implemented`, `rejected-as-required`, `contract-only`, `host-model`, `source-compiled`, `guest-executed`, or `native-aot-executed`. Only actual relevant evidence may promote an implementation claim. Record exact source **commit and tree**, contract blob, compiler/runtime hashes, target profile, guest fixture hash, command, exit code, executed job steps, and observed assertions. Never invent run results.

## 8. Implementation sequencing (no duplicate executor)

1. Ratify this contract against NIO conformance #173 and merged strict-I/O/core-provider contracts.
2. Finish Java structured task retirement [#2070](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2070), selector+strict-I/O integration [#2126](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2126), and actor-local I/O [#2111](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2111). Avoid parallel incompatible executor implementations.
3. Land actual negative/positive guest source tests and AOT artifact proofs for Java/Graal and LLVM before calling a standard API complete.
4. Implement/deny each feature explicitly for .NET Native AOT, WASM and Forge, then embedded profiles; do not infer parity from identical contract files.
5. Private-source cross-org CI transfer is forbidden unless the independently approved private-destination security policy and exact-tree provenance gates explicitly authorize it. Source-org zero-step jobs are `NOT_EXECUTED`.

No library feature is generally available merely because this document exists.
