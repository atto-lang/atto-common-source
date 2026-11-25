# Callback dispatch and preemption — v1 (no Zalgo)

Status: proposed normative cross-backend language contract (rules 4–6 aligned 2026-11-21 with atto-spec ch05/ch22/ch25 concurrent-by-default actors); Java has partial executable coverage, native source lowering is incomplete. Host-runtime primitives alone do not constitute source-language parity.

## Core ordering guarantee

1. A guest-visible asynchronous operation may settle before its registration call returns, including a completed Future and foreign callback invoked synchronously by a host API. This *does not* authorize running its AttoLang continuation inline.
2. An asynchronous guest continuation must never execute inline on its registering guest frame, or concurrently with a still-running segment of its own execution context. Other admitted contexts of an ordinary actor may run independently. A completion thread may only atomically settle an operation, release internal accounting, or enqueue a bounded scheduler/mailbox ticket. Completion and registration may perform host-only, synchronous bookkeeping.
3. Every resumed guest continuation must enter through a fresh scheduler dispatch after the prior physical segment of the same execution context and its VM/Truffle/native execution boundary have unwound. It may reuse the same OS carrier after release, but must never reuse the prior dispatch identity, recursively invoke a guest callback, or replay committed source operations.
4. Actor guest work (receive, timers, HTTP ingress, async continuations, CONTROL, cleanup, and FFI callbacks) always runs inside one admitted execution context of that actor: a receive invocation, a child Task, or a supervisor-owned CONTROL handler, each with its own logical stack (atto-spec ch25). Other actors may run concurrently. **Ordinary actors are concurrent by default** (atto-spec ch05, ch22): several admitted invocations of one actor may execute at the same time on different carriers of the actor's pool, up to a runtime-configured, bounded per-actor live-invocation limit. A `define serial actor` admits exactly one live DATA invocation, including while it is suspended, and never executes on two carriers simultaneously. Concurrency never grants unsafe state access: every actor-state access goes through sealed `critical-read` (compatible shared readers) or `critical-write` (exclusive writer) loans. Capacity and fairness are explicit runtime policy; concurrent permission does not promise simultaneous execution on every machine. Finalization, restart and hot upgrade wait for physical quiescence of every live invocation and Task of the incarnation.
5. For a synchronous receive handler that internally yields solely for automatic CPU cooperation, the logical message remains admitted. A serial actor cannot admit later DATA until that invocation retires; an ordinary actor may independently admit later DATA within its configured bound. Cooperation does not create a new invocation or replay committed operations. For a *genuinely pending* source await in an ordinary actor, later messages may be admitted as new invocations on distinct logical stacks, up to the live-invocation limit; they never resume or observe the suspended invocation's frames. A serial actor preserves logical exclusion across awaits: later DATA stays queued and the wake resumes the same invocation.
6. Live mutable state loans and no-yield guards may not cross any suspension, including automatic preemption. A scheduler checkpoint alone cannot pretend to suspend an unlowered synchronous call or FFI frame. Cross-suspension `critical-read`/`critical-write` loans require explicit compiler and runtime proof; the default is rejection (atto-spec ch25).
7. Exactly one terminal outcome may win for each operation: success, error, timeout, cancellation, or close. Late callbacks cannot revive a stopped actor generation, repeat a continuation, or reclaim state before broker quiescence, guest cleanup and loan retirement. Rejected bounded admission must fail closed.

## Terminology

- A *guest callback* executes AttoLang source-owned logic, including transitive library and user handlers.
- A *host notification* is runtime-internal bookkeeping (e.g. a Future CAS, wait-list drain or mailbox publication). It may run inline, even for an already-settled Future, but it must not call guest code.
- *Physical preemption* releases a carrier at a continuation-safe point. This does not automatically permit a different message to enter the same actor.
- A *receive invocation* is one admitted execution of `receive(message)` with its own invocation ID and logical stack; `await`, `select` and `rt cooperate` suspend that same stack rather than creating a new one (atto-spec ch25).
- *Actor concurrency*: ordinary actors may have several live invocations at once, including simultaneous physical execution on different carriers; `serial` actors have at most one live DATA invocation. Mutual exclusion is per actor-state access (`critical-read`/`critical-write`), not per actor.
- No global Node.js-style single-thread event loop is implied, nor does this guarantee callbacks from *different* actors are ordered by wall-clock return times.

## Observable conformance cases

| Case | Required assertion |
| --- | --- |
| Completed Future awaited in an active task | resumed source segment has a new dispatch id and cannot enter while the first segment is still running |
| Host registrar invokes resolve synchronously | the Future may already be settled on registrar return; guest continuation still runs in a fresh dispatch |
| Producer settles while handler is executing | producer does not run guest code; callback resumes its own context only after that context's prior physical segment exits, or enters an admitted child Task through the scheduler |
| Completion between terminal fast-path inspection and waiter registration | at most one resume; no lost wakeup, no recursive guest execution |
| Cooperative synchronous receive with queued second message | serial: later DATA remains queued; ordinary: separately admitted invocation has distinct frames; neither can replay committed operations |
| Cancellation/timeout versus I/O success | one winner, no stale actor-generation execution and no premature frame retirement |
| Host scheduler/turn executor invokes callback twice or off-carrier | reject/terminate rather than silently granting an execution context the actor did not admit, or exceeding its live-invocation limit |
| Two live receives of one ordinary actor | disjoint mutable frames and distinct invocation IDs, even on the same carrier; at most the configured limit execute at once |
| Serial actor: DATA B queued while A awaits I/O | B is not admitted until A completes; A's wake resumes A's invocation |
| Ordinary actor: DATA B arrives while A awaits I/O | B is admitted on a distinct stack; neither observes or mutates the other's frames |
| Two invocations race `critical-write` on the same state | never both inside the write loan; a conflicting reader/writer waits or gets the specified typed denial |

## Source language/backend status

- Concurrent-by-default actors (rule 4): specified by atto-spec chapters 05, 06, 22 and 25. This contract does not certify any backend: Java's documented mailbox path is serial and LLVM has a multi-turn host substrate that is not itself compiled guest evidence. Require bounded multi-invocation guest admission, one-shot continuation ownership and state-loan enforcement before advertising the feature; consult the current chapter 25 backend evidence table.

- Java/GraalVM: has scheduler-turn and actor-mailbox machinery and tests; these requirements still need adversarial integration and exact-tree CI for new changes.
- LLVM/native: completion gate, pinned continuation primitives and native cooperative carrier are *host runtime substrates*. Compiler-generated await/select guest continuations are not certified. Unsupported source must continue to fail closed.
- Wasm/.NET/Forge: bootstrap/scaffold/host prototypes do not claim source callback parity. New backends must implement this contract before advertising async actors.

## Required evidence to claim parity

Use the same supported .atto fixtures for each compiler, and record toolchain versions, exact Git tree IDs, native sanitizer results, scheduler callback/interleaving tests, negative compile diagnostics, and emitted artifacts. A host-only callback gate test is not a source-language conformance pass.
