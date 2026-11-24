# Functional composition and pure actor transitions (v1 draft)

Status: **proposed cross-backend contract; not a claim of Java, LLVM, or Wasm parity**.
Owner: language, type checker, runtime, actor scheduler, serialization, test CLI.
Motivation: adopt Elm's *practical* Maybe/Result/Task composition and Model/Update/Cmd separation without importing implicit effects, laziness, or a universal Monad typeclass.

## Semantics-first milestones

1. **Sum composition**: `Option<T>.map<U>`, `Option<T>.and_then<U>`,
   `Result<T,E>.map<U>`, `Result<T,E>.and_then<U>`,
   `Result<T,E>.map_err<F>`. Each calls its callback **synchronously**
   exactly once on the matching variant; the other variant returns unchanged,
   without calling the callback. Exceptions and effects inside invoked callbacks
   propagate normally. No implicit `unwrap`, I/O, borrowing, or scheduling.
2. **API ergonomics**: infer `U` and `F` from statically-known callback
   signatures; until inference is proven, an explicitly supplied result type
   is preferable to silently accepting `Unknown`. Add `map2`, `zip`,
   `sequence`, and `traverse` only after their short-circuit order and
   ownership semantics are established.
3. **Closed tagged sums**: compiler-verified tagged constructors, exhaustive
   nested matching, active-variant drops, recursive layout, nominal wire tags,
   and unknown-tag rejection. Distinguish product types from closed sums.
4. **Pure transitions**: optional actor programming model
   `transition(State, Message) -> Transition<State, Message>`.
   `Transition` contains a new state value and an ordered *description* of
   authorized effects; construction does not perform those effects.
5. **Managed subscriptions and replay**: explicit subscription lifetimes,
   mailbox capacity/backpressure, cancellation, event-source capabilities,
   logical replay of recorded external inputs, then execution replay.

## Composition laws and effect observability

- `map(f, Some(x)) = Some(f(x))`; `map(f, None) = None`.
- `and_then(f, Some(x)) = f(x)`; `and_then(f, None) = None`.
- `map(f, Ok(x)) = Ok(f(x))`; `map(f, Err(e)) = Err(e)`.
- `and_then(f, Ok(x)) = f(x)`; `and_then(f, Err(e)) = Err(e)`.
- `map_err(g, Err(e)) = Err(g(e))`; `map_err(g, Ok(x)) = Ok(x)`.
- Identity and associativity are demanded only for **pure total** callbacks
  over valid values. Effects, exceptions, scheduler observations, allocation
  identity, and divergence can invalidate naive contextual equivalence.
- For an expression like `Some(x).and_then(f).and_then(g)`, both callbacks
  execute in source order on the success path, but neither runs on `None`.
- `Result` combinations short-circuit *first error in left-to-right order*,
  unless a separate accumulating-validation combinator is explicitly chosen.
- In generic code, no silent fallback from an unsupported operation to
  `Unknown`, host reflection, or an untyped function.

## Ownership and effect checking

- V1 may conservatively admit only deeply immutable / proven sendable data
  until affine payload transfers are implemented end-to-end. This must be an
  explicit diagnostic, not an implicit copy.
- When supporting affine carriers: consuming a sum consumes its active payload
  once; an operation must never duplicate a moved value or a live borrow.
- No mutable loan may be retained in a sum or returned across suspension.
- Callback effects remain visible to the transitive checker. Calling a
  composition operator does **not** erase `io`, `throw`, `panic`, actor,
  or `suspend` effects of the callback.
- Canonical syntax: `with` declares the allowed effect upper bound,
  `using` acquires a lexically scoped state/resource capability, and
  `critical` governs exclusive state-write admission.
- Do **not** reinterpret `trap` as a Result or as a catch-all; it handles
  ordinary `throw` only, not `raise`, `panic`, or cancellation.

## Future/Task are not interchangeable

`Future<T>` represents scheduled/completable asynchronous work with the
runtime's existing continuation/cancellation semantics. `Effect<Msg>` is
an inert, typed *description* until an authorized actor dispatcher commits
and executes it. A Future callback is never allowed to execute inline on an
arbitrary completion/carrier thread; continuation publication takes an actor
turn. Adding `and_then` as an alias must not change this.

## Proposed optional actor transition protocol

1. Deliver one typed `Msg` into an actor's single-flight execution lane.
2. Read/borrow state under `self.handle_state` / `using state.read`.
3. Compute a pure transition from **owned snapshots** of state and input
   message. The reducer cannot observe time, mailbox, or ambient I/O.
4. Validate the proposed state/effects and commit the state under
   `using state.write(critical ...)`; do not retain any state loan.
5. Dispatch effects *after* commit and loan release. Completion/error
   returns as a later typed message. `Forward` and `Backward` lower to
   `self.forward()` and `self.backward()` and keep pipeline identity.
6. External delivery is **not transactional** merely because state committed.
   Define deduplication keys, durable outbox policy (where applicable),
   timeout/cancellation outcomes, and failure/retry semantics independently.

Effects must be sealed data, not closures carrying actor-owned pointers.
Valid examples: `Send(ActorRef, Msg)`, `Forward(Msg)`,
`Backward(Msg)`, `Schedule(Duration, Msg)`, `Http(Request, mapper)`.
Reject unauthorized capabilities and stale actor/session generations.
Batch ordering and independent execution ordering are separate contracts.

## Conformance gates

- Good-path, absent/error-path, wrong-callback, wrong container,
  return-type mismatch, wrong arity/type-parameter, callback effect escape.
- Side-effect counter proves callback invoked exactly once or not at all.
- Option/Result laws over bounded finite scalar domains.
- Affine payload no-double-use, mutable borrows, shared-safe values,
  nested sums, recursive shape limits, and active-tag drops.
- Cross-backend positive/negative Oreslang source fixtures: Java interpreter,
  Graal AOT/hybrid, LLVM guest lowering/AOT when admitted; no
  host-language utility may masquerade as a compiled-guest proof.
- Actor transitions: state loan ends before effect dispatch; no reentrant
  callback delivery; cancellation does not leak listeners or publish
  prematurely; `forward`/`backward` preserve typed pipeline semantics.
- Diagnostics include source range, expected/actual type, violation path,
  and an actionable non-unsafe suggestion.
- Exact-tree CI: record immutable source tree SHA; where private checkout
  fails cross-org, mirror the identical Git tree into an authorized private
  funded runner repo, verify tree equality, and never transfer secrets.

## Explicit non-goals for this draft

No `Monad<F<_>>`, higher-kinded type system, mandatory TEA syntax,
lazy evaluation, universal zero-runtime-error guarantee, implicit effect
execution, or assumption of source/compiler parity. Implement small,
testable contracts and graduate them individually.
