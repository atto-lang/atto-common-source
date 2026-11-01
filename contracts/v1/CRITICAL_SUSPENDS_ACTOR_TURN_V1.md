# Oreslang critical / suspends / actor-turn contract v1 (proposed)

**Status: review-pending target contract.** This document does not assert that Java/Graal, LLVM, Wasm, .NET NativeAOT, or Cranelift already implements it. It extends rather than silently supersedes the existing `handle_state(critical[read|write] ...)`, `using state.read/write`, Task and nonblocking-I/O contracts. Existing source fixtures using `async task` are **not** changed by this proposal: only `async` as a *function/method modifier* is removed.

## Three distinct mechanisms

1. **Suspending effect**: `suspends` is a callable effect (potential, not inevitable). It belongs in typed function values, callbacks, generics, typeclasses, indirect dispatch, HIR/MIR and ABI descriptors. `await` consumes one awaitable layer; it never implicitly flattens `Future<Future<T>>`. `nb` selects an explicit nonblocking/future-producing operation and is not a synonym for `suspends`.
2. **Critical guard**: a `critical` block or `critical` method has a synchronous, nonblocking body. Acquisition may wait by *suspending the continuation*, not a carrier thread. No physical lock, state loan, or critical permit spans a suspension. A guard must belong to an identifiable, authorized resource/actor-state region; there is no implicit process-global mutex.
3. **Actor execution turn**: a non-reentrant actor handler retains a **logical reservation** across `await`, independently of the critical guard. An actor turn is not an OS mutex, JVM monitor or a pinned carrier. Its ticket and suspended frame are actor-incarnation/generation fenced. CONTROL supervision remains serviced by a separate bounded path and cannot execute arbitrary guest state writes out of turn.

## Callable and region grammar

| Form | Proposed status | Rule |
| --- | --- | --- |
| `fnc f()` / actor `f()` | accept | synchronous callable; neither suspension nor potentially waiting acquisition |
| `suspends fnc f()` / actor `suspends f()` | accept | may suspend |
| `critical fnc f()` / actor `critical f()` | accept with an owned guard | synchronous protected body, actor admission performed separately |
| `critical suspends fnc`, `suspends critical fnc` | reject | incompatible body effects |
| `async fnc` / actor `async f()` | reject | function modifier is `suspends` |
| `suspends fnc f() { critical { ... } }` | accept with a resolved guard | entry is a potential suspension point, body is not |
| `fnc f() { critical { ... } }` | reject | may suspend while waiting |
| `fnc f() { try critical { ... } else { ... } }` | accept with a resolved guard | immediate acquisition attempt; no enqueue or suspension |

`critical` is a suspension-effect boundary **on entry only**. No `await critical` is required. Even an uncontended entry is still potentially suspending and therefore forbidden in a plain synchronous callable. `try critical` never waits and is the only permitted in-function acquisition in a plain `fnc`.

The shorthand `critical fnc` does not make an arbitrary object magically synchronized. Methods must be associated with an explicit guarded resource or an actor-owned guard. There is no global lock inferred from the function name. An external cross-actor invocation is always admitted through the asynchronous actor-call interface, even when the method body is synchronous; a direct cross-actor synchronous call is invalid. Inside an already admitted actor turn the body may run synchronously without re-admission. `try critical` cannot bypass actor-message admission.

An isolated actor's sealed state is still accessed using the existing authorized state-loan API (for example `self.handle_state(critical[write] |s| -> ...)`). This proposal does **not** allow direct `state.field` escape or retain a state loan over `await`. A lexical `critical {}` used around such a loan must obey both the guard and state-loan rules. New actor examples using naked state access are not a compiler acceptance claim.

### Static effect safety

Within a protected body, the compiler must reject all possible suspension or carrier-blocking effects, including transitive calls through helpers, `suspends` typed callbacks, closures, virtual/typeclass dispatch, generics, host FFI, or unknown effect summaries. A function returning a Future is not automatically suspending merely because it creates a value; it still may not hide blocking I/O or suspend on the path. Accepted critical code must have a trusted call-graph/effect summary that excludes `suspend` and `block`; unknown summaries fail closed. Generic/indirect calls must preserve effect attributes in the ABI, not erase them during lowering.

