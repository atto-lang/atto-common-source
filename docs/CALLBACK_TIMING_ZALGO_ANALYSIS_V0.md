# Oreslang callback timing and Zalgo static analysis v0

Status: **proposed semantic contract / experimental warnings**. Related shared prototype: static-facts v0. This does not change parser syntax or claim complete static analysis.

## The bug

```ores
pub fnc foo(Callback cb): void {
    let randie = bar();
    doMore(|| -> {
        randie.emit("done", true);
    });
    randie.on("done", cb);
}
```

If `doMore` invokes its callback inline, the event fires **before** subscription. If the callback is on a concurrent scheduler, it can race registration. An async callback is not by itself safe: only a proved **after-current-turn** callback with a listener registration guaranteed to complete within that same uninterrupted turn is safe with this ordering. A listener may also be registered asynchronously, so an `on` call is not automatically a proof of completion.

## Callback timing is a first-class effect

Use a compiler-internal summary on parameters and invocations:

- `inline_only`: callback may execute on the caller's stack before return.
- `deferred_after_turn`: guaranteed not to run until the caller's current turn returns; must be backed by a trusted scheduler API contract.
- `concurrent`: callback may start on another worker before registration completes.
- `mixed`: API may invoke inline or asynchronously.
- `unknown`: external/FFI/unresolved method; conservatively assume it could run before return or concurrently.

Do **not** infer `deferred_after_turn` from a function's name, the `async` modifier, an `await`, or the fact it returns a Future. A Future may already be settled, its completion callback may be inline, and `await` may not suspend. Hot-reloaded implementations must preserve their timing effect or invalidate dependent compiled proofs.

The abstract event graph records `emit(event, payload)`, `on/once/addListener(event, callback)`, callback publication, actor send, task launch, await, and listener detachment. Order is a **must-happen-before** relation, not textual proximity. Track emitter aliases, event constants or conservative unknown event IDs; unknown callback origins and unknown event values must not be silently ignored. Distinguish definite registration in every branch from registration on one path. Recognize listener teardown and cleanup scopes: registration may no longer be active by the time a callback executes.

## Two diagnostics

- `ORES-ZALGO-001`: callback containing a potential emitter event is published before the relevant listener is definitely registered, and timing can be inline/concurrent/unknown. Witness should show publisher, callback, emission, registration and any suspension.
- `ORES-ZALGO-002`: no reliable ordering between publication and registration (branches, async/FFI boundaries, unresolved receiver or event).

The experimental reference checker accepts *compiler-supplied* `callback_orderings` summaries for these warnings. In addition to textual `order`, summaries carry `registration_completion=proved_sync_install|unproved`; `register_first` is considered safe only with verified synchronous installation. Even `deferred_after_turn` requires proved synchronous installation plus `same_uninterrupted_turn` registration. Unknown completion remains a warning. Human-authored summaries do not prove that an implementation is safe. JSON schema permits `callback_orderings` as an **optional** extension to the experimental v0 fact envelope to avoid breaking prior corpus fixtures.

## Borrow checker / effect integration

A conventional mutable borrow checker does **not** prove that `on` is installed before `emit`. Add a typestate-style registration obligation:

1. Construct an unarmed event source. Registration produces a tracked listener lease, possibly `Future<ListenerLease>` when registration is asynchronous. The lease must be definitely activated before publication of any callback that can emit.
2. Treat passing such a closure to unknown, inline or concurrent APIs as an **escape point**. Check the captured emitter's registration state and actor/isolation domain at that point, including aliases, moves, borrows, `rt share`, owner generations and inferred region lifetimes.
3. An inline callback may re-enter the publishing function. A borrowed mutable emitter held across such an invocation can violate reentrancy unless the API effect and region/access proof allow it; reject only when the usual ownership proof actually fails. Do not globally prohibit legitimate reentrant callbacks.
4. Bound lease lifetime and detachment; reject use of a stale listener permit after teardown/hot reload. Require cancellation and error paths to preserve or discharge registration obligations.
5. For strict AOT / tenant profiles, unknown callback timing, ownership or event-subscription reachability yields incomplete-analysis status, not a false pass.

Prefer *subscription-before-start* or a cold-stream/atomic `subscribeAndStart` API. Even then, the library must certify the actual subscription/install ordering at the host/native boundary; an annotation is not a substitute for enforcement.

## Cross-backend and runtime acceptance

- Java/Graal parsed source fixture matching the example; inline/mixed/concurrent triggers warning; registration first avoids the specific ordering warning when registration is synchronous.
- A true scheduler `deferred_after_turn` contract plus same-turn guaranteed registration avoids the warning; `await`, fallible registration or other suspension restores it.
- Track direct and captured lambda functions, nested branches/loops, aliases and unrecognized callback interfaces; positive and negative findings with source spans.
- LLVM parser currently supports a narrower subset and must report unsupported callback/async semantics rather than manufacture parity.
- Test real compiled guest programs for inline, deferred and concurrent invocation; corroborate timing assumptions under scheduler contention.
- Preserve independent actor heap/arena and SoA/AoSoA/ECS field alias/borrow guarantees; callback metadata describes **logical ownership and events**, never physical-array offsets.
- CI must show executed steps for the exact source commit; a job failing before its first step is no conformance evidence.

No runtime reflection is needed. Timing effects and registration proofs should be compiler-generated metadata suitable for full AOT, incremental compilation and hot-code generation fencing.
