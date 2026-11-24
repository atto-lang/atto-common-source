# Typed in-memory actor PubSub and multi-ActorGroup contract (proposed v1)

**Status: SOURCE_CONTRACT_ONLY / NOT IMPLEMENTED OR VERIFIED ACROSS BACKENDS.** This RFC defines a target API and conformance requirements. The snippets are *illustrative*, not presently accepted Oreslang syntax. Do not advertise Java/LLVM/Cranelift/.NET/Wasm/Forge guest-language support based on host APIs or these fixtures alone.

## Decision

Do **not** introduce `define publisher X` or `define subscriber S` as declaration kinds. An actor can publish and subscribe simultaneously, and ordinary classes/services may be clients where authority permits. Preserve `define actor`, `define supervisor`, `define trait`, and typed handles. Do not make a new actor superclass.

Provide runtime-owned, in-memory, nonblocking, typed topic capabilities:

- `Topic<T>`: manager-owned topic identity and definition, *not* ambient read/write authority.
- `TopicPublisher<T>`: scoped unforgeable permission to publish `T`.
- `TopicSubscriber<T>`: scoped unforgeable permission to create bounded subscriptions to `T`.
- `Subscription<T>`: observer-owned, non-Sendable, cancellable lease exposing nonblocking `next() -> Future<Option<Event<T>>>`. Optional reserved actor-turn delivery mode is a separate consumer choice, not simultaneous with pull.
- `PublishReceipt`: local fanout/admission outcome; it is **not** acknowledgement of subscriber processing.

Scope two primary namespaces: `runtime` (within one runtime and authorized namespace; not cross-process) and `group` (within an ActorGroup incarnation). A topic key is at least (runtime id, scope kind, namespace/group id + generation, nominal schema id, topic name). Topic names alone never imply authority. Multiple topics can use the same human-readable name when namespace or schema differs; no accidental cross-delivery.

In v1, the topic manager chooses the delivery policy at topic definition, and each subscriber chooses only a capacity up to the topic's limit and a delivery mode. Publisher-specific `ObservableActor` observer policies are a separate, existing draft contract.

### Proposed guest surface (not yet compiler-accepted)

```ores
// The manager/supervisor defines the topic once and delegates distinct
// scoped read/write capabilities over trusted CONTROL/capability delivery.
let topic = runtime_pubsub.define_topic<PriceTick>(
    #prices,
    TopicOptions(policy=#reliable, capacity=32)
);
let feed_write: TopicPublisher<PriceTick> =
    topic.grant_publish(feed_ref);
let dashboard_read: TopicSubscriber<PriceTick> =
    topic.grant_subscribe(dashboard_ref);

// Inside the feed actor's own turn, after receiving its issued grant:
let result: Result<PublishReceipt, PublishError> =
    feed_write.publish(PriceTick(#ORES, 42.0));

// Inside the dashboard actor's own turn:
let sub = dashboard_read.subscribe(
    SubscribeOptions(capacity=1, delivery=#pull)
);
let next_event: Option<Event<PriceTick>> = await sub.next();
sub.cancel();
```

These declarations illustrate authority and typed roles, **not** the finalized grant minting or transfer syntax. In particular, ordinary `ActorRef.send` cannot carry an opaque permission handle. Never let users forge handles from a topic name, integer id, ActorRef, unsafe cast, or serialized bytes. Canonical function/method identifiers are snake_case.

## Existing features to extend, not replace

