# Native Atto Future family — source-first integration v1

STATUS: candidate native .atto source; compiled guest and backend parity NOT_EXECUTED.

The public adapter implementation is stdlib/std/future_family.atto. It exports await_future<T>, await_task<T>, await_actor<T>, and await_actor_result<T,E>. No Java, C++, JavaScript or external FFI implements this public API.

The Future<T>, TaskFuture<T> and ActorFuture<T> values are compiler-sealed, affine capability types. A public Atto class must never forge task control, producer identity, result receipts or actor incarnation. Compiler/runtime private primitives provide only the AOT lifecycle, suspension, authenticated completion and CONTROL effects; std implementations and combinators are native Atto.

FREESTANDING LAYER: core has no await, scheduler, heap, OS, or host I/O. alloc may own buffers but not scheduling rights. std owns native Atto suspension adapters. ActorStream<T> is separate and requires bounded demand/backpressure; never convert streaming replies to repeated ActorFuture resolution.

CONTRACT: each input receipt is consumed exactly once; nested Future<T> and Result<T,E> values are never implicitly flattened or unwrapped. TaskFuture control and result rights stay distinct. ActorFuture<Result<T,E>> preserves typed Result and validates producer actor incarnation; failed actor shutdown/panic requires revoked receipts and supervisor CONTROL notice.

DEPENDENCIES: stacked on atto-common-source PR #30 for the canonical core/alloc/std tree. Older core await adapter PR #130 is complementary and must be reconciled before general release. Rust #197 and JS #121 are narrow ActorFuture<int> AOT prototypes, not proof of generic ActorFuture<T>. TaskFuture spec #212 remains draft.

VERIFY BEFORE MERGE: exact-source .atto import and typecheck; native and browser compiler AOT execution; double-await and alias rejection with no artifact; authenticated actor-incarnation failure/restart; typed Result and one-shot semantics; cancellation/physical retirement; 11-backend evidence. Keep NOT_EXECUTED until stepful guest receipts.

PRIVATE SOURCE: no alternate-org mirror without independent approval per atto-platform-conformance issue #548.
