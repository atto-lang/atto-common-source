# Real-time, actor memory, and complete-AOT qualification plan (v0 proposal)

Status: DESIGN / NOT IMPLEMENTED OR CERTIFIED. Date: 2026-10-19.
This supplements MEMORY_SAFETY_AND_PERFORMANCE.md, COMPILATION-POLICY.md, and backend-specific docs. No existing Java/LLVM compiler, virtual machine, runtime, or firmware may be described as hard-real-time-qualified by this proposal. "Trusted" is an authorization category, not a WCET proof. AOT, GC behavior, and real-time schedulability are separate release gates.

## Objective and precise claims

1. LLVM native: compile all *admitted reachable Oreslang guest code* to ahead-of-time native machine code, ship with no tracing collector in the reachable runtime/FFI closure, and support **hard-real-time-qualified applications on specifically named hardware/OS configurations**.
2. Java/Graal: reach program-specific complete guest AOT, nearly eliminate managed allocations in steady-state actor hot paths, and offer both low-GC soft-real-time execution and a separately validated **RTSJ / real-time Java vendor target**. No general hard-real-time claim follows from using Java, Native Image, RTSJ APIs, or vendor marketing.
3. For both: precise memory safety, bounded capacity, explicit admitted scheduling assumptions, fail-closed compile/build admission, and reproducible evidence. We do not trade memory safety or actor isolation for latency.

A hard deadline is a per-task/scheduling-context requirement, not a language-wide property. General recursion, unrestricted loops, unbounded message queues, arbitrary FFI, blocking network calls, dynamic compilation and adversarial code cannot acquire hard-real-time status by enabling a flag. Each qualified artifact must bind a source revision, whole-program closure digest, compiler/runtime versions, hardware, firmware/kernel configuration, timing analysis, resources, workload assumptions and deadlines.

## Proposed execution profiles (configuration vocabulary is NOT implemented)

- llvm-aot-general: guest AOT for the supported closure; no tracing collector; no timing guarantee.
- llvm-aot-rt-strict: guest AOT, no tracing collector, no JIT/evaluator, admitted bounded effects, static or preallocated storage, timing/scheduling certificate tied to one deployment platform.
- java-graal-lowgc: hosted Truffle/JVM or existing Graal Native Image; performance optimization and measured GC, **not** hard real time.
- java-graal-guest-aot: program-specific guest code ahead of native-image build; no guest interpreter/JIT fallback. GC policy is independent.
- java-rtsj-rt-strict: source-to-verified Java bytecode or a compatible vendor compilation input, mapped to version-pinned RTSJ APIs/runtime memory/scheduler facilities, vendor AOT where available, plus platform-level qualification. Requires a proven toolchain and license, not just javax.realtime imports.

For hard-real-time qualification, deadline miss is a correctness failure. A finite stress run with no misses is supporting evidence, not a mathematical bound. A no-GC claim means no tracing GC is linked/reachable/executed in the claimed boundary; it does not mean no heap allocations, no deterministic frees, no OS stalls, or no GC inside an excluded external process.

## Effect and timing admission: shared compiler responsibility

Extend independently verified HIR/MIR contracts in common-source (without prematurely replacing either frontend) to carry these resolved *transitive* facts:

- allocates / maximum bytes / allocation site / owning domain; whether allowed only during boot or outside critical regions; failed allocation policy.
- may-suspend, may-block-OS-thread, may-wait-for-external-response; maximum wait or explicit async handoff contract.
- CPU bound: known loop trip limits, recursion/call depth, work per iteration, branch bounds, checked arithmetic and timer/clock assumptions.
- stack and continuation maximum sizes and maximum simultaneous frames.
- synchronization: maximum lock-hold time, shared-state loans, priority ceiling/inheritance and maximum blocking term.
- message and buffer sizes, mailbox credits, spawn limits, ISR-safe restrictions, async completions, cancellation/cleanup and per-actor turn limits.
- FFI and syscalls: a signed/versioned, explicitly trusted target-specific worst-case contract, otherwise UNKNOWN.
- runtime features: GC, runtime compiler, dynamic loading/reflection, class initialization, lazy initialization, page faults and other hidden work.
- preemption: operating-system/hardware preemption for higher priority tasks; bounded cooperative checkpoints for schedulability of *peer work* when relevant. Cooperation alone is NOT an interrupt or preemption guarantee.

