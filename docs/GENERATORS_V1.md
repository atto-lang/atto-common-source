# Generators and async iterators v1

Status: proposed normative cross-backend contract. Implementation evidence is tracked separately; this document does not claim backend parity.

## Canonical declarations

```oreslang
pub gen* values(): Iterator<int> {
  yield 1;
  yield 2;
  return;
}

pub async gen* events(): AsyncIterator<Event> {
  yield await next_event();
  return;
}

pub suspend gen* cooperative(): AsyncIterator<Event> {
  rt cooperate;
  yield await next_event();
  return;
}
```

`gen*` is a generator callable marker; canonical source does not require a redundant `fnc` or `routine`.
Migration aliases may accept `generator fnc`, `generator routine`, `fnc gen*`, `routine gen*`, and `generator*`, but formatters should emit the canonical forms above.

`async suspend gen*` is invalid: `async` and `suspend` are distinct declaration modes and must not be silently combined.

## Public types

A synchronous generator declaration exposes `Iterator<T>`.
An `async gen*` or `suspend gen*` declaration exposes `AsyncIterator<T>`.

The return annotation describes the iterator protocol. The body is checked against the yielded element type `T`.
Backends may temporarily accept the historical element annotation spelling for migration, but canonical source uses the public iterator type.

`Iterator<?>` / `AsyncIterator<?>`, if the wildcard type is available, means an existentially unknown element type. It is **not** the syntax for yield-type inference. V1 canonical declarations use an explicit iterator element type; a future omitted-return inference rule must be specified separately and must not silently widen to `?`.

The v1 iterator protocol is:

```oreslang
Iterator<T>.next(): IteratorResult<T>
Iterator<T>.close(): void

AsyncIterator<T>.next(): Future<IteratorResult<T>>
AsyncIterator<T>.close(): Future<void>
```

`IteratorResult<T>` distinguishes `yielded(T)` from `done`; null or an Option sentinel must not be used to encode completion because T may itself contain those values.

Synchronous close is immediate from the caller's perspective. Asynchronous close is a nonblocking request: its Future completes only after required cleanup and physical producer/frame exit are complete. Repeated async close calls share one logical close operation and must not amplify scheduler work. Source that depends on retirement before continuing uses `await iterator.close()`; structured `for await` cleanup performs the equivalent suspension automatically. An async close implementation must not park an actor or reusable runtime carrier while waiting for retirement.

A generator may use `return;` for completion. `return value;` is rejected in v1. A future completion-result type would require a separately versioned contract.

## Laziness and suspension

Calling a generator constructs an activation only. It does not execute the body, perform I/O, await, cooperate, acquire a runtime carrier, or consume a suspension permit.

The first pull resumes the activation and runs until exactly one of:
- a value is yielded;
- normal completion;
- a declared failure/effect reaches the iterator boundary;
- cancellation/close terminates the activation.

`async gen*` permits async/await operations under the ordinary task-safe capture rules.
`suspend gen*` permits scheduler-managed cooperative suspension while retaining the same `AsyncIterator<T>` pull protocol.
In both cases, suspension happens while servicing a pull, never merely because the generator was created.

## Single-flight pulls and backpressure

Each generator has exactly one logical suspended activation.

At most one async pull may be active at a time. An overlapping `next()` fails deterministically with a concurrent-pull error; it must not allocate a second producer, queue an unbounded number of scheduler tasks, or execute the body twice.

A later pull after the previous pull settles is valid. Terminal DONE and terminal failure are sticky and repeatable according to the iterator protocol.

Async close is itself asynchronous because it may need to cancel a pending pull, unwind finally/defer/delegates, and wait for physical producer/frame exit. Calling `AsyncIterator.close()` must return promptly with a memoizable `Future<void>`; it must not synchronously park an actor/runtime carrier while cleanup completes. Repeated closes share the same logical terminal cleanup and must not amplify cleanup tasks.

