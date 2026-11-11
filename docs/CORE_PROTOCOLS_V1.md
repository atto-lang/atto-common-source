# AttoLang compiler-owned core protocols v1

Status: **source declarations added; executable backend conformance remains unverified**.

## Import identity

The compiler-owned import namespace is `ores.core/*`, not `ores.std/*` or the
legacy `std/*` alias. The canonical guest declaration source is
`library/ores.core/protocols.atto`, with an identical `.ores` resource in
`oreslang-source.java`. Both must retain the same Git blob identity. User
filesystem paths and `ORES_PATHS` may not shadow this compiler authority.

Example import selectors:

```atto
import trait Read from "ores.core/protocols";
import trait Write from "ores.core/protocols";
import trait Source from "ores.core/protocols";
import trait Eq from "ores.core/protocols";
```

This surface declares *protocol signatures* and does not automatically provide
implementations, dynamic typeclass dictionaries, I/O providers, or actor/scheduler
capabilities. Java's existing trait parser and core import pipeline are the
first explicit admission gate. Every backend needs its own executed compiler
proof before support may be called verified.

## Core protocol groups

- Value: `Eq<T>`, `Ord<T>`, `Hash`, `Clone<T>`.
- Byte I/O: `Read<E>`, `Write<E>`, `Flush<E>`, `Close`, `AsyncClose<E>`, `Seek<E>`.
- Typed streaming: `Source<T,E>`, `Sink<T,E>`.
- Iteration: `IntoIterator<T>`, using existing compiler-owned `Iterator<T>`.
- Requests: `Service<Request,Reply,E>`, a non-authoritative request/reply surface.

Do **not** declare `Sendable`, `Shareable`, `Copy`, `Drop`, `Receives`
or `Supervisor` as ordinary, forgeable user traits. They are compiler/runtime
authorities and require safety proofs. A `Service` implementation never grants
mailbox access or permits an actor to intercept its own panic.

## Safety rules

1. `Read.read_async(max_bytes)` resolves to `Result<Option<Array<u8>>,E>`;
   `None` is EOF, not a zero-length chunk. Providers enforce a positive,
   bounded maximum; no returned view may outlive its source storage.
2. `Write.write_all_async(bytes)` takes ownership. Success means the entire
   byte sequence was accepted according to the concrete writer's contract;
   it is **not** evidence of durability. Partial progress requires a future
   explicit remainder/receipt API.
3. `Source.next_async` has one pending pull, no eager work and backpressure;
   `None` is terminal EOF. `Sink.send_async` must use bounded admission
   and must distinguish admission from processing and durable acknowledgement.
4. `Close` releases only immediately retireable resources; `AsyncClose`
   waits for completion of required asynchronous cleanup. Neither may turn
   cancellation into an unbounded wait.
5. `Seek.seek_async` uses an absolute, non-negative byte offset; invalid
   positions must fail with `E`. `Ord.compare` and `Eq.equals` must be
   consistent. `Hash.hash_value` must agree on equal values in one domain.
6. A backend must not implement `*_blocking` on top of a blocking host call,
   blocking worker pool, spin loop, `Future.get`, or `join`. Only a verified
   continuation-suspending nonblocking provider may expose that spelling.
7. Ownership and actor state rules always take precedence over a user-supplied
   behavioural trait. Captures across future suspension must pass loan and
   lifetime checking. `Close` is not a replacement for compiler-owned `Drop`.

## Evidence tiers

- **Source integrity**: identical Git blobs, explicit import identity and
  manifest signatures; no compilation is implied.
- **Java guest admission**: parser, type checker and linked core imports pass
  real JUnit tests on the exact head.
- **Backend execution**: independently linked and executed guests for Java,
  LLVM, Wasm, Forge and .NET; native AOT and zero-GC claims require separate
  target-specific proof.
- **Runtime safety**: negative tests for forged markers, invalid ownership,
  overlapping pulls, double closure, actor panic suppression, unbounded
  backpressure and blocking host I/O.

All five backend evidence fields in the manifest remain `NOT_EXECUTED` until
an actual run with executed job steps, exact source SHA and observed guest
results is recorded. Failed zero-step CI is not a compiler failure or pass.

## Integration hold

The existing draft canonical source ledger (oreslang-common-source PR #225)
currently enumerates a closed set of modules. Reconcile that ledger in the
same integration train before declaring this new module part of its eight-file
source-pin guarantee. Do not silently change PR #225's pinned hashes.
