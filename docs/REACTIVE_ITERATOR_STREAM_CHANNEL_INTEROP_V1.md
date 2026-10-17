# Reactive families: iterator, generator, future, stream, channel and Observable interop v1

**Status: candidate cross-family contract and audit (2026-10-17).** This is a design and host-model hardening gate, **not evidence of implemented lowering or runtime parity**. Existing Java source behavior, the three experimental Rx repositories and typed actor routing are not silently promoted. Public Oreslang API additions use `snake_case`.

## Identity, demand and completion are different axes

| Family | What an instance represents | Values | Pull/push | Start | Termination / ownership |
| --- | --- | --- | --- | --- | --- |
| `Future<T>` | one eventual result | 0 or 1 settlement | awaited/observed, not iterable | existing producer may already be running | success, ordinary failure, cancellation; observing does **not** transfer producer ownership |
| `Iterator<T>` | affine synchronous cursor | 0..N | one synchronous `next(): IteratorResult<T>` | lazy per pull | `done` or `close()`; no re-entry or actor transfer |
| `Generator<T>` | source generator activation | 0..N yields | implements `Iterator<T>` | lazy activation | `return;`/exhaustion or `close()`; never `Future<Iterator<T>>` |
| `AsyncIterator<T>` | affine asynchronous cursor | 0..N | one `next(): Future<IteratorResult<T>>` | lazy per pull | asynchronous terminal/cancel/failure; outstanding pull is serialized |
| `AsyncGenerator<T>` | source async generator activation | 0..N yields | implements `AsyncIterator<T>` | lazy activation | `return;`/exhaustion or `close()`; never `Future<Iterator<T>>` |
| `Stream<T>` | proposed typed **per-consumer sequence** interface | 0..N | demand / backpressure explicit; producer can be hot | specified by construction | distinct NEXT/COMPLETE/ERROR/CANCELLED events; **not** interchangeable with ActorStream |
| `Channel<T>` | bounded transport with waiters | 0..N writes | send/receive; rendezvous for capacity 0 | hot transport | close/failure is a transport condition, not a data value; channel handles stay execution-domain-local |
| `Observable<T>` | subscription **factory** | 0..N per subscription | experimental push-callback or pull variants | source-specific hot/cold | subscription terminal, not necessarily producer terminal; single-consumer channel wrapping is not multicast |

`Generator<T>` and `AsyncGenerator<T>` are public aliases for iterator protocol types in Java's current language documentation; do not count them as distinct scheduler identities. `AsyncIterator.next()` returns one Future *per pull*, **not** one Future holding the whole stream. `ActorStream<T>` in Java PR #1145 denotes a bounded authenticated actor-pipeline **routing capability** with single-flow `send` and `get_done`; it is **not** a general `Stream<T>` or `Observable<T>`. Avoid the same name in APIs that imply generic iteration.

## Common state machine (proposed adapter contract)

Per subscription/iterator cursor, admit `OPEN -> COMPLETE | ERROR(E) | CANCELLED` exactly once. `NEXT(T)` is an event **only while OPEN**, never terminal and never an implicit `Some`/sentinel for completed. A value-level `Option<T>.None` and `Result<T,E>.Err` must remain data when `T` is a sum type. Ordinary `throw` and a failed `Future` are not `Result.Err` unless the caller **explicitly** chooses an authorized typed conversion. `raise`, `panic`, host fatal and cancellation must never be caught and reified as normal data by a generic adapter.

Iterator's `IteratorResult<T>{done,value}` is a **lossy projection** of the four-way event model: `done=true, value=None` denotes natural exhaustion **only when next succeeds**; a rejected/failed/cancelled pull remains in the Future/exception/control category. Legacy `Subscription.next(): Option<T>` and string-tagged `StreamEvent<T>` are compatibility projections. The canonical lossless consumer signal is `Result<Option<T>, Option<E>>`: `Ok(Some(T))` NEXT, `Ok(None)` COMPLETE, `Err(None)` CANCELLED, and `Err(Some(E))` ERROR. This preserves `T=Option<U>` and `T=Result<A,B>` as ordinary data.

