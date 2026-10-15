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