1. Java `ActorEventBus` is already a **group-scoped**, runtime-owned bus with RELIABLE, LATEST and LOSSY policies; its host API uses `group.events()`, `defineTopic`, `subscribe`, and `publish`. It currently restricts zero-copy subscriptions to SHARED actors, and its host Java generics are not evidence of guest-source type checking. Reuse its reservations, channel and fencing substrate. Do not add a second independent guest dispatcher/central actor/threadpool.
2. `ObservableActor<E>` (oreslang-common-source PR #200; Java PR #2345) is an **optional, single-publisher-scoped observation trait**. It is not general topic PubSub. Publisher-specific subscriptions must filter by full publisher incarnation *before* consuming subscriber credits.
3. `ActorAddressBus` (Java draft PR #491) is **named mailbox routing**: one-recipient send or registered-recipient broadcast. It is not topic subscription; preserve the distinction.
4. `Channel<T>` is point-to-point/work sharing; `Observable<T>` is multi-value observation; `Topic<T>` supplies hot, authorized, bounded multicast. Explicit adapters are okay; do not overload `Channel.read` with broadcast semantics.
5. `ActorGroup` may coordinate actors, but its membership is **not** lifecycle/supervision ownership and does not grant access to actor state or cancel/stop authority. Do not embed topic membership in lifecycle ownership.

## Multiple ActorGroups and topic authorization

An independent actor can accept scoped invitations to group A, group B and group C simultaneously; each membership has its own group incarnation, grant epoch, and revocation fence. Joining or leaving A must not change membership in B, terminate the actor, or revoke unrelated runtime-scoped topic subscriptions. Topic subscriptions are explicit: joining a group does **not** subscribe to every group topic.

For a group-local topic, both the capability and live membership are necessary to subscribe or publish; capability revocation, group close, leave, actor stop or incarnation change fences new admissions and closes affected leases. The existing Java group-member host API may remain as compatibility plumbing; guest exposure must not bypass the additional guest grant check. A runtime-scoped topic is independent of group membership and can connect actors from many groups in the *same runtime*, subject to explicit grants and isolation policy.

An actor can have subscriptions to two topics named `#updates` in groups A and B. They are independent streams: a publish to A never reaches B unless the actor explicitly publishes to both. Duplicate subscriptions are distinct lease ids and may intentionally yield two deliveries; do not perform hidden global deduplication. A publisher who is member of A and B can publish to both with separate receipts.

`group.broadcast(message)` should remain an **explicit**, bounded mailbox multicast operation to targeted group members, with separate delivery semantics and message-type checking. It does not implicitly publish to topics. Supervisor CONTROL messages can never be broadcast as ordinary user payloads.

## Ordering, admission, backpressure and delivery

- **RELIABLE:** all-or-none *fanout admission* across the active authorized subscriber snapshot. Reserve memory and queue credits for all recipients before committing any event; a failed preflight yields `Err(Backpressure)` with no recipient seeing that publication. Never hold a group/topic lock while awaiting credits, settling a Future, invoking callbacks, or running guest code. An async retry must repeat admission against a fresh snapshot and revalidate grants. Bounded waiter quotas, cancellation and deadlines are mandatory.
- **LATEST:** maintain one unread event per subscriber; overwrite releases the prior reservation. Coalescing is reported, not silently counted as reliable delivery.
- **LOSSY:** finite per-subscriber slots; full queues drop that recipient's new event and increment drop metrics. No unbounded allocation/retry.
- Preserve per-topic publication order for each subscription and per-publisher sequencing where exposed; concurrent streams from different topics/groups need no global ordering. Linearize subscribe/unsubscribe versus publication. Snapshot membership at a documented admission fence. No retroactive or durable replay in v1; new leases start with future admissions.
- A successful receipt with zero subscribers is valid. A `PublishReceipt` reports audience, accepted, coalesced and dropped admissions and any admission completion; never claim exactly-once processing or end-to-end acknowledgements.
- Payload `T: Sendable` is enforced by the compiler; use a nominal wire/schema identity where appropriate. Frozen immutable objects may be shared **only** in permitted shared domains. Other actor/isolate domains require checked copies/serialization and budgeted release; fail closed until implemented. `Sendable` does not imply `Serializable`.
- Every retained event, subscription registration, pending waiter and copied payload must be budgeted and released exactly once under drain, overwrite, cancel, publisher/subscriber death, group close, failed publish, and hot-load.
- No actor callback runs synchronously in the publisher turn or while any group/topic/channel coordinator lock is held. Push delivery enters the subscriber's own scheduler turn/mailbox and has its own bounded accounting; no reader may borrow a payload across `await`.
- Preserve supervisor panic/raise/throw and termination CONTROL-lane priority. PubSub cannot masquerade as supervisor authority, and user payloads/handles cannot carry live runtime internal capabilities.
- Hard-RT LLVM profile needs preallocated/bounded topic registry, fanout, payload size, reservations and worst-case work; no per-publish unbounded tracing GC or scheduler carrier parking.

### Failure and revocation semantics

A subscription is scoped to (runtime, scope/group incarnation, topic schema + generation, observer actor incarnation, lease id). Publisher handles include publisher actor incarnation and grant epoch. An old actor reference, recycled actor id, forged/wrong-runtime handle, cancelled subscription, closed group or revoked grant must never resurrect delivery. Cancel is idempotent, returns bounded EOF/terminal failure to awaiting consumers, and refunds retained credits. Registration, delivery and teardown must be linearizable.

For actor-private/isolate events, explicitly test `Err(UnsupportedIsolation)` before any partial fanout until verified copy/serialize transport exists. An actor may subscribe to its own topic, but a RELIABLE self-delivery must not deadlock on its own full inbox; reject or force a bounded, nonblocking failure.

## Differentiation from Redis

Redis/NATS/etc. can later implement a transport adapter behind a compatible *logical* interface, but must not be treated as the same runtime guarantee. In-memory PubSub is per-runtime, ephemeral, no durable replay or cross-process delivery. Redis-style delivery, reconnect, serialization, auth, duplicate suppression and guarantees require separate explicit policy. Do not let a network transport deserialize a local grant or opaque live ActorRef.

## Backend and security release gates

**Implementation order:**
1. Publish shared type, effect, authorization and v1 fixtures; land no additional language keywords.
2. Integrate Java guest type checker + runtime-owned intrinsics with the existing event bus; first harden pending PR #1230 lock-safe teardown and review PRs #2345/#491, without conflating their scopes.
3. Add the identical .ores positive/negative fixtures to conformance, with Java/GraalVM JDK 25 and Native Image AOT proof, and equivalent native LLVM, Cranelift, .NET AOT, Wasm and Forge executable proof. Unsupported profiles must reject explicitly.
4. Verify exact tested commit SHA and executable steps, negatives *and* positives, heavy concurrency, resource isolation, teardown, and true release-safe CI. Never infer execution from zero-step Actions runs or from a host-only simulator. Private source may only run on an approved private runner; alternative-organization mirroring needs prior security authorization and exact blob/tree verification.

**Required test groups:** two groups/one actor; A close while B active; cross-group topic name collision; runtime-scoped topic crossing groups; one-to-many and many-to-many; multiple subscriptions; duplicate lease and generation ABA; schema mismatch and non-Sendable payload rejection; unauthorized publish/subscribe; RELIABLE no-partial-fanout under pressure; LATEST and LOSSY release accounting; 1000-way subscribe/publish/leave/close race; subscriber panic and CONTROL precedence; no callback under lock; cancellation/await EOF; actor restart/hot-load; SHARED vs private copy boundaries; hard-RT finite work; no cross-runtime delivery; no implicit distributed pubsub.

See `fixtures/in-memory-actor-pubsub-v1.json` for machine-readable **pending** conformance scenarios. These are *test specifications*, not passing compiler tests.
