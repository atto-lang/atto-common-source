# Oreslang top-12 language feature admission and formal AOT gates (v1)

**Status: proposed cross-backend language contract and source-free acceptance program. No verified implementation/parity claim.** This is an incremental umbrella, not a replacement for existing authoritative contracts. It covers the 12 opportunities identified in October 2026. The feature catalog `fixtures/top12-aot-feature-gates-v1.json` and its Node test describe expected compiler behavior, not actual backend execution.

## Non-negotiable global constraints

1. **Two required native guest-AOT targets:** LLVM compiles reachable Oreslang guest code and continuations into linked native machine code, and Java/GraalVM generates *program-specific guest code* included in GraalVM Native Image. A Native Image containing only the Truffle source evaluator **does not qualify**. No feature may require a runtime macro expander, source AST interpreter, JIT, class synthesis, reflection dispatch, unbounded generic specialization, SQL compiler, generator-fusion JIT, runtime reactive expression compilation, or runtime regex engine that compiles new Oreslang code.
2. **Strict code closure:** finite monomorphizations/witnesses; fixed storage layouts, codecs, message handlers, resource effects, permission ceilings, and generated accessor/validator functions. Unsupported dynamic features fail at compile time **before emitting a runnable artifact**.
3. **Ownership, permission and error discipline:** never mint a capability from type metadata, reflection, a schema, annotation, trait witness, actor message, cast or hot reload. `throw`, `raise`, `panic` and cancellation remain distinct. Panic always reaches supervisor CONTROL; neither recover nor query/stream/reactive adapters may swallow it.
4. **Sealed actor state:** no extra guest persistent actor instance fields; private mutable state is accessible only by compiler-checked critical read/write loans. No borrowed state, register MMIO pointer, atomic guard, secret or mutable transient may escape through an await, Task, actor pipeline, stream, FFI callback or hot generation unless the independent ownership proof permits that specific transfer.
5. **Formal verification is part of admission:** state-machine/model checking for protocol/hot generations/reactive/cancellation; SMT/abstract interpretation for numeric/refinement/atomic/bitfield proof obligations; effect-aware compiler IR and translation validation. Every proof binds to source tree/typed IR digest, toolchain digest, assumptions and corresponding executable guest fixture; models alone establish only model properties.
6. **Five backend parity accounting:** Java/GraalVM and LLVM must independently execute native guest binaries before a feature may claim dual-AOT implementation. .NET/Wasm/Forge must either implement the same observable semantics with their own AOT-compatible proof or explicitly reject unsupported syntax. Every matrix cell must say `verified`, `compile_reject_expected`, `unsupported`, `failed` or `not_executed`. A static JSON test, zero-step workflow, host mock and compiler parse-only test never count as implementation.
7. **Language ergonomics:** canonical `snake_case` functions/methods; favor library/generator surfaces over new keywords; maintain `|>` for functional composition and `pipe` for actor pipelines. Preserve explicit return, Option/Result and Task/Future semantics.

## 1. Session-typed actor protocols — P0

