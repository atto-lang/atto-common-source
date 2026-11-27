# Critical regions and suspending callables — v1 target contract

Status: **target language contract; compiler/runtime lowering is not yet proven across backends**.
Version: 1, adopted for implementation review 2026-11-01.

## Effects and syntax

* Ordinary `fnc`, `mtd` and `routine` do not admit explicit language-level suspension; they may still be transparently parked by the runtime (e.g. bounded stdout admission or scheduler cooperation).
* `suspends` means permission for **explicit** logical suspension, not a requirement to suspend. The declared return type is unchanged, including `void` and explicitly declared `Future<T>`; no automatic Future wrapping, flattening, task creation or mandatory Future allocation. Awaited direct calls produce the declared result.
* Infer runtime parking/resumability independently and transitively through ordinary callers. A potentially parking operation must not retain an unsafe critical guard or exclusive loan; reject unless safe/nonparking admission is established. Preserve actor non-reentrancy, ownership, cancellation and AOT. This is the 2026-11-27 language decision; backend implementation requires separate executed evidence.
* Accepted suspension modifier spellings (2026-11-26): `suspends`, `susp`, `⧖` (U+29D6 WHITE HOURGLASS), and `∂` (U+2202 PARTIAL DIFFERENTIAL). All denote the same effect in every supported callable modifier position, including methods and routines. The ASCII aliases match whole identifiers; the two symbols are exact Unicode scalar tokens, not lookalikes. Preserve original lexemes and positions for diagnostics and formatting. Do not rewrite comments, string literals or ordinary identifiers. Duplicate or incompatible effects remain errors irrespective of spelling. No runtime, allocation, GC or AOT distinction is permitted. Unsupported backends must fail closed for every spelling rather than accept a synchronous approximation. This is a source-language decision, not an execution receipt.
* `async` is not a callable modifier in v1. Do not silently translate historical `async` code: audit Future/await and function-type semantics.
* `critical suspends fnc` and `suspends critical fnc` are rejected, including actor methods and routines.
* `critical fnc`/actor `critical method` are non-suspending *bodies* with a scheduler-mediated entrypoint.
* Inside a `suspends fnc`, `critical { body }` may park **before entry**; the body never suspends, directly or transitively.
* Inside a synchronous `fnc`, a contended `critical {}` must not block: reject unless statically proven immediate (no implicit lock-free inference in v1).
* Proposed `try critical { body } else { fallback }` is immediate, never queues or suspends, and has lexical guard lifetime. This is **not admitted until implemented**.

## Execution semantics

1. Resolve lock ownership (instance, declaring class, module/code-unit, or explicit protected resource) within the tenant/isolate. No global JVM/process-wide lock is inferred.
2. Uncontended acquire uses an atomic fast path; contention enqueues a bounded, FIFO ticket and suspends only the *requesting continuation*, never the carrier/OS thread.
3. Admission validates task/actor generation, ownership, tenant, deadline and cancellation **again** before executing guest code.
4. Execute the critical body non-suspending. Reject `await`, channel waits, suspending calls through aliases/generics/closures/dynamic dispatch, blocking I/O or blocking host FFI (effect admission must be transitive).
5. Release the guard exactly once on exit, early return, trap, panic, cancellation and teardown; never yield while holding it. Do not force preemption in the middle of mutation and pretend to provide rollback.
6. Nested critical entry of the same gate is rejected absent a proven explicit safe protocol. An acquisition cycle must not hang a carrier.
7. Critical acquisition is distinct from actor handler admission. A **non-reentrant actor** may retain a logical handler reservation across `await`, but not a physical OS/JVM/.NET/Wasm lock. Supervisor CONTROL and cancellation must retain safe progress independently.
8. A normal lock is not a distributed transaction or durable object lock: no implicit cross-tenant or cross-process exclusion.
9. Hot upgrade, stop, and actor reincarnation fence outstanding queue tickets. Late completions from an old generation cannot enter a replacement actor.
10. Queue, channel, execution and total deadlines are independent; timeouts while queued retract tickets. The execution timeout cannot interrupt an arbitrary critical mutation halfway through.

## Examples

```ores
pub suspends fnc do_work(): void {
    let result = await fetch_data()
    critical { update_state(result) }
    await publish_result(result)
}
```

```ores
pub critical fnc increment(): void {
    counter = counter + 1
}
```

```ores
pub fnc try_update(): bool {
    try critical { update_state(); return true; }
    else { return false; }
}
```

The examples above describe the **target** syntax, not universally available guest execution.

## Current admission and evidence

Java/Graal, LLVM, Cranelift, .NET NativeAOT and Wasm must fail closed on effects they cannot lower.
No source contract, host-only test, or runner admission failure counts as native Oreslang guest execution.
Existing Java `async` and LLVM experimental `async` sources require explicit migration; do not merge a breaking compiler change merely because source-only tests pass.

The cross-backend acceptance gate requires a pinned exact-head source tree, executable compiler hash,
compiler check, bounded guest execution, an observed suspension on contention, a second independent carrier
making progress, FIFO/cancellation/timeout/trap and stale-generation proofs, and independent review.
Record **zero executed steps** as runner admission failure, not successful or failed language verification.

## Case manifest

`contracts/v1/critical-suspends-v1/cases.json` enumerates both compile-time negatives
and positive target guest programs. `tests/critical-suspends-v1.test.mjs` validates the
manifest's integrity only, not compiler behavior. Backends must consume the identical
cases and attach their own execution receipts before asserting parity.
