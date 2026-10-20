# Oreslang callback timing, event ordering and no-Zalgo analysis (proposed v0)

Status: **design and compiler-integration contract only**. This file does not claim a working Oreslang source analyzer, Java/LLVM implementation parity, or executed guest CI. It extends the experimental static-analysis v0 draft without claiming the source-level proof infrastructure is complete.

## Why two independent checks are necessary

Consider:

```oreslang
pub fnc foo(Callback cb): void {
    let randie = bar();
    doMore(|| -> { randie.emit('done', true); });
    randie.on('done', cb);
}
```

`doMore` may invoke its callback before it returns, on a later scheduler turn, or concurrently on another worker. A non-replaying `emit('done')` may therefore precede the `on('done')` subscription. A callback API with path-dependent synchronous/async invocation is **Zalgo**; publishing before establishing a required subscription is a distinct **temporal race**. An API that *always* invokes asynchronously can still race with a subscription established after launch.

The smallest ordinary-emitter fix is **subscribe before triggering the producer**:

```oreslang
pub fnc foo(Callback cb): void {
    let randie = bar();
    randie.on('done', cb);
    doMore(|| -> { randie.emit('done', true); });
}
```

Registration and callback lifetimes must still be safe; do not auto-unsubscribe on `foo` return if completion is later. Prefer a retained one-shot Future/Promise, atomic subscribe-and-start API, or explicitly replayable event for results that must not be lost.

## Effect contract (compiler-inferred; declaration syntax not finalized)

Every callback parameter and callback-producing call should have a *resolved*, transitive summary:

- **Invocation phase**: `inline`, `after_return`, `after_actor_turn`, `mixed`, `unknown`; phases cannot be inferred from the keyword `async` alone.
- **Execution lane**: `same_continuation`, `actor_lane`, `other_worker`, `unknown`.
- **Multiplicity**: `at_most_once`, `exactly_once_on_success`, `many`, `unknown`; exceptions and cancellations need distinct paths.
- **Retention/lifetime**: `call_scoped`, `until_completion`, `until_unsubscribe`, `unbounded`, `unknown`.
- **Transitive effects**: potential `emit`, `subscribe`, `spawn`, `await`, `mutate`, `throw/raise/panic`, `foreign_call`, `lock`, `suspend`, and relevant capabilities.
- **Event identity**: alias-aware stable identity of emitter, event key (literal or symbolic), generation, and replay/delivery semantics. Treat dynamic keys as unknown, not distinct by assumption.

A callback may run inline on a path even if another path suspends or schedules. Untrusted user annotations and unknown FFI contracts **cannot** assert stronger semantics than verified lowering/host bindings. Generic substitutions, virtual dispatch, actor messages, closures, Future/HasFuture<T> adapters, hot reload and cancellation must all preserve summaries.

The desired stdlib rule is **no mixed timing**: either inline-only or guaranteed deferred; for publicly async APIs, prefer guaranteed deferral to the declared scheduler boundary. A guarantee of deferral is not a guarantee of happens-before ordering with the caller's later registration unless the scheduler/actor-turn contract *proves* it. Already-completed Futures must resume guest code through the approved scheduling boundary; registering a waiter must not execute arbitrary guest callbacks under producer/coordinator locks.

## Analysis algorithm (source compiler requirement)

1. Lower resolved source to typed CFG/async state-machine IR, preserving source spans, object/event identity and alias generations. Include exceptional, cancel, reentrant, actor-hop and hot-reload edges.
2. Infer callback phase/lane/cardinality/retention summaries via interprocedural fixed point, joining possible outcomes conservatively; unknown FFI/dynamic target stays `unknown`.
3. Run **must-subscribe** forward dataflow at each CFG node. For each event identity, the join is *intersection* of subscriptions definitely established on every feasible incoming path. An `emit` reachable inline, deferred or concurrently from a launched operation when must-subscribe is false is a possible missed event unless durable replay/atomic subscription is proven.
4. Run may-effect/reentrancy backward or forward analyses, tracking live mutable and immutable loans, actor-state critical scopes, coordinator locks, pending registration handles and unresolved callback escapes. The ordinary borrow checker still performs authoritative region, sendability, shared-domain and loan-validity proofs.
5. Build *happens-before* only from verified ordering primitives: same continuation before suspension, explicit queue/actor turn barriers, atomic register-and-start, join/await of completed work, or synchronization. **Call-return is not a happens-before edge against an already launched foreign worker.** A callback can race even when it is strictly asynchronous.
6. Emit deterministic witness chains with call site, possible callback entry, publication and subscription (plus loan/lock where relevant). Report `proven` only for compiler-verified paths and `potential` for unknown execution, alias, FFI or branch feasibility.
7. Keep per-function summaries incremental and versioned. A recursive callback/call SCC is processed to fixed point with widening and explicit unknown on budget exhaustion, not silently considered safe.