Existing authority: the [three guarantees draft PR #168](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/168) (not yet on main), [OTP behaviours](OTP_BEHAVIOURS_V1.md), and Java typestate [#1392](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1392).

Compile a finite protocol transition table with message variant, source phase, settlement/next phase, authority and affine ownership of one per-session capability. A copyable `ActorRef<Message>` never proves the global phase of a concurrently used actor. Only supervisor/runtime-minted opaque session epochs can be trusted across generation changes. Admission failure returns unconsumed moved ownership; **accepted** but timed-out operations return an indeterminate/settlement capability, not fabricated old-phase reuse. Actor restarts and unauthorized protocol upgrades invalidate/fence old capabilities; legal generation pinning allows V1 sessions to drain during V2 admission.

Formal gates: illegal state unreachable; unique session token; linearizable admission/settlement; no double send/use-after-take; no reply resurrection, forged CONTROL or double completion; resource-bounded session retention. Check against real compiled actor/Task/await/cancellation traces.

## 2. Refinements and function contracts — P0

Existing authority: [REFINEMENT_TYPES.md](REFINEMENT_TYPES.md) and Zorde/TypeSpec normalized ConstraintIR. Do not create a competing grammar or generic runtime `eval` predicate system.

Canonical `with` built-in constraints and approved pure deterministic `where` predicates lower to typed HIR; bounded SMT/range proofs discharge constants, interval implications and checked function pre/postconditions. Function contracts should initially be **metadata attached to ordinary function signatures** with canonical IR precondition/postcondition facts; exact new source syntax is not frozen here. A caller lacking a proof must explicitly validate, handle typed failure, or be rejected according to declared call contract; arbitrary dynamic input may never implicitly become `Valid<T>`. Every normal return and exceptional/cancellation exit has a separately checked condition; assertions do not imply a hard-RT bound. Validation exists at FFI/deserialization/actor/wire/hot-reload boundaries, with stable versioned schema fingerprints.

Formal gates: overflow and signed numeric extrema, Unicode scalar lengths, NaN/nonfinite semantics, contradictory predicates, immutable validated alias preservation, mutable collection invalidation, postconditions over all control-flow paths and AOT-generated validator closure. Recheck all generated code after macro expansion.

## 3. Associated types and coherent protocol witnesses — P0

Existing direction: [AOT_LANGUAGE_CLOSURE_V1.md](AOT_LANGUAGE_CLOSURE_V1.md), Java generic/trait [#1683](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1683), LLVM generic await [#741](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/741).

Associated result/error/item types are compiler-resolved static projections `Protocol::Item` / `Protocol::Error` **as a conceptual notation**, without promising this punctuation as implemented Oreslang syntax. One concrete implementation witness must be uniquely selected for a nominal type/protocol/parameter specialization within the linked compilation domain. Reject overlapping incomparable implementations, orphan-like unauthorized extension, cycles/unbounded generic instance graphs and dynamically open registries. Visibility, ownership, Send/Sync/Sendable, effects and permission requirements flow through the selected witness. Generic defaults and named type arguments still obey the existing checked substitution rules.

Formal gates: deterministic coherence under import order/permutation, ABI/witness hash equivalence, ambiguous impl rejection, static dispatch preserving effect/ownership, complete Native Image/LLVM code closure, no runtime type-class search.

## 4. Typed composable data queries — P1

Existing starting point: compile-time SQL/schema providers in Java [#1394](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1394) and current async actor-confined PostgreSQL work; neither proves a shipped query DSL.

Use a compiler-checked **typed query-plan library**, not a new general `query` keyword. Query expressions may compose projection/filter/join/group/order/limit via statically known schemas and typed parameters. Query plan compilation or template generation happens at **build time**; runtime variable values become protocol parameters, never concatenated SQL identifiers, and cannot synthesize new Oreslang types. Identifier/column selection must come from the statically admitted schema or explicit checked allowlist. The database driver uses nonparking bounded asynchronous I/O; rows stream with explicit backpressure, cancellation, owner lease, transaction rollback and wire-version proof. Host database query planning by the database server is *data processing*, not runtime Oreslang code generation, and is permissible.

Formal gates: type-correct join keys, null semantics, sum/overflow, SQL injection and identifier forgery negatives, actor lease/transaction generation pin, schema drift, bounded row/callback scheduling, idempotent cancellation, no guest source/JIT dependency.

## 5. Lazy iterator and stream fusion — P1

Existing source: [GENERATORS_V1.md](GENERATORS_V1.md), [REACTIVE_ITERATOR_STREAM_CHANNEL_INTEROP_V1.md](REACTIVE_ITERATOR_STREAM_CHANNEL_INTEROP_V1.md).

Optimize only when a compiler proves operator chain composition equivalent **under evaluation order, observable effects, ownership, cancellation, exceptional exits and demand**. Initial fusible subset: total pure `map`, `filter`, `take`, and explicitly total pure `filter_map` over a single-consumer lazy cursor. Stateful/async callbacks, external I/O, `yield*` delegation, `panic`, ownership-changing callbacks, hot Observable, multiple subscriptions and source-reentry are **not automatically fusible**. No speculative pulls; `take(0)` performs zero pulls. Fused and unfused versions must run exactly the same number/order of demanded callback invocations and exactly-once close/defer on break, cancellation or fault. Generate optimized iterator loops/state machines at compile time; AOT code closure does not grow at runtime.

Formal gates: trace equivalence up to the declared pure effects, no duplicated/missing move, terminal-state uniqueness, bounded lookahead, generation/frame pin, no changed callback exception ordering, iterator ownership and close invariants.

## 6. Secret-safe types and cryptographic memory discipline — P1

**New explicit shared contract needed**; ordinary ownership does not by itself guarantee confidential storage or reliable erasure.

Provide nominal, affine `Secret<T>` / protected-region values through a small core/alloc/crypto library; no implicit `string` conversion, interpolation, debugging, serialization, tracing, logging, error rendering, actor DATA, Query `to_string`, Observable capture, macro reflection or FFI. Explicit `expose_secret` requires authorized lexical scope, denied ambient logging/copy, full borrow/effect analysis and bounded physical lifetime. Wipe owned mutable storage on all normal/error/cancel/panic paths, respecting compiler optimizations; use constant-time primitives where specifically verified. **Do not promise universal erasure** of Java heap strings, CPU caches/registers/swap, disk, unmanaged FFI copies, tracing metadata or remote nodes. For GraalVM Native Image, require verified opaque off-heap/native allocation and cleanup paths for claims of controlled erasure. Secret-dependent timing behavior is not automatically constant-time.

Formal gates: secret-taint/ownership noninterference under a stated observation model, no secret clone/implicit logging, zeroization on every exit, generation retirement, FFI/host copies, allocator aliasing, unsafe compiler elision, fixed-time comparison checks on selected primitives. Runtime resource exhaustion must not skip wipe.

## 7. Portable atomic memory model — P1

Build on LLVM [#659](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/659) and Java shared concurrency/Send+Sync [#1437](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1437).

Expose typed `Atomic<T>` (approved scalar widths/targets only) with a **fixed cross-backend ordering vocabulary**: relaxed, acquire, release, acq_rel, seq_cst. Atomic load/store/CAS/RMW require legal operation-specific orders and well-defined failed-CAS constraints. Adopt a coherent language memory-order and happens-before model with target-specific lowering to LLVM IR and Java VarHandle/Native Image equivalents; disallow implicit widening/narrowing, unsupported widths/alignment and portable data-race tolerance. Volatile MMIO and atomic synchronization are distinct. Use sealed actor state loans where actor state is involved, with explicit shared-memory capabilities; no ambient cross-actor mutable aliasing. Strict hard-RT paths require bounded contention/interference proofs; lock-free is not equivalent to wait-free.

Formal gates: message-passing/store-buffering litmus tests with stated allowed outcomes, release/acquire publication, CAS success/failure validity, ABA and reclamation, overflow and target widths, under-weak-memory architectures, no forged shared handles; TSAN/sanitizers where applicable.

## 8. Typed bitfields and hardware-register views — P1

Build on NativePointer/MMIO [LLVM #528](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/528) and verified `unsafe` grant boundaries. Prefer type-generated register layouts over unconditional new syntax.

Declare target-ABI-specific register width, endianness, alignment, field offsets/masks, access mode (read-only/write-only/rw, write-one-to-clear, read-to-clear, reserved), and volatile/ordered access requirements **at compile time**. No field overlap unless explicitly modeled, duplicate name, shift overflow, accidentally truncated mask, reserved-bit write, unapproved address grant, arithmetic beyond mapped window, or reading a destructive register as if pure. No implicit read-modify-write on side-effectful registers. MMIO accesses are effectful, never automatically stream-fused, constant-folded, speculated, or reordered. Volatile is not an atomic operation. Confine raw views to trusted target-granted actors and prove interrupts/DMA/lifetime boundaries.

Formal gates: disjoint bit masks, correct sign/zero extension and byte order, compiler-generated register accessor constant layout, write-one-to-clear semantics, device generation fencing, no CPU hard-RT claim without board/vendor timing information. Unsupported Java Native Image/Wasm layouts reject, rather than pretending real hardware equivalence.

## 9. Compiler-enforced API evolution and language editions — P1

This is not merely SemVer metadata. Compile every source unit under an **explicit edition attached to the package/build graph**, resolved before lexing/parsing and independent of runtime. Avoid edition-dependent interpretation of a dynamically loaded `.ores` string. Keep stable ABI/wire format and explicit compatibility policy across editions and hot-loaded generations. Implement an edition-aware formatter/codemod with proof of output source AST meaning, deterministic migration diagnostics, imports and collision checks, and refusal on ambiguous migrations.

Formal gates: old/new syntax parsing under pinned edition, import dependency edition isolation, no runtime compiler fallback, semantic equivalence for auto-migrated subset, collision and removed API diagnostics, downgrade compatibility where declared, serialization/effects/capabilities/actor schema fingerprint checks. `major` version increase alone does not make unsafe migration safe.

## 10. Executable documentation and doctests — P1

Treat code fences as real source only where a **versioned explicit directive** marks them executable or expected-compile-failure. Never assume all illustrative docs are implementation claims; existing contracts intentionally contain unimplemented syntax. Compile every eligible example with exactly the package edition/import closure and permission profile declared in metadata, run admitted samples as real guest binaries, match stdout/result/diagnostics, clean up tasks/actors and limit CPU/time/heap/IO.

Formal gates: compiler-negative snippets must fail for expected diagnostics, positives must execute actual LLVM guest AOT and GraalVM guest-code Native Image where feature claimed; pin exact MD/source/symbol/toolchain/binary hash, disable ambient network/filesystem/host execution by default, no secret leakage. Doc-only parse tests or interpreter Native Image aren't sufficient.

## 11. Functional lenses and immutable update paths — P2

Start with library-defined **statically generated typed accessors** over records/structs/nested tuples and approved immutable collections. Prefer no new `lens` keyword. Getter and updater bind a compile-time-known field/index path; no runtime reflection, string field lookup or dynamic record type synthesis. Immutable `set` creates an independent safe logical value or proven copy-on-write structural sharing; no borrowed mutable alias to old storage. Explicit updates of owned nested structs retain zero-GC/native arena lifetime proof; inverted AoS/SoA layouts have the same observable logical behavior with backend-specific lowering.

Formal gates: lens get/set, put-put and get-put laws for immutable values under documented equality, alias/borrow/lifetime invariants, actor sealed-state exclusion, incorrect field/tuple index rejection, no foreign pointer or secret escape, AOT generated closure.

## 12. Declarative reactive computations — P2

Build as a **userland library with compiler-checked effect/ownership boundaries** on top of the existing Observable/Stream/Task/Channel contracts; avoid mandatory language syntax. Computed graph nodes are pure and statically typed, with deterministic dependency edges where feasible, explicit subscriptions/observations and bounded per-actor update queues. Cycles are compile-time errors for a statically closed graph or require explicitly declared delay/fixpoint primitives with convergence or bounded iteration evidence. Dynamic dependency graphs require runtime graph admission with quotas, generation fences, no capability multiplication and no model-wide claim of static acyclicity.

Formal gates: glitch-free topological propagation *under the declared transaction model*, deterministic update ordering, exactly-once effect delivery where truly supported, subscription teardown and cancellation, bounded fanout/graph growth, actor-lane scheduling (no foreign callback reentrancy), no source evaluation, scope reclamation and hot-swap generation pins.

## Phases and evidentiary states

- **F0:** shared normative semantics and source-free positive/negative fixtures (this project stage, *not* backend support).
- **F1:** immutable/lifecycle and numeric/ordering model checks with explicit negative mutations; pin solver version + successful solver run.
- **F2:** both independent compilers emit typed parser/typecheck and source-derived HIR/MIR facts, and fail closed on unsupported forms.
- **F3:** actual LLVM linked native and GraalVM program-specific guest-code Native Image executables run positive source fixtures and negative compiler admissions; reject interpreter fallback, missing effects, permission laundering and native resource leaks.
- **F4:** exact compiled source, symbol reachability, typed IR/witness hash, binary/toolchain/solver provenance and runtime trace/refinement report.
- **F5:** release safety, repeated cancellation/race testing, unsafe-lowering sanitizers, AOT hot-generation regression and (if claimed) platform-specific hard-RT WCET/schedulability proof.

Per-feature backend status starts as `not_executed`. A passing contract test can mark F0 design acceptance only; it **never automatically changes backend evidence status**. Do not merge accepted-source feature implementations without passing named negative cases and a reviewed closed-world compilation proof.

## Cross-repo implementation path

1. Bind this v1 catalog and negative oracle in `oreslang-common-source` and `oreslang-platform-conformance` without claiming an implemented common HIR engine.
2. Java: parse/typecheck, ownership/effects/permissions, generated guest compiled JVM method lowering and GraalVM Native Image **actual guest** execution.
3. LLVM: independent frontend typed checker and MIR/LLVM native lowering, ABI/ownership verification and linked native execution, no ORC/JIT fallback.
4. .NET/Wasm/Forge: visible `unsupported` until their own native/AOT-compatible lowering and source-level conformance is independently verified.
5. Require strict independent code review for secret/atomic/MMIO and on-device real-time changes. No private source mirroring into unapproved external/public CI repositories.
