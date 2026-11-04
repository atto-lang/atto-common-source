# ObservableActor<E> — typed actor observation contract v1

**Status: SOURCE_CONTRACT_ONLY.** This is a proposed Oreslang API and an executable *JavaScript reference model*, not evidence that a compiler parses it or that any backend executes it. Implementations must not advertise support before guest-source positive/negative tests and exact-head runtime tests pass.

## Purpose and relationship to existing primitives

`ObservableActor<E>` is an **opt-in actor-only trait**. It exposes a runtime-controlled typed event source for other actors without giving them publisher state, supervision, cancellation, or mutable references. Do **not** extend every actor implicitly, introduce an actor subclass, or redefine `Observable<T>`, `Subscription<T>`, `ActorRef<T>`, or the reserved `on #selector` mailbox syntax.

Existing Java `ActorEventBus` supports group-scoped named topics with RELIABLE/LATEST/LOSSY policies, bounded per-subscriber channels, immutable frozen payloads and a publisher id. A publisher-bound observation layer can reuse these mechanisms, but **must not** be implemented by merely filtering a shared topic *after* fanout: doing so lets unrelated publishers consume subscriber credits and confuses ownership. Subscriber keys, quotas and generation checks must be scoped to one publisher identity. The existing Java group bus only supports zero-copy subscriptions for SHARED actors. Isolated/private/untrusted subscribers must remain unsupported until isolated-copy transport and reservations are verified. LLVM/.NET/Wasm/Forge must not claim parity through a host-only stub.

## Public source shape (design syntax; not yet compiler accepted)

```ores
define pub trait ObservableActor<E: Sendable> as
    // Optional, default no-op actor-local lifecycle hooks:
    on_observer_subscribed(ActorId observer_id): void { return; }
    on_observer_unsubscribed(ActorId observer_id): void { return; }
    on_event_published(ObservedActorEvent<E> event): void { return; }
end

// Observer need not implement ObservableActor; it observes through a typed lease.
define actor Counter implements ObservableActor<CountChanged> as
    state {
        int count = 0;
    }

    on #increment -> void {
        state.count += 1;
        // Compiler/runtime-owned method, not a user-overridable method.
        val receipt: Result<PublishReceipt, PublishError> =
            self.publish_event(CountChanged(state.count));
        return;
    }
end

define actor Dashboard as
    on_observed_event(ObservedActorEvent<CountChanged> event): void {
        // Reserved, typed observer hook on this actor's own turn.
        // No direct access to Counter.state or borrowed event data.
        return;
    }
end

// A delegated observation grant is a capability, not merely an ActorId.
// The exact mint/transfer syntax remains a separate source admission gate.
val subscription = await observe_actor<Counter, CountChanged>(
    counter_observable_grant,
    ObserveOptions(policy=#latest, capacity=1, delivery=#handler)
);
```

The example declares intention. `implements`, generic trait constraints, `observe_actor`, grant minting, reserved hooks, and source `publish_event` require explicit parser/typechecker/runtime implementation. Existing Oreslang actor source may use `on #selector` handlers and sealed `handle_state` instead; neither provides observable publication automatically.

### Operations

- `self.publish_event(E value) -> Result<PublishReceipt, PublishError>`: actor-turn only; sealed runtime intrinsic, not virtual dispatch. It freezes or copies a detached Sendable event value and records actor id, **incarnation**, per-publisher monotonic sequence, event schema id, and publication time. Not a mailbox send or `self.send` output.
- `observe_actor(ObservationGrant<E>, ObserveOptions) -> Result<Subscription<ObservedActorEvent<E>>, ObserveError>`: returns a **non-Sendable observer-owned** lease. The runtime verifies publisher generation, schema, authorization, quotas, policy, and receiver isolation *before* subscription becomes visible.
- `Subscription.cancel()`: idempotent, closes its event stream, returns all unread reservations; cancellation of one subscriber leaves others intact.
- Delivery mode `#pull` (default) lets a subscriber await/try-read its lease. `#handler` routes admitted event notifications to the observer's reserved `on_observed_event` hook on its own actor turn; the same lease cannot also be read through `#pull`. No callbacks run on producer or transport threads.
- `on_observer_subscribed`, `on_observer_unsubscribed`, `on_event_published` are optional publisher-side **notifications**, scheduled on the publisher actor lane *after* the corresponding admission/close boundary. The observer hook is optional and applies only in `#handler` mode. Hooks cannot veto subscriptions or admissions, grant authority, read another actor's sealed state, or intercept supervisor CONTROL messages. Throw/raise/panic follow ordinary actor failure/supervision rules. Hook work is bounded and cancelled on finalization.
- `PublishReceipt` reports committed/accepted/dropped/coalesced counts and an awaitable **delivery admission** future. It never claims the observer processed the event. A failure before admission yields `Err`, with no partial RELIABLE fanout. Successful publication with zero observers is valid.