### Canonical signal and producer frame

Use two deliberately different closed sum shapes:

- **Consumer signal:** `Result<Option<T>, Option<E>>`
  - `Ok(Some(value))` = NEXT(value)
  - `Ok(None)` = COMPLETE
  - `Err(None)` = CANCELLED
  - `Err(Some(error))` = ERROR(error)
- **Producer frame:** `Result<Option<T>, E>`
  - `Ok(Some(value))` = NEXT(value)
  - `Ok(None)` = COMPLETE
  - `Err(error)` = explicit terminal ERROR(error)

Cancellation is subscription-local control and is not serialized into a producer's data channel unless a protocol explicitly owns such a wire-level cancellation frame. This separation lets a consumer cancel a borrowed Future/channel adapter without revoking or rewriting producer ownership.

State and obligations:
1. A consumer owns exactly **one outstanding pull** per cursor. An immediate second pull is rejected or explicitly serialized; **never** drive the same activation twice in parallel. `close()` is idempotent and wakes/detaches any pending pull where runtime cancellation supports that path.
   - A `next()` Future that has not settled still owns the pull slot even if a host-model scheduler probe reports **no ready event**. A second `next()` must not create a second waiter. Natural completion is a resolved event, never a nonblocking `None`/no-progress poll.
2. No value is delivered after a terminal event; terminal delivery is at most once to a subscriber, and terminal claim is linearizable with concurrent send/cancel/fail. Completion cannot overtake already **accepted** data.
3. A channel with buffer capacity `C` may hold at most `C` buffered values. Capacity zero is rendezvous, not a capacity-one buffer. Also bound **pending write registrations**, not just the queue: a producer must await each pending `Future<void>` or use an explicitly bounded in-flight window before another write.
4. An adapter that owns a **subscription** may cancel/dispose it exactly once. An adapter borrowing a raw channel, a shared Future or a producer actor must **not** close/kill the producer on consumer cancellation. Ownership transfer must be explicit.
5. `from_future` is one-shot per subscription but a shared Future remains one shared computation; multiple subscriptions are not independent reruns. Late settlement after cancellation must not call a user callback or resurrect a terminal cursor.
6. `from_channel` is **hot**, unicast if there is one reader, and needs explicit frames or a native close/error API; `Channel<Option<T>>` with `None` as completion cannot represent `Some(None)` losslessly unless nested sum framing is preserved.
7. `to_channel(capacity)` is an **active pump** only when explicitly started with an owner/lifetime, cancellation link and bounded credit budget. Adapter creation by itself does not start detached work. End-to-end backpressure must cover source pulls, callbacks, frame writes and queueing.
8. Sync callback `Observable.subscribe(on_next)` has immediate synchronous push; callback `false` stops producer cooperatively, **not** asynchronous cancellation or downstream demand. Never call an async guest continuation inline from a Future completion thread; route through the OresScheduler actor lane.
9. `for await` over a sync iterator uses the documented OresFuture adapter and closes the source on break/error. Never treat a synchronous iterator as safe for cross-actor serialization. Live generator frames/borrows/guards cannot escape the source activation or cross `yield` unvalidated.
10. Async generator and channel/select suspension must release the carrier; no sync-over-async blocking or busy polling. Breaking, failing, cancellation and enclosing actor shutdown each run `finally`/`defer` and pending-registration cleanup exactly once.
11. `map` is value-to-value; `filter_map` skips `None` **data returned by its mapping callback**, not source end/error; `flat_map` flattens a specified family and specifies inner lifetime; `switch_map`, if added, cancels prior **owned** inner subscription and never arbitrary producers.
12. Every cross-actor boundary admits only checked data messages; `Channel`, iterator activation, callback closure, subscription and source-local stream handles do not become sendable by being wrapped in `Option`, `Result`, `Future` or generic containers.

## Adapters and lossiness: default policy

