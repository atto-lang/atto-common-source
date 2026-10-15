# Elm-inspired composition and reactive interoperability v1

Status: **draft semantic contract, not executable cross-backend parity** (2026-10-15).
Canonical public Oreslang method and `fnc` names are **snake_case**; legacy Java `flatMap`/`onSuccess` require compatibility, not automatic unsafe rewriting.

## Families and behavior

| Family | Composition | Meaning |
| --- | --- | --- |
| `Option<T>` | `map`, `flat_map`/`and_then`, `or_else`, `flatten` | Zero or one owned value; `None` is absence |
| `Result<T,E>` | `map`, `flat_map`/`and_then`, `map_err`, `or_else` | `Err` is data, not a throw |
| `Future<T>` | `map`, `flat_map`/`and_then`, `on_success` | One eventual completion or failure/cancellation |
| `Stream<T>` | `map`, `filter_map`, `take` | Sequential pulls, possibly suspendable |
| `Observable<T>` | `map`, `filter_map`, `filter`, `take` | Source with per-subscription demand and terminal state |
| `Channel<T>` | `readch`, `writech`, `select`; explicit adapters | Transport capability, bounded/rendezvous, not a collection |

### Composition and safety requirements

1. `map` invokes its callback once only on present/success values; `flat_map` callbacks return the same composition family. `map_err` invokes only on `Err`.
2. For pure, total, value-semantic callbacks, Option/Result identity and associativity laws must hold. Effects, observable allocation identity and ownership transfers cannot be reordered or duplicated in the name of algebraic optimization.
3. Move-only payloads remain affine; closure captures/borrows must be valid over suspension. Callback effect information propagates into caller effects.
4. Neither `None` nor `Err` can consume guest `raise`, `panic`, cancellation or host fatal. `trap` retains its separately specified ordinary-throw behavior; actor panics still reach supervisor CONTROL.
5. Reactive operators are demand-driven: `filter_map` may pull until it finds a `Some` but must not prefetch unbounded values; `take(0)` must not pull. A terminal/cancellation/error signal is distinct from a missing data value.
6. Channel-to-Observable adaptation is explicit, carries sender/reader ownership and single-subscriber limits, retains bounded backpressure, and must not silently multicast or cancel unrelated producers.
7. Futures retain their existing start/completion semantics. An optional Elm-style `Effect<Msg>` is **description as data**, executed only by an authorized actor runtime; it must not quietly change Future behavior.
8. Stream, Observable, Channel and Future have different cardinality, hot/cold and cancellation contracts. A universal `Monad<F<_>>` is deferred until higher-kinded types and coherent ownership/effect laws are proven.

### Implementation and admission

The companion `contracts/v1/elm-composition-reactive/manifest.json` pins initial positive/negative cases; these are test targets rather than passing evidence. Java: extend the existing draft monadic work in #222, and ship canonical `Future.flat_map` alongside legacy `flatMap`. LLVM: reject composition before IR unless source-level typed representation and lowering are proven. RX: test `Observable.filter_map`, demand, termination and cancellation. Formatter: retain exact identifiers, generic arguments and source meaning. CLI: property/fuzz test laws without claiming absence of runtime races. Wasm/.NET profiles fail closed on unsupported features.

An opt-in pure actor pattern may later offer `transition(state, msg) -> Transition<State, Effect<Msg>>`; it must leave existing mutable actors and supervision unaffected. Portable typed decoders can later compose `Result<T, DecodeError>` with structured field/index paths.

**Release gate:** pinned-source JVM/Graal and LLVM/native execution, ownership negatives, callback-count proofs, cancellation and pending-write races, and deterministic cross-backend trace comparisons. Documentation or host-only codec tests do not establish guest parity.


## Postfix `?`: deterministic short-circuit and typed exceptional effects (draft v1.1)

**Staged admission:** Java draft #1017 now contains an initial synchronous named-local `Option`/`Result` return implementation and guest tests, **unverified by executed CI**; `throws E` conversion, direct call chains, methods, async/actors, LLVM/Wasm/Forge/.NET remain unadmitted. `?` is a compiler-owned
postfix operator, not a host exception handler, not optional member access
(`?.`), not `as?`, and not the existing `condition ? a : b` ternary.
If the parser cannot disambiguate a source expression without changing the
existing ternary meaning, it **must fail closed**, with a source span and an
actionable diagnostic. Parsing a question mark is not execution support.

### Precisely defined routes (evaluate operand exactly once)

| Operand | Enclosing callable contract | Successful value | Absent/error value |
| --- | --- | --- | --- |
| `Result<T,E>` | `Result<U,E>` return | extract owned `T` | early **return `Err(e)`**, never `throw` |
| `Option<T>` | `Option<U>` return | extract owned `T` | early **return `None`**, never `throw` |
| `Result<T,E>` | non-Result return and **explicit `throws E`** | extract `T` | **`throw e`**, catchable by matching `try/catch` |
| `Result<T,E>` | simultaneously matches a Result-return route and `throws E` | extract `T` | **return `Err(e)`** (return route takes precedence) |
| `Option<T>` | `throws E` only | no implicit error construction | **compile error**; use explicit `ok_or(error)` / `Result` adapter |
| Any other type | Any | N/A | **compile error**; no user-defined propagation typeclasses in v1 |