Use a lattice such as PROVEN_BOUNDED, ASSUMED_WITH_PLATFORM_EVIDENCE, UNKNOWN, FORBIDDEN; UNKNOWN must reject strict admission. Runtime counters/guards enforce certified budgets, but instrumentation does not convert an unknown WCET to a proof. A bound can be obtained from language restrictions, model checking, validated WCET tooling and component contracts; never infer it solely from average timing.

### Admission and artifacts

A proposed declarative build manifest binds:
- target: board/CPU stepping, memory topology, cache assumptions, interrupt plan, OS/RTOS and scheduler configuration.
- entry roots: specific actor handlers/interrupt callbacks/tasks plus resolved code closure and native libraries.
- per-root timing: period/minimum interarrival, relative deadline, worst-case execution bound, release jitter, priority/affinity, queue and stack budgets; sporadic arrival constraints.
- memory: fixed startup arena sizes per actor, per-turn scratch capacity, pinned async frames, mailbox quotas, shared frozen region limits, maximum actor instances.
- interrupt, DMA and external I/O interference assumptions.
- platform evidence: compiler flags, verified driver/library WCET, code hashes, measurements and formally justified assumptions.

A conservative per-job check includes release/wakeup jitter + actor execution WCET + bounded preemption/interference + worst-case resource blocking + validated completion handoff <= relative deadline. Fixed-priority workloads need response-time/interference analysis, and EDF deployments need their own demand/supply analysis. Total utilization alone does not certify deadlines. Unaccounted cache interference, IRQ storms, DVFS, SMT competition, memory faults or thermal throttling invalidate a certificate.

Reject or move to best-effort actors: unbounded loops/recursion, unbounded input-dependent decoding, variable-time heap growth, unknown FFI, synchronous DNS/filesystem/network waits, unbounded critical sections, runtime code generation, uncontrolled GC, unknown class loading and unbounded teardown. Keep an expressible non-realtime execution mode for unrestricted language features.

### Actor and state-specific obligations

- Actor persistent guest data continues to live in its single state { ... } schema. No additional user-declared persistent instance fields. Compiler-verified read/write critical state loans only.
- Separate physical execution threads from outstanding request/message concurrency. Until independent multicore interference proofs exist, the strict realtime actor profile requires an exclusive non-overlapping execution lease and one executing carrier at a time (min=max=1). The general backend may admit explicit max > 1 where its data-race proofs and scheduling policy allow it.
- A real-time actor cannot hold a state write loan across an unknown-duration await, foreign callback or unbounded critical section. Move immutable/pinned snapshots into bounded continuation storage; reacquire a verified loan after resume and validate state version.
- Mailboxes and control lanes are statically bounded. Sending must either be proven admitted/bounded or return a typed overflow/backpressure outcome; do not stall a critical thread. Parent/control/cancellation delivery must have separate reserved capacity and bounded processing cost.
- Actor lifetime quiescence is a strict reclamation fence: no handler, continuation, producer admission, FFI/DMA operation, kernel I/O, loan or in-flight owned envelope may retain arena storage. Cancellation request is not physical completion. Fault/stop/restart must preserve generation fencing.
- No unbounded actor destruction on a critical thread: either prove worst-case drop work, destruct incrementally with a bounded per-release allowance, or quarantine owned arenas for an off-critical worker after a non-forgeable quiescence witness. Quarantine capacity is bounded; saturation has a designed safe failure path.
- Hungry/dedicated actors may retain carrier and CPU reservation while suspended; park/wake is separate from actor suspension. CPU affinity does not equal CPU exclusivity, and kernel park/wake latency must be included.

## Actor memory architecture: four domains, two independent reclaim models

