# Typed `?` propagation and deterministic reactive failures (v1)

**Status: proposed canonical semantics; not an implemented source-language promise.**
This extends `FUNCTIONAL_ACTOR_COMPOSITION_V1.md`, and is a review gate for
Java, LLVM, Rx Oreslang, streams and channels. All public new names use
`snake_case`. Preserve existing camelCase aliases until separately deprecated.

## One operator; no implicit exception conversion

- `expr?` is a **postfix expression operator** which evaluates its operand
  **exactly once** and propagates *one typed error variant* out of the nearest
  enclosing callable, not out of an ancestor actor or subscriber.
- If `expr: Result<T,E>` and the lexical callable returns `Result<U,E>`:
  `Ok(x)?` evaluates to `x: T`, while `Err(e)?` exits that callable
  with **the same** `Err(e)`, after lexical `defer` and `finally`.
  No coercion or cloning of `E` is implicit. Error-type conversion, if needed,
  is explicit `map_err<...>(mapper)` before `?`.
- If `expr: Option<T>` and the callable returns `Option<U>`:
  `Some(x)?` evaluates to `x`, while `None?` exits with `None`.
- A `Result` cannot `?` into `Option`, or vice versa. No implicit
  `Result<T,E> -> throw E` and no conversion of `panic` into `Err`.
- Reject a `?` with missing, `Unknown`, unrelated, borrowed, or
  incompatible error type; reject generic erasure and affine double-use.
- No implicit await: for `Future<Result<T,E>>`, first await the future
  in an admitted suspending invocation and then `?` its settled `Result`:
  `(await fetch())?`. A failed/cancelled Future **is not** `Err(e)`.
- `?` is a **return-control effect** for a failed sum, not an exception,
  and runs the same lexical cleanup as a regular `return`.
  Non-void functions still need a success-path return.

## Error categories and deterministic precedence

| Event | Local `try/catch` | `trap` | `?` |
| --- | --- | --- | --- |
| `Ok/Some` | Not an exception | Preserves value | Unwrap one layer |
| `Err/None` | Not caught | Preserves nested value | Early typed return |
| Ordinary `throw E` | Catchable after cleanup | Convert to `None` at trap boundary | Propagates untouched |
| `raise E` | Bypasses ordinary catch | Bypasses trap | Bypasses `?` |
| `panic` | Bypasses ordinary catch | Bypasses trap | Bypasses `?` |
| Cancellation | Bypasses ordinary catch | Bypasses trap | Bypasses `?` |

For explicit conversion, prefer a **separate** checked
`Result<T,E>.or_throw(): T with throw<E>` or `raise_on_err()` API,
enabled only when the exception type and cleanup/authority checks are
implemented. These operations intentionally change the control category
and must **not** be aliases of `?` or `unwrap()`. `unwrap()` on
`None`/`Err` remains a panic, as in the existing TRAP contract.
`try/catch` only handles true ordinary throw, never value-level `Err`.

Cleanup priority remains host/process fatal > cancellation > panic >
raise > throw, with deterministic suppressed diagnostics. A sum
propagation is a normal return and must not mask a higher-priority cleanup
failure. On a cleanup failure, the cleanup policy applies as for a normal
return, never by silently rewriting an error value.

## Parsing, precedence and non-local return safety

Current Java lexer already emits QUESTION and the parser uses it for
ternary `condition ? yes : no`. **Do not simply steal that token.**
The proposal preserves ternary and admits adjacent postfix `expr?`
only where the next token is a postfix continuation or an expression
boundary; whitespace-delimited `condition ? yes : no` remains ternary.
For ambiguous infix continuation use parentheses: `(parse()?) + 1`.
Grammar must test `f()?.name`, `(await f())?`, nesting, and existing
ternary sources with/without spaces before promotion.

A `?` in a lambda returns from that lambda only. The compiler must
reject `?` in a detached select arm, delayed callback, generator, actor
receive scope, or suspendable continuation until a *typed local return*
frame with correct cancellation/defer unwinding is proven. Never encode
`?` as a host exception catchable by user `try`.

## Functional and reactive composition

- `map`: one value -> one value, no flattening; `and_then`:
  one success -> same-context value. `map_err`: error transformation.
  Canonical naming is `snake_case` (`flat_map`, `on_success`).
- For `Future<T>`, callbacks must publish in a subsequent serialized
  actor turn, never inline on a completion thread. `Future.and_then`
  may alias existing `flat_map` semantics but cannot alter ownership,
  cancellation, listener cleanup, or supervision.
- `Observable<T>` is a *stream of data*, not a disguised `Result`.
  `Observable<Result<T,E>>` carries `Err` **as data**; it must not
  terminate unless the operator explicitly calls `terminate_on_err`.
- A reactive *terminal failure* is mutually exclusive with normal
  completion and cancellation. One terminal signal max. Failures carry
  typed cause+origin metadata; no `None` sentinel for a failure.
- `Stream<T>`/pull subscriptions: support `NEXT(T)`, `COMPLETE`,
  `ERROR(E)`, and `CANCELLED` as distinct terminal/event variants.
  `next_event()` is preferred to compatibility `next(): Option<T>`,
  which cannot distinguish `COMPLETE` from `CANCELLED`.
- `Channel<T>` stays bounded and preserves FIFO; closing a channel
  is not the same as sending an `Err` payload. To transmit a typed
  terminal error, send an explicit sealed data-only frame with
  `Next(T)|Complete|Error(E)|Cancelled` and ordered terminal claim.
  This is not an actor mailbox capability and must not carry closures.
- `Observable.from_channel`, `from_future`, `from_stream`, and
  `to_channel` adapters must respect subscription ownership, one
  outstanding pull, zero/positive capacities, backpressure, cancellation,
  and a single final signal. No auto-retry. In multiplexed merge, preserve
  deterministic per-source ordering, and define fairness/selection policy
  instead of promising a globally deterministic racing order.
- A failed Future/Stream terminal is **not** implicitly transformed
  into `Result.Err`. Explicit `materialize_error` converts a terminal
  ordinary typed error into data; fatal `raise`, `panic`, cancelled,
  or host authority failures cannot be laundered as ordinary data.
  Conversely `dematerialize_error` requires a proven error type and
  authorized execution context.

## Test matrix before enabling `?` in a compiler

1. `Ok`, `Err`, `Some`, `None`; wrong output container/error type;
   result map_err type conversion; nested sum one-layer semantics.
2. Left-to-right single evaluation, skipped callbacks, affine move once,
   temporary borrows, no caller-visible mutation through pure callbacks.
3. `return`, `defer`, `finally` (including cleanup failure),
   `try/catch`, `trap`, `raise`, `panic`, cancellation, cross-await.
4. No remote return across lambda, actor turn, callback, select arm,
   channel read/write, or Observable subscription.
5. Ternary parsing regressions and precedence/adjacency cases.
6. Reactive adapters: error as data vs terminal error, bounded backpressure,
   fair select, cleanup once, cancellation race, no Zalgo/inline callbacks,
   Future late completion with listener reclamation.
7. Same positive/negative guest source across Java and LLVM, exact tree
   SHA evidence; host-only tests never imply compiler lowering parity.