A `throws E` route is allowed **only** once compiler-verified callable
effect declarations, error type restrictions, and ordinary guest-throw
lowering actually exist; reserving the `throws` token is insufficient.
Implicit `throw` never occurs based on the mere presence of `try/catch`,
a call's name, or an inferred dynamic `Any`/unknown error. If the enclosing
callable does not admit either route, reject at compile time. No implicit
`E` to `F` conversion, exception boxing or loss of error identity.

### Explicit boundary examples (proposed syntax; not current executable source)

```ores
fnc parse_and_validate(string raw): Result<int, ParseError> {
  val int n = parse_port(raw)?;
  val int port = validate_port(n)?;
  return Ok(port);
}
// Err from either step: return Err(error), NOT catchable here.

fnc load_port(string raw): int throws ParseError {
  val int n = parse_port(raw)?;
  return n;
}
// Err: throw ParseError at the ? site, observable by surrounding try/catch.

fnc optional_port(string raw): Option<int> {
  val int n = find_port(raw)?;
  return Some(n);
}
// None: return None (never synthesize a throwable).
```

A caller may explicitly convert between value-level and throw channels with
a typed adapter or an explicit `throw`. E.g., `to_result(...)` preserves
`E`; an explicit catch constructs `Err(error)` only if its type permits.
**`trap` catches ordinary `throw` and yields `Option` at its own
boundary, but never captures an `Err` returned by `?`.** A `Result`
returned early from a `try` block skips the `catch`, still running
`finally` and `defer`. A `Result` converted to a real typed throw via
the explicit `throws` route is catchable.

### Control-flow, cleanup and priority

- `?` propagates out of the *lexically innermost callable* (function/method/
  lambda) in which it occurs. It never exits merely the nearest `match` arm,
  `switch`, `select`, `try` or current Observable operator; callback
  `?` returns from that callback, not from its enclosing pipeline.
- Within `x.f()?.g()`, postfix `?` must be placed explicitly at the desired
  boundary: `x.f()?.g()` unwraps `f()` before calling `g`; the compiler
  must not evaluate `g` after `Err`/None. Use parentheses to force
  unambiguous parsing when mixed with `await`, ternary and cast syntax.
- An early **return** is normal control flow, not an active exceptional
  unwind and not a recoverable error for `recover()`. It runs LIFO
  `defer` and `finally` exactly once. Cleanup may itself fail, in which
  case the existing exceptional-failure lattice controls the final outcome;
  no default return value is fabricated.
- Real `throw` produced by the declared `throws E` route follows ordinary
  `try/catch` / trap / `defer/recover` policy. `raise` bypasses
  `catch`/trap but can be consumed only by eligible direct deferred
  `recover()` in the *same logical invocation*. `panic` cannot be locally
  recovered and routes through typed terminal actor supervisor CONTROL.
  Cancellation and process-fatal controls remain uncatchable.
- An existing `raise` or `panic` produced during evaluation of the left
  operand is never rewritten to `Err` or `None` by postfix `?`.
  Preserve the established priority lattice: host/process fatal >
  cancellation > panic > raise > throw, with deterministic suppressed
  cleanup failures and one final outcome.
- No copied or double-dropped affine payloads. A moved `Err(e)`/None exits
  once; successful `T` ownership/borrows must be proven, including across
  generics, `await`, captured closures and actor heap boundaries.
- `Future<Result<T,E>>` is not `Result<T,E>`. To propagate an awaited
  result write `(await future)?`, only on a backend with validated
  continuation/unwind support. `Future<T>?`, `Stream<T>?`,
  `Observable<T>?`, `Channel<T>?` all reject; stream subscription
  completion is not automatically a function error or `None`.

### Grammar ambiguity and compatibility

The Java lexer already emits `QUESTION` and the parser already admits both
`condition ? a : b` and `value as? Type`. Introducing postfix `?` in
`parsePostfix` by greedily consuming every question mark would silently
break existing ternary parsing. A parser PR **must** establish lookahead/
precedence rules and positive/negative fixtures for `x?`, `x ? y : z`,
`x?y:z`, `x as? T`, `(await f)?`, `x?.member`, and
`x?.member ? a : b`. Ambiguous spellings are rejected rather than guessed.
Call-site syntax round-trips exactly through oreslang-format before enabling
runtime semantics.

**Staged rollout:** normative tests and IR route verifier → Java sync
`Result` and `Option` `?` exact-source execution → optional typed
`throws E` route when the effect checker/lowering is certified → async
continuations and actor supervisor escalation → independent LLVM/Forge/.NET
source lowering and Wasm adapter, gated by identical conformance vectors.
`?` remains explicitly unsupported where the backend cannot prove
return target, effect permission and cleanup ordering.