Native LLVM domains:
1. Immutable startup/static memory, pre-faulted and pinned where the platform permits.
2. Persistent actor arena: bounded per actor; validated offsets/handles and generation identifiers. Owned graph nodes can have cycles only through non-owning checked handles; ownership of arena is unique.
3. Bounded scratch/turn arena plus separately pinned asynchronous continuation storage. Reset only after all relevant loans have exited. Never reset at await while a live frame can reference data.
4. Explicit immutable/shared regions and I/O-transfer buffers with lease/epoch accounting, including foreign readers and delayed DMA completions.

No tracing or opaque fallback allocations. Pre-size and reject on capacity exhaustion in strict regions. Heap allocation is not categorically forbidden in all general native programs: unique allocations with deterministic drops are permitted outside bounded critical regions. Bump-pointer allocation is bounded only when capacity checks, initialization and destructor work are included.

Java/Graal domains:
1. Prefer primitive/unboxed, preallocated data and specialist Truffle nodes in the existing hosted runtime; measure allocations, GC roots, remembered-set/card barriers, safepoints, and pause tails.
2. Guest-owned actor memory may be in off-heap or VM-specific region storage with **opaque, checked handles**; ordinary Java object headers, wrappers, metadata, futures, Truffle nodes and strings still belong to the Java heap if allocated there. Logical ActorMemorySlice objects do NOT create independent collector heaps.
3. Heap allocations caused by boxing, captures, future completion, exception construction, IO callbacks, class initialization, finalization/cleaners, reflection and runtime diagnostics must be audited. A Java wrapper per actor object can still create large host-GC graph traversal.
4. Explicit drop/close for guest resources; never rely on finalizers or eventual host GC for correctness. An actor-local guest arena can reclaim O(1) region ownership, but host collector work is only *near zero* if reachable managed objects, allocation rates and roots are actually small.
5. Graal Native Image Epsilon is a no-op collector which **never frees Java objects**; it is a niche option for a proven allocation-bounded executable, not proof of sustainable zero garbage collection on a long-lived workload. Serial and G1 have pauses. Use the native image GC selected by the actual toolchain; do not assume hosted HotSpot flags apply.

These physical domains do not automatically establish hostile-code sandboxing. Untrusted native code requires OS/MPU/MMU-level isolation and explicit boundary checks.

## Real-time Java feasibility track (separate from hosted Truffle)

A commercial/RTSJ JVM adapter must be experimentally proven. Do NOT assume today's Truffle engine/Graal compiler, JDK 25 bytecode, JVMCI, dynamic proxies, JNI or Native Image execute on an RTSJ JVM. A vendor-specific RTSJ Java runtime is not the GraalVM Native Image runtime.

1. Select a vendor/VM version and actual supported Java classfile level, OS, CPU, SDK, bytecode/API restrictions, licensing and AOT options. aicas JamaicaVM is a plausible evaluation candidate because it advertises RTSJ, hard real time, deterministic GC and vendor AOT. Vendor claims are leads, not Oreslang certifications.
2. Prototype a *standalone* Oreslang source-to-JVM-bytecode path, shared semantic HIR/MIR when available, that generates direct program-specific methods and explicit async state machines. Do not attempt to make the existing Java Truffle AST evaluator the certified time-critical engine.
3. Build a small RTSJ runtime facade for scheduling, periodic/sporadic releases, bounded transport, region allocation/entry and exact ownership-transfer rules. Pin API generation: RTSJ 2.0 moves scoped memory APIs into javax.realtime.memory; NoHeapRealtimeThread is deprecated in some RTSJ 2.0 vendor APIs. A vendor's GC-preemptible normal threads do not by themselves prove portable heap-free operation.
4. Test memory assignment rules, region lifetime, heap/nonheap access, vendor-specific GC behavior, synchronized/priority-inversion behavior, virtual calls, static initialization and allocation bounds with *compiled and executed* vendor binaries.
5. Run no-heap or no-allocation critical processing with preallocated actor state, explicit scope, bounded queues and fixed budgets; schedule critical threads over background actors and verify interference. Qualify entire system on real hardware; emulation/host unit tests are not deadline certificates.
6. Vendor AOT is optional for initial RTSJ compatibility smoke, but complete guest AOT plus qualified vendor code generation are required for the final strict Java target. Treat vendor JIT, interpretation, startup and class loading as unqualified until bounded.

