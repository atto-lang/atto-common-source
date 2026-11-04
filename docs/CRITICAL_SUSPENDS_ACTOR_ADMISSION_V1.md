# Unified critical admission, suspends, async iterators and actor turns v1

Status: **normative design proposal, not shipped**. Backend acceptance tests live in [platform-conformance PR #292](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/292), which supplies the source-free oracle, manifest of 34 planned cases, and offline evidence verifier. Do not infer implementation or parity from this document, parser acceptance, source-free tests, or zero-step CI.

## Three distinct concepts

- **Task suspension** is logical-continuation state. Scheduling may resume the task on another carrier, without parking the carrier that encountered the wait.
- **Critical exclusion** is an incarnation/generation-fenced admission permit. Its *acquisition* may suspend. Once admitted, its *body must not suspend or yield*.
- **Serial actor turn exclusivity** is a scheduler reservation over a mailbox handler. It may persist across await without retaining a critical permit, a mutable actor-state loan, an OS monitor/spinlock or a physical carrier. Supervisor CONTROL remains independently admissible.

These must have separate identifiers, lifetime tracking, cancellation, state and runtime ABI fields.

## Functions and methods

| Declaration | Target rule |
| --- | --- |
| fnc/routine | Cannot suspend, including through transitive calls. |
| suspends fnc/routine | May suspend but need not; effect present in signature and callable types. |
| critical fnc / critical actor method | Supported; protected body synchronous; method requires a known gate/owner; admission is separate and potentially suspendable for remote callers. |
| critical suspends fnc / suspends critical fnc | Compile-time error. |
| async fnc/routine | Remove *after* safe migration; use suspends for effects and explicit Future/task producer APIs. |
| async gen* | Valid: lazy asynchronous generator returning AsyncIterator<T>. |
| gen* | Valid synchronous generator returning Iterator<T>. |
| suspend gen* | Retain as distinct generator mode per GENERATORS_V1; not a synonym for async fnc. |

Existing Java/Graal async fnc immediately creates Future<T>, whereas suspends fnc exposes a T-producing suspendable call. A plain keyword replacement is an ABI/API break. All source and callback/Future call sites must be migrated with explicit ownership and completion semantics.

## Scoped critical admission

~~~ores
pub suspends fnc update(): void {
  const incoming = await receive_data();
  critical gate {
    commit(incoming);
  }
  await publish();
}
~~~

critical gate is an effectful entry that may suspend on contention. A bare critical { } requires an unambiguous statically known ambient gate (typically in sealed actor state admission); it must not create an implicit process-global lock.

- **Uncontended:** acquire immediately; do not force an admission-only yield; execute synchronously; release.
- **Contended:** bounded FIFO queue; park only the *logical continuation*, release carrier; cancel/timeout/restart race is linearized; resume only on authenticated successful handoff; execute synchronously and release.
- **Body:** no await, yield, suspension-safe-point handoff, blocking I/O, blocking FFI or transitive suspends effect through generic, callback, dynamic, typeclass or imported call.
- **Effect proof:** fail closed on unknown function/effect rows; no "implicit release around await" behavior; no implicit Future flattening.
- **Ownership:** guards, actor-state loans, borrowed aliases, mutable projections and native pointers/capabilities may not escape critical body through returns, tasks, Future, generators, closures, channels or foreign code.
- **Cleanup:** release exactly once on normal return and abnormal control flow, respecting physical quiescence before memory reclamation. Poison/partial mutation policies cannot claim transactional rollback unless an actual transaction exists.
- **Nesting:** forbid reentrant acquisition and lock-order inversion unless a dedicated reviewed same-continuation nesting proof allows it. Never infer ownership from a thread ID alone.

## Non-suspending attempt

~~~ores
pub fnc attempt(): bool {
  try critical gate {
    commit_now();
    return true;
  } else {
    return false;
  }
}
~~~

try critical does not enqueue, suspend or park a carrier. A busy gate takes the else path; there is no implicit Future or hidden busy exception in an otherwise ordinary function. This is proposed source syntax and requires backend parser/typechecker/runtime implementation.

## Critical methods versus actor message admission

An actor method body can be marked critical but may not suspend. A remote caller is never permitted to perform a raw synchronous potentially blocking cross-actor call; use actor request/reply or another explicit asynchronous actor interface. The actor runtime performs logical mailbox admission and then the short critical body under the proper sealed state access.

A serial actor may preserve its logical handler reservation while await relinquishes its carrier. This does not preserve a critical gate permit or state borrow. For reentrant actor configurations, any state read before await must be treated as potentially stale afterward and revalidated under a new permit/versioned state transaction.

No public guest value may forge actor incarnation/generation or task continuation identity. STOP/restart/hot upgrade revokes stale queued critical tickets; old execution/resources remain pinned until verified physical quiescence.

## Generator boundary

Canonical async generator spellings and protocol are defined in [GENERATORS_V1](GENERATORS_V1.md). async is retained **only** on iterator-producing generator declarations. Calling an async generator merely constructs a lazy activation; next() performs suspendable pull, respecting single-flight/backpressure. yield within critical is illegal. Break/cancel/close must run cleanup and retire guards exactly once.

## Deadline and supervision interaction

- queue_timeout_ms: admission wait budget; timeout prevents pending ticket handoff.
- channel_wait_timeout_ms: channel operations occur outside the critical body.
- execution_timeout_ms: bounded/cooperative budget for the body; cannot forcibly interrupt a half-completed mutable update.
- total_timeout_ms: bounded overall invocation/admission budget.
- Supervisor CONTROL: separate from ordinary user mailbox reservation; panic/cancel/stop cannot be held hostage by a suspended user handler.
- Non-cooperative CPU or foreign code requires explicit bounded admission and a trusted host service, not an arbitrary blocking guest region.

## Migration and implementation gates

1. Reconcile legacy Java critical callable stacks (including #577, #2198), actor state loan work (#2245/#2335), prior sync fail-fast and always-yield suspend critical variants. Any old synchronous fail-fast use becomes try critical; deliberate yields remain explicit rather than fused to admission.
2. Add AST nodes for lexical critical and try critical, a critical-callable declaration property, effect closure/typeclass/callback proof, and explicit anti-escape borrow rules. Diagnose both modifier orderings, unsound transitive suspension and blocking native calls. Runtime executes nothing until validated.
3. Implement one scheduler-owned, bounded, FIFO, generation-fenced critical gate/loan authority. Do not create a parallel gate next to sealed StateAccess or actor incarnation admission.
4. Port pinned **native .ores** positive and negative fixtures to Java/Graal, LLVM, Cranelift, .NET NativeAOT and Wasm. Implement real guest execution, cancellation and fault injection.
5. Require exact source commit/tree, fixture tree/blobs, compiler SHA, JDK/LLVM/.NET/Wasm compiler identity, stepful CI job logs and guest runtime witnesses. Classify zero-step/steps=null as NOT_EXECUTED; source-free oracle as UNATTESTED.
6. Only promote from draft when semantics are reconciled and independent review + native parity requirements are satisfied.

This contract does **not** authorize moving private source trees to arbitrary funded CI organizations. Existing independently approved private mirror destination rules remain mandatory.
