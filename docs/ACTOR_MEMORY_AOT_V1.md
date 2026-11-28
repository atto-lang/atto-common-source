# AttoLang actor-owned memory and full-AOT execution (v1 candidate)

**Status:** proposed cross-backend contract, **not** a claim of native guest conformance. The companion `tools/actor_memory_aot_v1.cpp` is a **source-free executable reference model**. Reconcile this proposal against the existing `shared-actor-arenas.v1`, tenant-isolation, actor-buffer-transfer and borrow-checker contracts before promoting it to a canonical language/runtime requirement.

## Non-negotiable invariants

1. **Actor-private heap.** Every actor incarnation owns an allocation domain, identified by `(tenant, actor_slot, generation)`. A source-visible actor reference is a mailbox capability, **not** heap access. Candidate compact `Ref32` values are actor-local 32-bit tokens resolved by trusted sidecar state into actor/region-relative `HeapOffset32` byte offsets; an alternate direct-offset ABI would require an equally explicit generation/lifetime design. Both must carry checked owner, incarnation, bounds, alignment and lifetime provenance before dereference. Never confuse a 32-bit token or offset with a process pointer.
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
## Compact Ref32 representation and 32/64-bit hosts (candidate addendum, 2026-11-16)

**Policy under test:** AttoLang guest-heap references use a 4-byte `Ref32` on **both 32-bit and 64-bit hosts**; host pointers, VM pointers and FFI handles remain native-width. A 64-bit process may have many independently bounded actor heaps and may use more than 4 GiB in total; **no actor-private heap, guest offset, or object size may exceed its own checked `u32` addressable region**. On a 32-bit host, aggregate virtual address-space and contiguous allocation constraints are stricter; never eagerly reserve a 4 GiB range for every actor. Require admission budgets and reserve/commit-on-demand or bounded slab pools in production.

`tools/ref32_heap_v1.cpp` is an additional **source-free compact-layout model**. Unlike the existing `Allocation`-structure tests, it uses actual `uint32_t` reference values, not a native pointer or multiword allocation receipt. Candidate encoding: 20 low bits for a nonzero per-actor handle slot, 12 high bits for a nonzero slot generation. The trusted actor runtime resolves the slot to a 32-bit byte offset, length and region metadata. The model uses a 16-byte preallocated sidecar record per slot and an 8-byte record per maximum free span; these sizes are **not** asserted to be production-optimal. References retain four-byte representation even on 64-bit hosts. The model reserves offset zero, checks alignment and unsigned quota *before* mutation, zeroizes freed ranges, merges adjacent free spans, blocks double-free, fails closed on exhausted generations, and retires all slots when the actor closes.

**Critical security qualification:** A 32-bit actor-local handle **cannot simultaneously encode an arbitrary global actor ID, tenant, incarnation, slot and practically unbounded generation**. Two actors may mint identical 32-bit bit patterns. The current-actor execution context and trusted per-actor sidecar must supply owner/incarnation provenance; compiler, typed mailbox, FFI, serializer and native/guest transitions must refuse raw cross-actor/cross-tenant `Ref32` transport. Never infer that an arbitrary integer cast is a secure capability. A slot-generation match in a different actor heap is **not** proof of ownership. A source-visible `ActorRef` is a distinct mailbox capability.

**Generation/footprint trade-off:** The demonstrator's 20/12 partition supports at most 1,048,575 simultaneous slots and only 4,095 generations per slot; after that, the slot is permanently retired for the current incarnation. This is a **candidate profile, not a universal runtime limit**. Long-lived churn requires measured workload-driven profile selection, region epochs/typed lifetimes or a different overflow-safe table scheme. Do not silently wrap generations. Transient scratch/continuation frames should use explicit lifetime domains instead of burning a global slot generation on every temporary value.

**Memory savings must be measured net of metadata.** Compare actual heap RSS/committed bytes, object fields, padding, alignment, handle tables, free-span/slab metadata, carrier stacks, mailbox queues and managed-host bookkeeping at 1, 100, 10,000 and 100,000 idle and loaded actors. Four-byte references save four bytes per reference *relative to an eight-byte pointer field*, but do not by themselves guarantee lower process RSS. Prefer size-class slabs and compact bitmap/free-list metadata for production; the source-free demonstrator uses a deterministic bounded first-fit scheme with linear scans, not a hard-real-time allocator.

**New acceptance gates:**
- Compile the same reference tests as both native x86-64 and real i386 (`g++ -m32`) executables; a 64-bit run with 32-bit integer types is insufficient to certify a 32-bit host.
- Run strict optimized builds and ASan/UBSan, exercising byte-capacity/slot-capacity failure atomicity, `UINT32_MAX` arithmetic, null/forged handles, ABA/reuse, fragmentation, double-free, incarnation mismatch, generation exhaustion, zeroization and sibling survival.
- Add actual emitted guest fixtures for pointer-width-sensitive object layouts on x86-64 and i686/ARM32 LLVM, 64-bit/32-bit CLR where supported, GraalVM Native Image targets where supported, and Wasm32. Unavailable backends must report `UNSUPPORTED` / `NOT_EXECUTED`, never fabricated `PASS`.
- Instrument allocator call counts and per-actor RSS/committed memory. Avoid `malloc/new` and resizing collections on hot allocation and free paths; configure all quotas before actor admission. Validate alignment, typed access, send/STOP quiescence and actor generation in real compiled guests.