Do not describe a generic OpenJDK/HotSpot installation as RTSJ-capable merely because priority threads or low-pause collectors exist. A hard-realtime Java track can have managed GC in *noncritical* work if independent vendor proofs establish bounded, preemptible GC interference. A strict critical region should require no allocations or qualified bounded scoped allocations regardless.

## Full AOT: two distinct Java meanings

LLVM: source -> resolved shared semantics -> verified MIR -> LLVM object(s) -> link/runtime/FFI closure -> target native executable. Neither AST interpretation nor runtime LLVM ORC JIT appears in strict artifacts.

Java/Graal:
- VM AOT: native-image compiling the *Truffle language interpreter* only, even with --no-fallback, is not guest-code AOT. Existing native-aot is this limited stage.
- Guest AOT: freeze Oreslang source/import/code closure; generate reachable guest-specific Java bytecode or another compile-time-visible guest implementation; compile this with an AOT-capable Java toolchain, preserving identity/dispatch/actor/continuation semantics and preventing runtime AST eval/JIT fallback.
- RTSJ vendor AOT: same guest-specific methods plus vendor-supported RTSJ adapter/toolchain, potentially a different output artifact than Graal Native Image. Do not conflate them.
- Closed-world hot reload: in strict mode only a fully precompiled, statically verified generation can replace one at a proven quiescence checkpoint, if platform constraints permit; otherwise reject reload.

Build assertions: executable guest functions correspond to source closure digest; all reachable imports and methods resolved, native symbols/runtimes audited, no interpreter fallback on unsupported constructs, no guest code generation at runtime, no timing-critical lazy initialization, no hidden dynamic calls outside certified closure. Run startup and representative actor/send/receive/await/cancel/state tests with runtime compiler and source evaluator unavailable.

## Evidence matrix / minimal validation ladder

G0: contract and effect fixtures. Synthetic positive bounded loops, budgeted actor sends, bounded cleanup; negatives for recursion, hidden allocation, unknown FFI, blocking I/O, unbounded queue, stale arena handle and unchecked suspension. Differential Java/LLVM compiler diagnostics and versioned conformance receipts.

G1: LLVM native AOT smoke and no-GC image audit. Build real guest native binary with no Ores interpreter on PATH; inspect IR *and linked image/runtime/FFI closure*; assert no GC runtime, no hidden allocations in strict handler, deterministic drop on all exit paths. Run ASan/UBSan/TSan where applicable. Compiler-generated actors and async must be included, not only host C++ tests.

G2: native actor correctness. Validate fixed preallocation, WCET-sensitive cleanup, mailbox full handling, generations/ABA, actor min/max threading restrictions, owner death, DMA/FFI quiescence, implicit *_blocking suspension, cancellation and physical-exit acknowledgements.

G3: scheduling. On named RTOS/board first and on PREEMPT_RT Linux separately, bound release jitter, wake overhead, IRQ/preemption/lock blocking, page faults, stack usage, cache interference and resource contention. Machine-checked timing assumptions where feasible; stress/load measurements only corroborate, do not prove absolute WCET.

G4: Java allocation and collector. Per-operation allocation profiler/JFR (where supported), live heap/root tracking, GC CPU/pause quantiles, actor teardown/restart and 24+ hour allocation/footprint saturation run. Compare hosted JVM and Native Image GC modes *separately*. If Epsilon is used, prove total allocation fits a finite lifetime budget.

G5: real-time Java vendor spike. Compile a real source-generated Java actor program, run on real RTSJ JVM, exercise scoped memory and releases, verify exact compatible classfile version, and produce vendor/hardware-bound timing evidence. No success claim for Truffle engine unless independently executed on that VM.

G6: full application qualification. Source-to-executable closure proofs, independent negative admission tests, measured maximum and long-tail latencies under adversarial load, formal/reviewed resource and schedulability analysis, documented certification assumptions, platform security and release signing. Release only the specific artifact/target pairing certified.

Always record exact source/PR Git tree SHA, executable SHA, toolchain, platform, inputs and real executed test logs. A doc, host-only CTest, QEMU smoke, unavailable Actions runner or unreviewed CI mirror is not a passed whole-stack hard-realtime gate.

## Repository responsibilities: no new repository required for phase 1