### Delivery and isolation

| Policy | Queue | Full behavior | Result |
| --- | --- | --- | --- |
| RELIABLE | Explicit bounded slots/credits and bounded waiter registration | Reserve every active subscriber before any commit; if reservation fails reject the publication atomically; avoid carrier parking | Admission receipt may suspend |
| LATEST | Exactly one unread slot per subscriber | Replace earlier unread event, release old reservation | Immediately admitted/coalesced |
| LOSSY | Explicit bounded queue | Drop new event per full subscriber and count drops | Immediately admitted/dropped |

Every observer gets the same **logical** event, but different memory domains may need frozen sharing, per-isolate copies, or serialized transport. Cross-domain Sendable is not automatically Serializable. No host reference, mutable alias, raw pointer, actor-state loan, subscription, observation grant, or other live capability is allowed as event payload. Borrowed events cannot outlive a turn or cross await. Retained memory is budgeted per subscriber and release is exact-once under read, overwrite, cancellation, failed admission, actor shutdown, and hot reload.

The subscription is bound to the (publisher id, publisher incarnation, observer id, observer incarnation, schema, lease id) tuple; stale references, duplicate lease reuse and cross-runtime grants fail closed. Independent publisher streams may interleave. Each stream preserves per-publisher sequence order for events admitted while the subscription is active. Subscription is not retroactive and implies no durable event replay. Observer termination, publisher termination, grant revocation and reload generation changes fence new admission; close drains/releases unread reservations according to the selected terminal policy. If a subscriber needs a reliable, non-lossy processing acknowledgement, it must use explicit mailbox request/reply or a separately specified ack protocol.

### Safety and scheduling

- Register/unregister and publish admission are linearizable relative to the publisher's subscriber snapshot. Only a subscription admitted before a publication's fence participates; nobody gets a half-initialized event.
- A publisher must not synchronously invoke an observer. All hooks run only on actor turns, never while a bus/channel lock or sealed-state loan is held.
- A same-actor RELIABLE subscriber in `#handler` mode cannot await its own full queue. Detect and reject self-deadlock at admission or await; `#latest` remains a useful self-notification policy.
- Under a hard-RT profile, callbacks, event sizing, fanout and quotas need statically or administratively bounded worst-case work, finite memory, and explicit timing/overflow policies. In LLVM, registration tables and event storage belong to regions/actor arenas; no tracing GC and no unbounded heap allocation on the publish path.
- Delivery telemetry and observable event payloads are ordinary user data. Failure, panic and cancellation still travel only on the protected supervisor CONTROL path. Neither an observer nor a publish hook can forge, suppress or delay those notices.

### Cross-backend gates

1. Parser/formatter: trait declaration and `implements`, typed `ObservedActorEvent<E>`, reserved hooks; reject non-actors implementing `ObservableActor` and duplicate hook identities.
2. Checker: Sendable payload, schema identity, actor-only intrinsic, capability authorization, non-Sendable leases, no state/borrow escape, isolated access policy.
3. Runtime: publisher/generation-scoped subscriber indexes, bounded credits, cancellation, all-or-nothing reliable preflight, deterministic event sequence, no inline observer callbacks.
4. Lifecycle: concurrent subscribe/publish/close, observer/publisher stop, hot-load, id/generation reuse, listener errors, supervisor priority, physical quiescence and exactly-once memory release.
5. Parity: Java/GraalVM, LLVM, .NET AOT, Wasm, and Forge must each run the *same guest Oreslang* positives and negatives and report unsupported explicitly. Native hard-RT/zero-GC performance claims need independent proof.

See `fixtures/observable-actor-v1.json` and `tests/observable-actor-v1.test.mjs` for source-contract assertions and a small deterministic reference model. These checks are **not** compiler/backend execution.