| Conversion | Admission | Required extra contract |
| --- | --- | --- |
| `Generator<T> -> Iterator<T>` | direct alias | same affine activation; single pull |
| `AsyncGenerator<T> -> AsyncIterator<T>` | direct alias | same affine activation; Future per pull |
| `Iterator<T> -> AsyncIterator<T>` | explicitly runtime-owned adapter | scheduler hop, close forwarding, no double pulls |
| `Future<T> -> Observable<T>` | exists in experimental pull libraries | 0/1 NEXT then COMPLETE; late failure/cancel distinct; shared Future ownership retained |
| `Channel<Frame<T,E>> -> Observable<T>` | staged | single subscriber, ordered frames, cancellation of read registration but no raw-channel close |
| `AsyncIterator<T> <-> Stream<T>` | **proposed**, not current parity | move cursor ownership, consume one pull at a time; explicit terminal/error mapping |
| `Observable<T> -> AsyncIterator<T>` | staged / can require pump | bounded credits, subscribe once, explicit owned cancellation, no unbounded callbacks |
| `Observable<T> -> Channel<Frame<T,E>>` | staged | owned pump, bounded pending writes, finish/cleanup acknowledgement |
| `Channel<T> -> Future<T>` | `nb readch` single operation | **one read**, not stream conversion |
| `Iterator<T> -> Future<T>` | reject as implicit conversion | requires explicit first/collect semantics and empty-source handling |
| `ActorStream<T> -> Stream<T>` | reject implicit conversion | protocol is actor routing, not arbitrary data streaming |

Do not invent an implicit `Future<Stream<T>>` for `nb cpu { return stream; }`: the Future models asynchronous **region completion**, while stream/channel ownership and cross-domain portability require separately checked source and lifetime semantics. A `cpu` block's explicit `return` remains mandatory. Proposed region-aware `Stream<T>` and channel outputs may be accepted only with a scoped owner and backpressure contract; async generator activation cannot be moved across region/actor boundaries by accident.

## Audit findings (pre-hardening source snapshots, not evidence of dynamic exploit)

The findings below describe the audited snapshots that motivated the current draft stack. Draft remediation status follows; do not read these historical findings as claims about the latest unmerged heads.