- oreslang-common-source: this normative policy; eventual timing/effect ABI, HIR/MIR semantics, verifier and shared negative fixtures.
- oreslang-target-profiles: versioned strict-RT deployment profile/capability manifest and fail-closed closure admission. Metadata alone does not enforce timing.
- oreslang-source.llvm: source lowering, owned heaps/arenas, deterministic drops, true no-GC native image, time-critical scheduler and native AOT.
- oreslang-source.java: allocation audit; program-specific classfile/guest AOT path; experimental RTSJ facade under a separate module/source set; Graal runtime benchmarking.
- oreslang-platform.embedded: Cortex-M/Zephyr and later RISC-V/RTOS interrupt, memory and board timing experiments; keep the bare-metal core OS-free.
- oreslang-platform-conformance: portable resource/effect and differential guest fixtures; hardware/VM-specific runs link to evidence, not assumed portable.
- oreslang-platform.iot or runtime platform adapters: optional target-specific RT Linux packaging. No new repository needed for a Linux RT package until a distinct lifecycle warrants it.

Do not create an oreslang-realtime, oreslang-gc or oreslang-rtjava repository solely for planning; those would duplicate backends and split release provenance. A vendor-licensed adapter, board-support package, or independently maintained WCET tool **may later** merit a separate repo when licensing, access or release cadence demands it. The first milestone is a versioned contract plus a small executable guest prototype in each relevant existing backend.

## Ordered delivery slices

P0 (spec/admission): agree exact terminology, versioned strict-RT manifest, independent timing/effect classification and negative fixtures, bounded budget model, complete closure digest. Document target test platforms.

P1 (LLVM memory): wire source-level classes/records/structs, fields, closures, async frames and actor state into OwnedHeap/EpochArena with deterministic drop and generation-checked handles. Prove actor quiescence, FFI and cancellation; build/inspect whole no-GC executable.

P2 (LLVM realtime): static actor/mailbox/continuation admission, bounded scheduler and cleanup, runtime behavior on Zephyr/RTOS with ISR-safe transport; then PREEMPT_RT hardware lab and WCET/release-jitter analysis. Treat the embedded scalar actor adapter as a starting point, not product completion.

P3 (Java low-GC): JFR and equivalent allocation probes on actual guest actor workloads, preallocated primitive/data-oriented state, off-heap/RTSJ region experiments; no claims about per-actor independent Java collectors.

P4 (Java strict RT): choose RTSJ vendor SDK and supported Java level, generate a tiny native-compatible Java classfile Oreslang program, compile with vendor AOT, implement region + periodic release + bounded actor mailbox adapter, test on real hardware. Stop at vendor capability gaps rather than emulate missing guarantees.

P5 (complete guest AOT): shared resolved MIR and backends produce closure-complete LLVM binaries and Java guest-specific bytecode/native images; freeze imports and features, reject fallback, verify runtime no-codegen tests. Incrementally expand through receive/await/supervision to whole apps.

P6 (qualification): publish exact artifact receipts and review assumptions before claiming any stated deadline on a named board/OS/RT JVM. Hard-real-time support is a qualified subset, not a blanket description of all Oreslang programs.

## Primary technical references

- RTSJ specification scoped, immortal and heap area rules: https://www.rtsj.org/specjavadoc/design.html
- RTSJ NoHeapRealtimeThread model: https://rtsj.org/specjavadoc/javax/realtime/NoHeapRealtimeThread.html
- JamaicaVM 8.11 RTSJ 2.0 API overview: https://www.aicas.com/jamaica/8.11/doc/rtsj_api/javax/realtime/package-summary.html
- JamaicaVM product capabilities (vendor claims): https://www.aicas.com/products-services/jamaicavm/
- Graal Native Image memory management and Epsilon: https://www.graalvm.org/latest/reference-manual/native-image/optimizations-and-performance/MemoryManagement/
- Graal closed-world compiler/runtime semantics: https://github.com/oracle/graal/blob/master/docs/reference-manual/native-image/README.md
- Linux realtime kernel configuration requirements: https://cdn.kernel.org/doc/html/latest/core-api/real-time/kernel-configuration.html

