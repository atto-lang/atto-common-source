# Generator and Async Iterator Contract v1

Status: proposed cross-backend contract. Parser acceptance, skipped tests, and zero-step CI do not establish parity.

Canonical declarations:

```oreslang
pub gen* values(): Iterator<int> { yield 1; }
pub async gen* events(): AsyncIterator<Event> { yield await next_event(); }
pub suspend gen* cooperative(): AsyncIterator<Event> { yield await next_event(); }
```

`gen*` is a callable declaration and does not require `fnc` or `routine`. Existing `generator fnc`, `generator routine`, `fnc gen*`, and `routine gen*` forms remain compatibility aliases during migration. `async suspend gen*` is invalid.

A sync activation exposes `Iterator<T>`. Async and suspend activations expose `AsyncIterator<T>`. Explicit iterator annotations name the exposed protocol and must never be double-wrapped. Calling a generator creates the iterator lazily; async generator creation does not return `Future<AsyncIterator<T>>`.

The pull protocol is `Iterator<T>.next() -> IteratorResult<T>` and `AsyncIterator<T>.next() -> Future<IteratorResult<T>>`. DONE is stable. `close()` is idempotent. There is at most one active continuation; concurrent pulls must serialize in bounded FIFO order or fail deterministically.

`yield value` emits one element. `yield*` preserves type, backpressure, error, cancellation, and close semantics. Sync generators delegate only to sync protocols; async/suspend generators may delegate to async or sync protocols. `rt cooperate` is scheduler cooperation, not a generator yield. Generator completion uses bare `return;`; return values remain rejected in v1.

`suspend gen*` keeps the suspend effect distinct from async while exposing `AsyncIterator<T>`, because a pull may suspend. Neither async nor suspend generators may park reusable carriers.

Generator methods are enabled only when receiver lifetime and ownership are proven across suspension. A lazy activation must not retain an ordinary lexical borrow of `self` across yield. The backend must prove receiver survival, exclusive mutation, generation-safe dispatch, and exactly-once loan retirement. Until then, generator methods remain fail-closed unsupported; removing a parser rejection alone is not an implementation. Actor message entrypoints do not return generator activations across mailbox boundaries.

No local borrow, mutable loan, MutexGuard, stack-only capability, raw host pointer, or actor-confined capability may escape through a suspended frame without an explicit continuation-safe representation. Yielding a move-only value transfers ownership to the consumer.

Normal exhaustion, close, consumer break, throw, raise, panic, cancellation, scheduler shutdown, and context shutdown must execute finally/defer/delegate-close/owned-drop exactly once. Terminal cancellation bypasses ordinary guest catch while still unwinding cleanup. Public DONE cannot precede required physical runtime-exit fencing.

Each backend fixture reports one of `verified`, `compile_reject_expected`, `unsupported`, `failed`, or `not_executed`. Unsupported and not-executed are parity gaps, never passes.

Required identical-source fixtures cover lazy sync gen*, explicit iterator type and repeated DONE, async await around yield, real suspend gen*, yield* delegation, early-break cleanup, return-value rejection, protocol mismatch, live-borrow rejection, generator-method receiver lifetime, concurrent pull/close/cancel, terminal cleanup, actor-boundary rejection, pending-pull shutdown, and host continuation fencing where applicable.

Parity claims require executable evidence across Java/Graal, LLVM, .NET Native AOT, WebAssembly, and JavaScript for every claimed-supported fixture. Java additionally requires JDK25 plus Native Image AOT/hybrid real guest execution; LLVM requires source codegen/native execution plus sanitizers; Wasm must use the pinned real Oreslang compiler; JS must execute compiler-produced ESM. Zero-step Actions is `not_executed`.
