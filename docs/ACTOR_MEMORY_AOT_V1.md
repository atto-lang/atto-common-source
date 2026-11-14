# AttoLang actor-owned memory and full-AOT execution (v1 candidate)

**Status:** proposed cross-backend contract, **not** a claim of native guest conformance. The companion `tools/actor_memory_aot_v1.cpp` is a **source-free executable reference model**. Reconcile this proposal against the existing `shared-actor-arenas.v1`, tenant-isolation, actor-buffer-transfer and borrow-checker contracts before promoting it to a canonical language/runtime requirement.

## Non-negotiable invariants

1. **Actor-private heap.** Every actor incarnation owns an allocation domain, identified by `(tenant, actor_slot, generation)`. A source-visible actor reference is a mailbox capability, **not** heap access. All `Ref32` offsets are actor/region-relative and must carry checked owner, incarnation, bounds, alignment and lifetime provenance before dereference. Never confuse a 32-bit offset with a process pointer.
2. **Actor-owned logical stacks.** Every receive turn, task or resumable function owns a separate LIFO chain of activation/continuation frames, allocated within its actor's total bounded frame budget. A multi-threaded actor may have concurrent receive turns, and these chains may migrate between scheduler carriers. A `serial` actor has at most one executing/suspended receive turn as defined by the scheduler contract. **Neither the host OS stack nor the Wasm engine stack is the actor's logical stack.** Unbounded recursion on a host carrier is not a valid implementation of actor-local stack overflow containment.
3. **Concurrency by default.** Receiver methods may execute simultaneously on the same actor unless the actor is explicitly `serial`. All actor state is sealed: access is through compiler-proven scoped `critical-read` (shared) or `critical-write` (exclusive) loans; actors may be concurrent without permitting unguarded mutable aliases. An ordinary turn's scratch allocation is not visible to another turn even inside the same actor.
4. **Suspension safety.** At `await`, `select`, `yield`, cancellation and mailbox blocking, every live value is either safely moved into a typed actor-owned pinned continuation frame or is proven dead/dropped. Writable state loans and critical sections cannot silently cross suspension. Read loans and other borrows across suspension require an explicit pinned-lifetime proof; otherwise reject before artifact emission. Every continuation and wakeup carries an incarnation/generation fence.
5. **Two heap lifetimes.** Persistent actor allocations outlive turns until explicit drop/actor teardown. Turn scratch is invalidated when its turn ends; physical scratch arena reuse must wait for the quiescent point of all turns using that arena (or use separately partitioned per-turn arenas). No realloc/reuse can resurrect a stale handle. Shared/brokered regions must be an explicit third domain with its own capabilities and loan retirement.
6. **Deterministic destruction without a collector.** Lower lexical scope exit, normal completion, `break`, `continue`, `return`, ordinary exceptions, cancellation, supervisor STOP, panic cleanup and restart into explicit drop/cleanup edges. A STOP first closes mailbox admission, drains or cancels outstanding work per policy, waits for in-flight frames, borrows and callbacks to quiesce, then releases regions **exactly once**. Zero sensitive arena contents before reuse when required. Do not reclaim actor storage while a pinned continuation or outstanding shared-region loan references it.
7. **Message ownership is atomic at admission.** A failed/cancelled/full mailbox send leaves the sender's value/ownership intact. Successful same-domain `take` invalidates sender aliases and transfers ownership; safe same-tenant zero-copy is possible only with generation-checked movable regions. Cross-tenant sends must use an authorized serialization/copy broker and may never leak raw `Ref32` or native pointers. Do not transport closures or active stack frames as messages.
8. **Resource isolation.** Heap bytes, logical frame bytes/count, mailbox bytes/messages, outstanding tasks, CPU reductions/time budget, and shared-region loans must be quota checked with overflow-safe arithmetic. Exhaustion terminates or fails **only** the affected actor/tenant to the extent actually supported by its isolation boundary; sibling survival and supervisor notification are mandatory executable tests.
9. **Strict full AOT.** All field layouts, nominal actor identities, handler tables, overload resolutions, frame layouts, continuation resume PCs and drop glue are fixed in typed IR and emitted to the target artifact ahead of execution. Dynamic dispatch may use **precompiled** tables and versioned statically typed slots; hot upgrade may atomically choose among verified AOT code versions. Execution must not depend on an interpreter, reflection, source-to-JS fallback, runtime code generation or tracing JIT. Optional tracing/JIT instrumentation cannot become a correctness dependency.
10. **Zero-GC / minimum-GC profiles.** LLVM, Forge native, and strict standalone Wasm guest code can target **zero tracing GC for guest-owned objects** using arenas, static ownership, drops, and explicit ref-counted shared objects with cycle prohibition/weak edges. Cyclic ownership without a provably safe explicit cleanup policy must fail closed (do not silently introduce a cycle collector). Java/GraalVM and .NET NativeAOT may require **bounded, minimum-GC host-managed metadata**; explicitly audit and measure host allocations, forbid guest ownership from relying on a background collector, and do not label the entire process `zero-GC` when a managed runtime remains. The browser engine may independently GC the Wasm instance wrapper; the guest actor must still follow deterministic logical teardown.
11. **Tenant security is separate from actor ownership.** Static isolation and private heaps do not sandbox arbitrary malicious native instructions. Untrusted tenants require an enforced runtime boundary, such as validated Wasm with bounded imports/memory/fuel/epoch and supervised termination. `AssemblyLoadContext`, native threads, and ordinary actor ownership are not security boundaries.
12. **Interop and FFI.** Host/foreign handles require explicit lifetime and capability witnesses. An FFI call must not retain an actor-private raw pointer beyond its safe pin/loan scope; nonblocking calls resume only through fenced, actor-owned continuation state.