- **High:** Java `docs/LANGUAGE.md` describes Iterator/AsyncIterator accurately but there is no unified lossless channel/Observable adapter contract. The independent `Stream` label risks accidental equivalence with the authenticated single-flow `ActorStream` candidate (#1145).
- **High:** Channel Rx main `src/rx.ores` uses public `StreamEvent<T>` with free-form `String kind` and `Option<T>`; it can encode illegal event shapes and has no typed ERROR variant. Its `next(): Option<T>` collapses cancelled and complete.
- **High:** Channel Rx `FramedSender<T>` records completion before `nb writech` has necessarily been consumed. Valid FIFO delivery depends on single-writer, awaited send futures; raw aliases bypass enforcement and completion may remain pending forever without a reader.
- **Medium:** Channel Rx `from_channel` provides a new `ChannelSubscription` for each subscribe, but raw single-reader channels cannot broadcast their sole completion sentinel to multiple subscribers. `FramedPipe` checks single subscriber; raw wrapper does not.
- **Medium:** Both pull Rx variants' subscription ordinary-failure paths use `Err(err).expect(...)` in a catch, so ordinary error fidelity is not proven. Do not present this as typed ERROR propagation or claim that panic is recoverable.
- **Medium:** Callback Rx `subscribe(Fnc<T,bool>)` is synchronous push, with cooperative early stop; it has no credit-based asynchronous backpressure, scheduler-shift, or arbitrary Future interop. Its semantics must remain independently benchmarked, not silently redefined.
- **High:** Cross-family close, producer ownership, yielded borrow lifetime, concurrent pull/single-flight and exact transfer at `cpu`/`nb cpu` need backend-executed tests across Java/LLVM/.NET/WASM/Forge; a prose contract is not enough.

## Draft remediation status (October 17, unmerged / unexecuted exact heads)

- Rx #17 rejects duplicate subscribers for raw hot-channel and merge adapters rather than pretending one channel reader is multicast.
- Rx #19 serializes subscription terminal claims, separates FAILED from COMPLETE/CANCELLED, adds recoverable `next_result()`, and exposes the canonical `next_signal(): Result<Option<T>, Option<Object>>`.
- Rx #19's Future adapter selects a private stop channel against `SelectCase.future(shared)`; Java #1193 provides the current-main waiter-detachment primitive while preserving borrowed producer ownership.
- Rx #19 adds `send_blocking()/complete_blocking()`, holding one delivery credit through actual Future settlement. The legacy Future-returning sender remains caller-disciplined.
- Rx #20 is now a clean stack on #19. `CreditPipe<T,E>` uses the same canonical consumer signal, explicit one-event demand credits, serialized state probes, and a three-way producer frame `Result<Option<T>,E>`.
- Java #1193 tightens concrete ordinary `Channel<T>` payloads to recursively data-only values, rejecting nested callable/runtime/synchronization/cursor/select capabilities, opaque `Object`, and borrows.
- Java #1200 tracks the remaining generic constraint: reusable `Channel<T>` needs a compiler-level recursively data-only bound so unsafe concrete substitutions cannot hide behind unresolved `T/E`.

These are **implementation claims from source review only** until exact-head Java and guest Oreslang jobs execute. Source-org zero-step runner failures are not runtime evidence.

## Concurrency hazards and mandatory remediation (October 17 audit)

These are **code-observed hazards**, not demonstrated exploits. The public channel-backed Rx library in `rx-oreslang-channels/src/rx.ores` has additional admission risks:

1. **Non-atomic marker probing.** `marked(marker)` does a destructive `try readch` followed by `try writech`. Between the two operations, another admitted caller can see a false negative. It is **not** a linearizable state read and must not protect `cancelled`, `finished`, `terminal` or other concurrent admission decisions. A successful write-once token (without read-back) may protect a claim, but querying its state must use one owner/serialized actor turn or an actual atomic state primitive. Do not silently replace `marked` with `rt copy` or a second marker.
2. **Missing terminal error fidelity.** `StreamEvent<T>` has a mutable-in-the-protocol string `kind` with `Option<T>`, no typed error payload, and `Subscription.next_event()` projects an `Option<T>` that already discarded failure/cancel distinctions. Replace with a **closed typed sum** (`Next(T)`, `Complete`, `Error(E)`, `Cancelled`) before advertising lossless interop. Never fabricate a `complete` event for a failed Future.
3. **Unacknowledged in-flight writes.** `FramedSender.send()` returns `nb writech`; `complete()` independently claims the terminal and returns another write Future without enforcing sender-side outstanding-credit ordering. A bounded channel buffer alone does not bound all pending writers or prove that accepted data precedes end frames. Require one owned sender, explicit outstanding-write budget and ordered admission/acknowledgement or reject the conversion.
4. **Cancellation is not interruption of an awaiting Future.** The current `FutureSubscription.pull()` directly awaits a potentially never-settling shared Future; `cancel()` sets state but does not prove it wakes/detaches that in-flight continuation. A safe adapter must settle a subscriber-owned pending pull with cancellation and unregister its completion callback while **not** cancelling the borrowed Future's producer. Verify cancellation races on actual actor scheduler lanes.
5. **Raw channel multicast is false.** `ChannelObservable.subscribe()` creates independent readers of a single `Channel<Option<T>>`. One terminal sentinel reaches at most one consumer; others may wait indefinitely. Either reject additional subscriptions deterministically or explicitly create a bounded broadcast distributor with separate subscriber queues/ownership and stated slow-subscriber policy.
6. **Signal vs ownership.** A successful `nb writech` Future means a framed write was admitted according to its channel contract; it does **not** imply an OS flush, a subscriber callback completed, or cross-actor transfer of a live iterator/borrow. Do not derive cancellation ownership, durable delivery or at-least-once semantics from admission.

The candidate host model's `settle_pull() -> None` is an abstract **not-ready** probe, never a settled Future. It now retains the pending pull registration until a NEXT/terminal outcome; tests exercise duplicate-pull rejection, completion/error wakeup and cancellation disposal. It still models only a *single writer*, not actual concurrent scheduler interleavings, memory ordering, multi-producer fairness, or guest-language compilation.

**Safe promotion order:** ship a typed terminal frame and single-writer credit gate; replace the non-atomic marker probes with an owner-serialized/atomic protocol; implement cancellation-aware Future and channel waiters; then add cross-actor transfer rejection and exact-head native/guest conformance tests. Preserve legacy APIs only as explicitly **lossy compatibility adapters** with no multicast/error-fidelity guarantee.

## Credit-gated typed stream candidate (2026-10-17)

`rx-oreslang-channels#20` is a **stacked draft** implementing
`CreditPipe<T,E>` in a separate `src/credit_stream.ores` source unit.
It is not an alias for the older Observable, channel `FramedPipe`, generic
`Stream<T>`, or authenticated actor `ActorStream<T>`.

Its typed consumer surface is the canonical
`Result<Option<T>, Option<E>>`: `Ok(Some(T))` means NEXT,
`Ok(None)` COMPLETE, `Err(Some(E))` typed terminal ERROR,
and `Err(None)` subscriber CANCELLED. The private producer frame remains
`Result<Option<T>,E>`, because consumer cancellation is local control rather
than producer wire data. This preserves `T=Option<U>` and
`T=Result<U,E2>` *as data* without a string tag.
The publisher explicitly issues `send`, `complete`, or `fail`, each
returning a `Future<Option<SelectResult>>` for an asynchronously registered
write; ordinary guest `throw`/Future failure is never silently mapped to `Err`.

A unique subscriber first `request()`s one credit, then `next_event()`.
The producer **must consume an already issued credit** before publishing one
event (including terminal); absent credit fails immediately rather than
registering an unbounded producer waiter. The resulting pending write uses
`nb select first` with a cancellation control channel ahead of the data arm.
Only one write and one reader pull are outstanding. Capacity zero stays true
rendezvous on a single caller task: register the write Future first, consume
the event, then await the write Future. Caller-owned producers are not stopped
by consumer cancellation. A nested `Result<Option<T>,E>` is the direct
`Channel` payload; no class wrapper is necessary.

**Security/progress qualification:** rebased #20 serializes every
`credit_marked` read/restore probe under a short private `state_busy` gate;
source audit finds 15/15 probes inside 9 gated windows and no gate spanning
`await` or `nb select`. Java #1193 also reconciles local Channel policy by
recursively rejecting callable and runtime-capability payloads. These are still
source-level claims: validate owned `T/E` transfer, cancellation races and
`Channel<Result<Option<T>,E>>` admission on the exact compiler/runtime head
before promotion. The current `Channel` and
`Future` compiler profiles may still refuse parts of the prototype; that
must remain a **failing or draft test**, not a documentation-only success.

The exact Git blob of `tests/test_credit_stream_reference_model.py` in #20,
`e45134fbc2defa7d95b5117009da32baab3a70eb`, passed six local Python
host-reference tests, including 50,421 five-step histories over capacities
0, 1 and 2. **This is model evidence only**, not executed Oreslang or CI.
The source-org Actions runs on #20 currently fail without executing job steps.

## Promotion gates

This change includes **host-only** model tests for bounded slots, single-flight pulls, terminal arbitration and adapter distinctions. They are **contract tests**, not executable Oreslang proof.

Before marking any adapter supported: (a) positive/negative typed Oreslang fixtures for each backend, (b) compiler refusal of unsupported forms, (c) cancellation/close/failure race stress under independent scheduling, (d) bounded memory and pending registrations on C=0/C=1 channels, (e) no inline callback or actor reentry, (f) verified exact-tree CI with runner provenance and matching JDK/native-image evidence, (g) deterministic per-source trace comparisons **without** falsely expecting a global interleaving for racing producers. Keep separate Rx variants until all equivalence claims are evidenced.

Related: `docs/ELM_COMPOSITION_REACTIVE_INTEROP_V1.md`, `docs/QUESTION_PROPAGATION_AND_REACTIVE_ERRORS_V1.md`, Java `docs/LANGUAGE.md` and `docs/channels-select-and-actor-cancellation.md`, Rx channels PR #12/#13, Java ActorStream PR #1145.