Target diagnostics (proposed IDs, **not** shipping-backend assertions):
- `E_CRITICAL_SUSPENSION`: suspending effect in critical body.
- `E_CRITICAL_BLOCKING`: host or synchronous blocking effect in critical body.
- `E_CRITICAL_NESTED`: unsafe nested or recursive critical acquisition.
- `E_SUSPENDS_REQUIRED`: potentially waiting critical entry in non-suspending callable.
- `E_CRITICAL_OWNER`: no statically resolved owned guard.
- `E_ACTOR_ADMISSION`: direct synchronous cross-actor call.
- `E_EFFECT_UNKNOWN`: opaque call lacks a trusted nonblocking/non-suspending summary.
- `E_CALLABLE_MODIFIERS`: incompatible `critical`+`suspends`, or `async` function modifier.

### Runtime admission, cancellation and completion

- Uncontended acquisition uses an atomic/owned-runtime fast path. Contended requests receive bounded **FIFO** tickets and suspend without parking a carrier. Do not permit barging ahead of queued waiters. A single-threaded Wasm event loop must preserve observable FIFO semantics without requiring shared-memory atomics.
- A ticket contains authorized resource identity, logical task identity, actor incarnation/generation, and a unique admission sequence; tokens are not guest-forgeable. Cancellation or expiry before handoff invalidates the ticket. Cancellation racing with a grant is settled by one atomic winner and a physical cleanup/release barrier; never resume an already retired actor incarnation.
- The body cannot suspend, and a guard releases exactly once on normal exit, early return, trap or unwind. Release on trap is not transaction rollback. Partial writes must be handled by actor failure/poison/recovery policies, not hidden undo.
- No recursive/nested acquisition by default. The compiler may only admit a proven distinct-lock ordering or separately specified safe case; never silently enable recursive mutexes. Self-await and actor-to-actor reservation cycles need explicit cycle detection or bounded failure, not silent hangs.
- `queue_timeout_ms` governs wait admission; `channel_wait_timeout_ms` any distinct channel wait; `execution_timeout_ms` and `total_timeout_ms` retain their own scopes. The runtime must not asynchronously interrupt mutation halfway through a non-suspending critical body. Enforce deadlines at safe points, reject unbounded operations, and quarantine/fail-stop after overrun as policy requires.
- Actor STOP/restart/hot upgrade fences queued and granted tickets by generation. Preserve physical cleanup before reclaiming old state/heap/code. Supervisor CONTROL cancellation can end a suspended actor turn without executing another ordinary DATA handler prematurely.

### Backend target/ABI

Java/Graal may use atomics and continuation parking, LLVM and Cranelift native schedulers and atomic admission, .NET interlocked operations and async continuation admission, Wasm a host/runtime FIFO. **No backend may wait by holding an OS mutex, JVM monitor, .NET Monitor, native spinlock or Wasm spinlock over `await`.** A logical actor reservation may persist, but not physical guard ownership. The backend-neutral ABI needs explicit effect bits, critical resource identity, FIFO admission token, actor incarnation/generation, cancellation/expiry outcome and physical-retirement acknowledgment. Cranelift is a code-generation backend target, not assumed to be an independent runtime/scheduler.

## Cross-backend validation and roll-out

The sibling JSON manifest and source-free reference tests are design/oracle artifacts, **not guest execution evidence**. Each backend must actually compile the same pinned Oreslang guest fixtures and run the contended/cancellation/trap/actor-turn scenarios. Negative tests must identify the intended error category; a parser crash, timeout, unrelated syntax failure, missing compiler, or zero-step GitHub Action does **not** count as a pass. Record exact guest blob/tree, exact compiler executable identity, nonzero executed steps, no skipped tests, expected traces, and the native/AOT configuration. Do not merge/adopt as certified parity until independent review and the appropriate five-backend execution gates succeed.

Existing overlaps to reconcile instead of breaking silently: common-source actor `critical[read|write]` draft, Java sealed-state/ownership proposals, platform function-effects `suspend`/`block` contract, Java critical deadlines, Task expressions/closures, native I/O and LLVM actor-turn ledger.
