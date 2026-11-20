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

**Staged admission:** Java draft #1020 contains a bounded `Option`/`Result` return prototype with direct call chains and a restricted async direct-binding-initializer path, **unverified by executed CI**. General callbacks, actors, arbitrary async expressions, typed exception conversion, and LLVM/Wasm/Forge/.NET positive lowering remain unadmitted. `?` is a compiler-owned
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
| `Result<T,E>` | non-Result return, even with `throws E` | N/A | **compile error**; `?` never synthesizes `throw` |
| `Result<T,E>` | matching Result-return route and `throws E` | extract owned `T` | **return `Err(e)`**, unaffected by `throws E` |
| `Option<T>` | non-Option return, including `throws E` | N/A | **compile error**; use explicit `ok_or(error)` / `Result` adapter |
| Any other type | Any | N/A | **compile error**; no user-defined propagation typeclasses in v1 |

There is **no implicit `throws E` route** for postfix `?`, even after typed
exception effects are implemented. A `throws` declaration, enclosing
`try/catch`, a call name, or inferred dynamic `Any`/unknown error must never
turn `Err(e)?` into a guest exception. A compatible `Result`-returning callable
is mandatory for `Result?`; a compatible `Option`-returning callable is
mandatory for `Option?`. To change from a value-level error to a throw,
use a separate, explicitly typed and checked operator (proposed `or_throw()`)
or an explicit `throw`. No implicit `E` to `F` conversion, exception boxing,
or loss of error identity.

### Explicit boundary examples (proposed syntax; not current executable source)

```ores
fnc parse_and_validate(string raw): Result<int, ParseError> {
  val int n = parse_port(raw)?;
  val int port = validate_port(n)?;
  return Ok(port);
}
// Err from either step: return Err(error), NOT catchable here.

fnc load_port(string raw): int throws ParseError {
  return parse_port(raw).or_throw();
}
// Proposed explicit adapter, NOT an implemented operator and NOT postfix ?.
// Its throw behavior needs separate effect/ownership/cleanup verification.

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
`finally` and `defer`. An ordinary `throw` or separately checked explicit `or_throw()` conversion
is catchable; postfix `?` does not produce either.

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
- Real `throw` produced by an explicit `throw` or checked conversion follows ordinary
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
`Result` and `Option` `?` exact-source execution → separate explicit typed
`or_throw()`/`throw E` conversion when effects are certified → async
continuations and actor supervisor escalation → independent LLVM/Forge/.NET
source lowering and Wasm adapter, gated by identical conformance vectors.
`?` remains explicitly unsupported where the backend cannot prove
return target, effect permission and cleanup ordering.

### Current Java first slice (not yet CI-verified)

Java draft #1020 (stacked on #1019) admits a bounded scalar `Result`/`Option` `?` path in proven synchronous callables and selected direct async binding initializers such as `val T x = (await future)?;`. It type-checks the nearest callable's compatible sum return and rejects affine/borrowed carriers and unproven callback/actor continuations. Early-return within `try` runs `defer`/`finally` and never enters catch; early-return **from** cleanup and detached callbacks is rejected. Exact JDK 25 and Native Image tests have not been verified. Typed `throws E`, `raise`, `panic`, and explicit `or_throw()` integration remain separate. Native backends still reject unimplemented source until positive lowering exists.