Implementations may use a state-machine frame, coroutine, continuation, or another backend representation, but observable pull ordering is identical.

## yield and delegation

`yield value` produces one T and suspends the activation.

`yield* source` delegates sequentially:
- a sync generator delegates only a synchronous iterable/iterator;
- an async/suspend generator may delegate an async iterable/iterator and preserves one-pull-at-a-time backpressure;
- an async iterator is never implicitly blocked into a synchronous iterator.

Generator `yield` is unrelated to scheduler `rt yield`.

## Cleanup and terminal behavior

Normal exhaustion, explicit close, early consumer break, cancellation, failure, panic/security termination, and delegated-iterator failure must run all applicable cleanup exactly once:
- `finally`;
- `defer`;
- delegated iterator close;
- iterator/generator close hooks;
- ownership loans and guards;
- backend frame/arena retirement.

Terminal cancellation is control flow, not a catchable ordinary guest exception. User catch blocks must not swallow it, but cleanup still runs.

A failure remains sticky across later pulls until explicit close. Explicit close may acknowledge that already-observed pull failure, run required cleanup, and retire the activation to DONE; a new cleanup/retirement failure produced by close itself is reported by `close()` / the async close Future and must not be laundered into successful completion.

## Ownership and receivers

Values captured into async/suspend generator frames must satisfy the same task-safe/sendable/ownership rules as other suspended frames. Borrowed locals, native handles, actor-private references, or other non-transferable values must not silently outlive their owners.

Static class generator functions do not retain a receiver and may be enabled independently once callable metadata, iterator typing, lazy activation, cleanup, and backend lowering satisfy this contract. Their parameters and captures must still satisfy the normal generator boundary rules.

A generator instance method retains `self` beyond the source call. Until the type system has an iterator-owned receiver lifetime (or an equivalent proved ownership transfer), instance generator methods must fail closed.

Actor mailbox-turn `self` may not escape through a generator activation.

## Effects and diagnostics

`throws`, `raises`, and `panics` remain distinct. Generator construction does not trigger body effects. Effects occur while pulling and retain causal provenance across yield/await boundaries.

Unsupported generator lowering must be rejected explicitly. Parsing a declaration while silently changing its laziness, cleanup, ownership, or async behavior is non-conforming.

## Evidence states

Each backend fixture reports one of `verified`, `compile_reject_expected`, `unsupported`, `failed`, or `not_executed`. Unsupported and not-executed are parity gaps, never passes. Parser acceptance, skipped tests, source-free models, and zero-step CI do not establish backend support.

## Required conformance

Every backend must cover:
1. lazy creation and three typed yields followed by sticky DONE;
2. explicit `Iterator<T>` / `AsyncIterator<T>` call-site typing;
3. `async gen*` and `suspend gen*` without `Future<AsyncIterator<T>>` double wrapping;
4. deterministic rejection of an overlapping async pull;
5. `yield*` order, failure propagation, and exactly-once delegate close;
6. early break and explicit close;
7. cancellation racing a pending pull and physical frame/guest-turn exit;
8. exactly-once finally/defer/loan retirement;
9. actor-private and borrowed-capture rejection;
10. static generator methods and fail-closed instance receiver escape until receiver lifetime support exists;
11. backend-native execution, not parser-only or host-mock evidence.

Backend-specific evidence requirements are additive:
- Java/Graal requires JDK 25 plus Native Image AOT/hybrid real guest execution for supported fixtures.
- LLVM requires source code generation, linked native execution, and sanitizer coverage.
- .NET requires Native AOT execution for supported generator behavior.
- Wasm must use the pinned real Oreslang compiler and execute the produced Wasm.
- JavaScript must execute compiler-produced ESM rather than treating parser acceptance as support.
- Zero-step Actions remains `not_executed`.

Shared source-admission targets live in oreslang-platform-conformance#176. Java reference work is oreslang-source.java#2110; Java async continuation proof gaps remain tracked by #721, #883, and #677.