The borrow checker helps substantially: an escaping callback cannot hold a non-`'static` stack/arena borrow past its region; a reentrant callback cannot mutate through a competing exclusive loan; `await` cannot suspend a forbidden critical loan. **But borrow safety does not establish temporal registration**, and two independently owned event objects can exhibit Zalgo without any borrow conflict.

### Suggested diagnostic IDs

| ID | Class | Meaning |
| --- | --- | --- |
| ORES-CB-001 | timing | One callback parameter may run inline on some paths and deferred on others, or has unknown timing at a strict API boundary |
| ORES-CB-002 | event order | Event may be published before its required non-replaying subscription is registered |
| ORES-CB-003 | lifetime | Borrowed/non-sendable closure capture may outlive the loan, actor/region, or cross an unauthorized execution domain |
| ORES-CB-004 | reentrancy | Callback may run while a conflicting mutable loan, critical scope, or coordinator lock is active |
| ORES-CB-005 | completion | Callback may fire more times than declared, race cancellation or settle a one-shot result twice |
| ORES-CB-006 | effects | Callback scheduling/execution provenance or cancellation semantics are unknown in a strict profile |

Use severity `error` for proven ownership/critical-lock violations and hard strict-profile contract violations; use actionable `warning` for potential event loss or unknown host timing. A deliberate sync-only callback (e.g. array visitor) is **not** itself Zalgo.

## Tests to require before source-level claims

- Original emit-before-on example: `CB-001` when `doMore` is mixed and `CB-002` even when `doMore` is **always deferred on another worker**.
- Subscribing before launching producer: no `CB-002` when event identity and subscription lifetime match.
- Branch with subscription only on one branch; callbacks before/after `await`; two event objects with same event key; unknown/dynamic event key; aliased emitters through AoS, SoA, AoSoA and ECS relocations.
- Replayable Future/one-shot completion registered after fulfillment; atomic subscribe-and-start; delivery from an already-completed Future always resumes on correct actor lane, with no inline guest execution.
- Captured stack borrow escaping to delayed callback; double settlement; callback may re-enter under mutable loan or internal lock; cleanup/cancel races; hot-reload generation fencing; FFI callback with unknown timing.
- Assert both positive and negative controls, same rule IDs/witnesses across Java and LLVM **only for source constructs supported by both**. Unsupported LLVM guest features must fail closed; host-only primitive tests do not imply compiler parity.
- Execute exact-tree tests with real steps; never count zero-step Actions failures as passing. Private CI export must respect approved destinations and security authorization.

## Connection to the existing v0 analyzer

The existing `docs/STATIC_ANALYSIS_V0.md` and draft PR #106 cover loop termination, weighted actor/task amplification and capability/taint risks. This extension adds a **temporal and callback-effect domain**; it must use the same canonical typed IR, verified producer provenance, source digests, and strict-profile `unknown` handling. A future versioned `callback_facts` schema can carry verified CFG events and summaries; ad hoc user-supplied facts are *test fixtures*, never a proof.

Existing runtime no-Zalgo work (Java PRs #1006/#1016, LLVM #410, shared #33) addresses *dispatch behavior*. This source analyzer is complementary: it warns when user code can publish before subscribing, misuse callback lifetimes or reenter critical sections, even if the runtime correctly schedules completed Future handlers.
