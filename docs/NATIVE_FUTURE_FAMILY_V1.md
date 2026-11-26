# Native Atto Future family — ownership hardening v1

**Status: proposed native `.atto` contract, NOT_EXECUTED in compiler guest runtimes.** This revision corrects an ownership hole in the initial adapter signatures. Under the proposed implicit-argument-borrow rules, an ordinary nonprimitive formal may be only borrowed. Awaiting a borrowed one-shot receipt would either illicitly consume a borrowed value or permit a second consumer. The hardened adapter therefore requires an explicit `take!` *formal* and an explicit `take!` *call-site* on every transfer.

**Canonical native source:** `stdlib/std/future_family.atto`. This is public library functionality in Atto, not Java/C++/JS. `Future<T>`, `TaskFuture<T>`, `ActorFuture<T>` are still compiler-sealed, nonforgeable affine types; this module supplies no public constructors and does not implement raw scheduler/actor authority. The runtime only supplies sealed low-level suspension, token validation, CONTROL escalation and physical retirement primitives.

## Contract and usage

```atto
import module future_family from "stdlib/std/future_family.atto";

pub susp fnc main(): int {
  val TaskFuture<int> child = task<int> { return 42; };
  return await future_family.await_task(take! child);
}
```

This moves **the entire `TaskFuture<T>` handle** to `await_task`. The caller loses both the result receipt and all control methods. If the caller wants to keep cancellation/cooperation rights, it must split the result first:

```atto
val TaskFuture<int> child = task<int> { return 42; };
val Future<int> result = child.get_ready(); // unique result-right projection
child.cooperate(); // still allowed while the task control right is live
val int value = await future_family.await_future(take! result);
child.cancel_task(); // terminal no-op if already completed
```

`await_actor_result(take! reply)` returns the exact `Result<T,E>` payload, without catching supervisor panic/raise, transforming an `Err`, implicitly flattening nested `Future`, or turning an `ActorStream<T>` into a unary future. Actor incarnation and one-shot bearer authentication must be validated by a trusted runtime provider. Producer stoppage revokes outstanding reply rights before supervisor CONTROL notification. No retry can replay a terminal reply.

## Layering and compiler requirements

`core` remains freestanding: no `await`, scheduler, heap, host import or authority constructor. `alloc` may own payload storage but no scheduler/actor right. `std` hosts the native Atto suspension adapters, independent of the host-language backend. Backend-specific C++/Java/Rust/JS is limited to sealed ABI operations, not the public Future API.

**Compiler admission is NOT VERIFIED** for `take!` on generic Future-like types or consuming parameters that live across a `susp` boundary. The current separately drafted ownership spec proves a bounded synchronous class case, not all future generics. Until each compiler establishes owned-formal metadata, live loan checking and exact one-time await, it must reject unsupported imports/calls with no guest artifact. A source-only pass is not compilation.

## Verification and overlap

`contracts/native-future-family-v1.json` pins the canonical `.atto` digest and keeps eleven backend execution cells `NOT_EXECUTED`; `contracts/native-future-family-guest-matrix-v1.json` pins ten real `.atto` fixture inputs (four targeted accepts, six targeted compile rejections). Source-only Node tests enforce expected signatures, explicit `take!`, unique receipt modes, manifest authenticity and many mutation negatives. These are not guest or compiler tests.

This branch stacks on [common-source #30](https://github.com/atto-lang/atto-common-source/pull/30), which owns the canonical stdlib layer contract. [Common-source #130](https://github.com/atto-lang/atto-common-source/pull/130) contains a separate freestanding core await alias. Reconcile their surface, effects, import mapping and ownership before merging either into main; do not duplicate `Future` types. Related language contracts: [atto-spec task #212](https://github.com/atto-lang/atto-spec/pull/212) and [implicit argument borrowing](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md). Existing Rust and JS `ActorFuture<int>` runtimes do not establish generic `ActorFuture<Result<T,E>>` or general Native Atto source support.

Require checked `.atto` module linking, positive/negative no-artifact fixture execution, native and browser guest AOT, typed error propagation, supervisor cancellation/restart, and independent same-source backend receipts. Preserve `NOT_EXECUTED` when Actions fails before job steps. No private-source mirror to another organization until independent approval and effective allowlist for the exact source/destination under [security issue #548](https://github.com/atto-lang/atto-platform-conformance/issues/548).
