# Core Future await adapter v1

**Status:** core source declaration + cross-backend contract; actual execution is
**not certified** here. See the compiler's separately staged PR and the receipt
requirements below. Do not confuse static source tests with compiled guest proof.

## Decision and placement

Only two public library profiles exist: `core` and `std`. There is no public
`alloc` layer. The canonical freestanding declaration lives in
`library/ores.core/future.atto` and is logically exported from
`ores.core/future`. A hosted `std.await` facade may re-export exactly the
same semantic identity; it does not create another scheduler or module instance.

```atto
define module future as
    pub fnc await<T> = susp |pending: Future<T>| -> await pending;
end
```

The binding is a zero-capture **callable alias**, not a zero-argument function,
a fresh task, a factory or a detached executor. The alias has an inferred
effect-bearing callable type `susp fnc(Future<T>) -> T`, with `T` instantiated
from the argument. `await` itself remains a language operation. Its spelling
is a contextual member/declaration identifier in `std.await` and
`pub fnc await<T>`, never a general variable name for the keyword.

```atto
fnc transform_result(int x): int { return x + 1; }

pub susp fnc main(): int {
    val pending = task { return 41; };
    ^ pending |> std.await |> transform_result >> val result: int;
}
```

The program must return 42. For an existing `Future<T>`, application
`future |> std.await` requires the calling function to permit suspension,
consumes the Future handle under its normal ownership rules, awaits it once,
and yields `T`. It preserves cooperative rescheduling even if the future is
already complete. No extra heap closure or scheduler admission is required
for the capture-free adapter; backends may lower directly to their checked
await IR.

## Safety and typing

- Accept `Future<T> |> std.await` and `Future<T> |> susp |x| -> await x`
  with equivalent observable wait/effect behavior for the same owned future.
- Reject bare `future |> await`; the language keyword is not a callable.
- Reject `future |> std.await()`; this is not an adapter factory.
- Reject `42 |> std.await`; this adapter requires a `Future<T>` even if
  direct `await 42` is separately allowed by a backend.
- Reject calling it from a non-suspending or otherwise unauthorized scope,
  including pure-only scopes with incompatible effects.
- Reject use-after-consume, live mutable loans crossing suspension and
  cancellation/actor-domain violations exactly as for direct `await future`.
- `Future<Result<T,E>> |> std.await` produces `Result<T,E>`. It never
  silently applies `?`, unwraps an error, erases EOF or flattens nested futures.
- `>> val result: T` after an explicit adapter stage binds the resolved
  value once. A caret/return in that position returns the bound value
  without evaluating the pipeline again.

## Staging, backend obligations and evidence

`library/ores.core/future.atto` is the desired *guest implementation*, but
current compiler surfaces do not all lower generic `fnc` aliases or resolve
compiler-owned core source. Treat this file as source-targeted implementation
pending resolver/typechecker/guest-execution admission, not shipped runtime API.

The Rust/Wasm browser compiler has a narrower experimental compiler-owned
`std.await` pipeline intrinsic stacked on its explicit-suspending-lambda
branch. It must still prove real compiled guest execution and cannot claim
general callable-value support, generic `Future<T>`, direct callable
`std.await(future)`, or loader resolution of this file.

For each backend, proof requires exact source/head SHA, actual guest
compilation and execution of the 41-to-42 fixture, a suspended-future test,
negative effect/type/ownership diagnostics, cancellation and completed-future
checks, plus a host-independent core import proof. No `steps=[]` result,
parse-only pass, host-mode oracle or static contract test certifies execution.
The registry under `contracts/v1/await-adapter` remains **pending** until
these receipts exist.