## Compiler and backend acceptance matrix

Every backend must produce receipts for **actual compiled `.atto` source**, not reference models alone:

| Backend | Required proof | GC qualification |
| --- | --- | --- |
| Java / GraalVM | native guest compilation/AOT, actor arena and continuation-frame lowering, drop paths, protected isolate boundary | measured near-zero guest allocation pressure; disclose residual host GC |
| LLVM | generated native binary with actor-private heap/frame ABI, sanitizer runs, bounded recursion, STOP and restart | no guest tracing GC and deterministic drops |
| .NET NativeAOT | generated CIL + `PublishAot=true` binary on Linux and Windows; no reflective guest dynamic code | no guest collector dependence; disclose CLR GC |
| Wasm | generated/validated guest Wasm; per-actor memory + per-turn continuations, browser Worker boundary, Node and browser execution | no guest tracing GC; host wrapper GC disclosed |
| Forge / Cranelift | independently generated machine code or sealed AOT artifact, actor frames/heap and verified drop graph | no guest tracing GC; AOT mode independent of JIT |

## Mandatory adversarial guest scenarios

- Cross-actor heap/stack handle read and write denied; `ActorRef` cannot be cast into an arena address.
- Out-of-bounds or integer-overflow `Ref32` access rejected; strict alignment; stale actor and frame generation rejected after restart or recycling.
- Two concurrent receivers on one ordinary actor use disjoint logical frame chains and scoped RW guards. `serial` mode denies overlap. Same-actor scratch pointer cannot escape its turn; other in-flight turns survive scratch retirement.
- Nested recursion exceeds actor frame quota and reports a supervised actor-local failure; a sibling continues executing and returns an expected value (e.g. 42). An uncontained engine/carrier stack fault must be reported as tenant-level quarantine, not falsified actor-local recovery.
- A suspended task pins its owned frame; invalid state loans across `await` are rejected before artifact emission; cancellation, timeout and exception paths drop all owned values once, revoke wakeups, and free frame quota.
- A full/cancelled mailbox does not consume the sender's value. Successful same-tenant move has zero payload copies; cross-tenant payload uses copy/serialization with distinct identity.
- STOP closes admission, handles pending sends and borrowed resources, waits for quiescence, zeroizes/retire memory and fences stale capabilities. Supervisor priority CONTROL messages are not ordinary actor mail and cannot be forged by guests.
- ABI/profile gate: strict AOT artifact has no interpreter/dynamic-code fallback. Verify the actual executable, compiler HEAD/tree, target binary SHA, emitted source/IR path, and nonzero CI steps.

## Required evidence / no false-positive rule

Report `PASS`, `FAIL`, `UNSUPPORTED` or `NOT_EXECUTED` independently for **parser/type-checker**, **native guest**, **Wasm guest/browser**, **AOT binary**, **sanitizers**, **tenant isolation**, and **GC/allocation measurements**. A source-free model pass does not promote any backend to `PASS`; CI with `steps=[]` is `NOT_EXECUTED`. Include source Git SHA/tree, test fixture SHA, target/toolchain, receipt digest, and independent reviewer. Do not mirror private compiler trees to a different organization without explicit approved provenance and disclosure controls.

## Local source-free model checks

```sh
c++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic tools/actor_memory_aot_v1.cpp -o /tmp/atto-actor-model
/tmp/atto-actor-model
clang++ -std=c++20 -O1 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer tools/actor_memory_aot_v1.cpp -o /tmp/atto-actor-model-san
/tmp/atto-actor-model-san
```

The model checks 15 focused scenarios (including heap/stack ownership, overlapping receivers, serial mode, unbalanced loans, mailbox admission, quiescent drop, and restart fences) using deterministic single-threaded interleavings. **It is not a thread-race test, production allocator, parser/guest test, or proof of full AOT or zero-GC backend behavior.** Production implementation must remain independent per backend and use the same semantic fixtures.