**Evidence boundary:** The 11 new focused compact-reference model tests were executed locally with strict GCC and Clang ASan/UBSan on x86-64. Local i386 headers are unavailable; the CI workflow must actually execute the `-m32` build before 32-bit host validation may be marked PASS. No Java, LLVM, .NET or other Atto guest binary was executed by these model tests.

**Target support caveat:** AttoLang *language* support for 32-bit hardware must not imply every host backend can currently produce a 32-bit executable. LLVM native should target i686 and ARM32 where supported. Microsoft documents NativeAOT x86 on Windows and Arm32 on Linux for .NET 9+; verify exact RID and toolchain before claiming support (https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/). GraalVM Native Image's current platform descriptions enumerate AMD64/AArch64 (https://www.graalvm.org/25.3/javadoc/sdk/org/graalvm/nativeimage/package-summary.html), so treat 32-bit GraalVM Native Image as unsupported unless a specific toolchain demonstrates otherwise. GraalVM's existing **host Java-object compressed references** are a separate optimization from Atto guest `Ref32` handles, and their gains must not be double counted.


## Affine control-flow and drop-elaboration qualification (2026-11-25)

This is a proposed common qualification slice, not a new syntax or an assertion of backend parity. The provisional Java compiler reference is [Java #1883](https://github.com/atto-lang/atto-source.java/pull/1883), exact tested head `fe705f3f77885bf7860a0b701a16a4036e51076c`, tree `2c5fc67940f480a6aad5c67dd2a924c5bf5ff83e`, [Maven run 45731831394](https://github.com/declarative-migrations/atto-ci/actions/runs/45731831394), job 139615461653: 38 tests, zero failures/errors/skips. Its checked drop-plan instructions are compiler IR; the test-only adapter executes real native lexical cell moves/retirements using NativeList stand-ins, not a production Array ABI, per-payload deallocation, or native guest AOT proof.

The following path-level invariants must be preserved independently of concrete MIR representation, runtime language, or whether the compiler specializes continuations or uses proven runtime drop flags:

| Case | Required observable result |
| --- | --- |
| Two owned parameters, void return | Remaining owners retired newest-first |
| Owned return | Returned owner transferred before remaining locals retired; caller owns result |
| Conditional transfer into local | Source invalidated only on selected path; local retired at its scope exit, untouched owner retired on other path |
| Conditional owned return | Both paths return the selected owner and retire the unreturned owner; no second drop |
| One predecessor transfers, later unconditional owner use | Compile-time refusal unless independent definite-ownership proof |
| Borrow/write marker | A live exclusive loan's write witness corresponds to its actual owner-slot write; unmatched or mismatched witness is not authorization |
| Borrow at scope exit | Terminate valid loans before owner destruction; reject unproven escaping loans |
| Unsupported structured ownership | Typed refusal before artifact emission; do not count refusal as positive implementation parity |

Actual compilation and execution of common source fixtures must subsequently demonstrate the same outcomes, including both condition values, returned identities, no-artifact negative controls and deterministic disposal. Guest-visible events, lexical slot retirement, registry count changes, physical payload destruction and whole-region release are distinct observations. A backend must not substitute one for another.

| Compiler lane | Relevant work / next evidence |
| --- | --- |
| Java | #1883: scoped compiler and native-slot tests passed; real guest array/drop ABI and native AOT pending |
| LLVM | [#631](https://github.com/atto-lang/atto-source.llvm/pull/631), [#646](https://github.com/atto-lang/atto-source.llvm/pull/646): conservative conditional-take refusal and complete tracked join metadata; native positive affine drop paths pending |
| Rust | [#288](https://github.com/atto-lang/atto-source.rs/pull/288): diagnostic scalar loan-lifecycle census, not codegen authority; general affine heap/control-flow proof pending |
| Wasm | Rust-authored compiler emits Wasm; distinguish emitted guest execution from browser worker lifecycle and standalone Wasm ownership/runtime evidence |
| Forge | [#196](https://github.com/atto-lang/atto-source.forge/pull/196): fail-closed contextual immutable-update admission; native typed drop glue pending |
| .NET | [#179](https://github.com/atto-lang/atto-source.net/pull/179): native buffer-pool host primitive; source-to-CIL and standalone NativeAOT drop paths pending |
| Cranelift | [#39](https://github.com/atto-lang/atto-source.cranelift/pull/39): restricted scalar/native numeric lowering; affine heap/drop lowering unverified |
| JS | [#149](https://github.com/atto-lang/atto-source.js/pull/149): scalar/worker operator reconciliation; deterministic guest ownership separate from host GC |
| HDL | Target-subset ownership/lifetime admission; dynamic actor heap support not established |
| Atto self-hosted | Stage-0 scalar seed only; compiler-owned drop elaboration not established |
| Realtime | Bootstrap repository; no compiler execution evidence established |

The table is a work-routing inventory, not a test result matrix. No lane is marked fully conformant. Use the normative spec and target profiles, and retain exact compiler/tree/fixture/toolchain/artifact receipts in platform conformance. Any restricted checker or diagnostic census remains non-authoritative for general code generation until its emitted IR correspondence is independently established.
