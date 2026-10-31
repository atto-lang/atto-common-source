# Oreslang developer and systems hardening v1

**Status: proposed shared contract and review checklist; NOT compiler implementation, tested parity, or a conformance certification.** The repository's independent frontends and the existing feature-specific contracts remain authoritative until explicitly superseded. This document is a consolidation of Rust-related ergonomics and systems requirements, not permission to broaden the safe language without proofs.

## Rust comparison caveat (October 2026)

The source complaint list is a useful design checklist, **not** an exact snapshot of Rust's current state. Rust adopted the [FLS](https://github.com/rust-lang/fls) for toolchain qualification work in 2025 (it is not a complete formal proof of the language), and the Rust language team announced an [experimental nightly overloading feature](https://blog.rust-lang.org/inside-rust/2026/08/19/overloading-experiment/) in August 2026. Oreslang should compete on verified capabilities and developer experience, not claim that no specification work or overloading exploration exists in Rust.

## Non-negotiable acceptance rule

A feature moves from `proposed` to `implemented` only after the **real Oreslang source compiler** accepts positive fixtures, rejects negative fixtures with the required diagnostics, and runs target-appropriate executable cases. Separate parser, type/effect/ownership, interpreter/AOT, and runtime behavior. Simulated binders, schemas, mocked host code, docs, IR string assertions and workflows that never started a step are **not** execution evidence.

The five primary consumer backends are `oreslang-source.java`, `.llvm`, `.wasm`, `.net` and `.forge`. Record distinct results for each; never substitute the Java result for LLVM or a host-only Wasm model for native Wasm. A backend without the feature must **reject explicitly**, not silently fall back to unchecked behavior.

## Design constraints and implementation work

### 1. Overloads, optional/default arguments, named calls — P0

Keep the existing source-call selector: owner/namespace, static vs instance domain, name and **expanded value-argument arity**. The `self` receiver is not a value argument; effects, return type, parameter names, primitive widenings, generic erasure and mutable-receiver spelling must never become overload discriminators. Same-arity overloading is reserved for the separately reviewed eligible **nominal enum identity** extension, not arbitrary primitive types. Duplicate effective call arities from defaults, optional slots or varargs **fail at declaration admission**, including imported/override declarations. Do not choose by declaration order.

Preserve the staged existing proposals instead of inventing another default syntax: optional formal slots `T? name` with typed `Option<T>` in the callee, contextual `omit` / `_` for a positional absence, explicit `None` as a *supplied* value, and a parameter-local compile-time `@Default(literal)` where type checked. Missing `Option<T>` produces the outer typed `None` unless the explicitly specified default applies; explicit `None` overrides it. Runtime default expressions and silently evaluated omitted positions are forbidden in v1. A trailing rest collection is empty on omission, never `None`. Named value arguments use `name: expression`, with lexical **single evaluation** and static permutation into declaration order; `name=expression` remains distinct generic metadata or assignment, not named-call syntax. Defaults never allocate a runtime label dictionary.

Existing anchors: Java `docs/METHOD_OVERLOAD_ARITY_CONTRACT.md`, `docs/NAMED_ARGUMENTS_CONTRACT.md`, `docs/NOMINAL_ENUM_OVERLOAD_CONTRACT.md`; Java issues #1455/#1336/#1337; LLVM issues #663/#625 and draft #623. These features are not all enabled in source compilers.

### 2. Public ABI without freezing implementation ABI — P0

Publish a **versioned, opt-in external component/API ABI**, not an assertion that the internal LLVM/JVM/.NET/Forge object layout or vtable has become stable. A v1 public ABI must define canonical type/enum identities, checked scalar widths and endianness, alignment/layout where directly exposed, explicit string/buffer length and encoding, tagged Option/Result, error/status propagation, allocator and destroy pairing, and owned/borrowed/pinned/generation-checked handles. Expose no untracked guest pointer across relocation, hot reload, actor shutdown, FFI callbacks or suspension. A consumer must reject mismatched major ABI versions/features, layouts or missing drop functions **before** invoking the export. Published package interfaces carry signature hashes/semantic IDs independent of native name mangling.

Use target adapters: WIT/Component Model for admitted Wasm components, a narrowly defined C ABI shim for native FFI, and versioned host adapters for JVM/.NET; ordinary opaque `wasm32` binaries are not automatically components. Never claim that a rich cross-language ABI has shipped merely because a C shim compiles. See common-source `docs/SCHEMA_AUTHORITIES_WIT_AND_FORMAL_ASSURANCE.md`, `docs/STRING_ABI_V1.md` and Java `docs/NATIVE_RUNTIME_ABI.md`.

### 3. Normative specification and testable diagnostics — P0

Build a versioned normative subset covering tokens/grammar, name binding, semantic identities, nominal vs structural types, initialization, overload/default binding, ownership/borrow and outlives, async suspension, actor state/CONTROL boundaries, exceptions, effects, module visibility, FFI and observable error ordering. Each rule needs an explicit positive and negative source vector and deterministic diagnostic class. Prioritize small-step or transition semantics for move/borrow/drop, optional-call binding, state regions and actor teardown. Formal models and differential tests are **supporting evidence**, not evidence of complete language or compiler formal verification; safety-critical qualification requires separate toolchain and target certification.

### 4. Classes without hidden costs — P1

Keep classes, interfaces/traits, abstract/sealed classes, controlled overrides and the actor-as-special-class model. Disallow ambiguous multiple-parent slots; inherited signatures preserve labels, effects, capabilities and visibility. Do not add deep dynamic inheritance dispatch to the strict RT profile without a bounded, statically admitted call target set. Ordinary class fields preserve the language's immutable-default rule; actor state remains sealed behind checked `critical-read` and `critical-write`. Explicit inverted class/struct/collection layouts must not silently recursively transform nested storage. Prefer composition over implicit hidden boxing or repeated virtual lookup.

### 5. In-place construction and pinning — P0

Expose an eventual typed **library allocation API**, e.g. illustrative `region.emplace<T>(args)` (NOT currently admitted Oreslang source syntax). The constructor writes **directly into the final aligned storage**, with no required temporary complete object or semantic move. The region/slot owner reserves capacity, validates layout and constructor effects before publication, and tracks per-field initialization for panic/raise/throw/cancellation rollback: exactly-once cleanup of initialized fields, no read of uninitialized bytes, no double drop. A self-reference is legal only through a post-publication non-owning generation-checked handle (or an explicitly proven pinned reference); raw escaping self-addresses and use-after-region-close reject. Bounded preallocated region placement is the sole initial strict hard-RT candidate. Out-of-memory is a typed fail-closed result, not unexpected runtime allocation.

### 6. Borrow-checker usability without weakening safety — P0

Infer *lexical* loan endpoints, reborrows, immutability and non-escaping lifetimes where unambiguous; report the moved place, origin loan, conflicting use, await/critical/actor boundary, and actionable alternative. Keep explicit `rt borrow`, `rt borrow mut`, `rt take`, `rt share` and type-level borrow forms consistent with the existing language contract; do not copy Rust's `&`/`*` surface by accident. A borrow must never outlive an owner or suspend across unpinned mutable state; compiler-generated continuation frames may retain only proven pinned storage. Dynamic generation checks can guard explicitly admitted handles, but **do not replace static safety for ordinary references**. Actor transfer preserves Sendable/Serializable distinctions.

### 7. Cyclic graphs and self-referential data without tracing GC — P0

Use a uniquely owned arena/graph with generational non-owning `Handle<T>` edges for self-links, parent links and doubly linked lists. Removal increments generation; stale, cross-actor or retired-domain handles fail deterministically. Strong reference cycles must not be allowed to bypass ownership, leak immutable roots or depend on Java GC timing. No implicit trace collection on LLVM. Java/Graal can use managed host wrappers but cannot present them as deterministic physical reclamation. No actor arena reclamation before all source tasks, I/O completions, borrows, producer admissions and FFI leases have **physically quiesced**. See Java `docs/CIRCULAR_REFERENCES_AND_GC.md` and common-source `docs/MEMORY_SAFETY_AND_PERFORMANCE.md`.

### 8. Developer build speed — P1

Make fast check/diagnostics and debug builds separate from fully optimized native release builds, without relaxing type/ownership/effect checking. Build an incremental dependency-query graph whose cache key includes source plus exported signature, generic specialization, effect/ownership/capability contract, compiler/target flags, dependency closure, toolchain and platform profile. Body-only edits may reuse unaffected typed callers; signature or inline-body changes invalidate affected dependents; negative lookups must invalidate when a newly introduced symbol resolves them. Cache corruption must cause re-evaluation, not unsafe stale code. Measure cold, no-op, body edit, signature edit, link and cross-target times separately, without declaring benchmarks as parity. The common-source `experiments/incremental_query` work is a reference model, not a native cache implementation.

### 9. Dependency discipline — P1

Use the existing `.ores.pkg.toml` manifest/root-discovery model and `+` project-root imports; propose a deterministic lock format before enabling network resolution. Require exact artifact hashes, signed/attested provenance when available, explicit permission/capability declarations, transitive graph and SBOM, offline reproducibility and audited standard-library dependency budgets. No unreviewed download/build script in hard-RT or untrusted build profiles. A compromised/yanked dependency or version mismatch fails closed under a strict lock. Stable package APIs need machine-readable compatibility checks and planned deprecation windows, not merely a `1.0` label.

### 10. Release ecosystem and appropriate usage — P2

Define stability by separately versioned language, core/alloc/actor/std, source-format, package interface and exported ABI profiles; use semver compatibility gates on public signature/behavior changes. Keep a small trusted core and major batteries-included core libraries without forcing hundreds of transitive packages. Benchmark and qualify real use cases: CRUD/CLI can choose Java/Graal productivity mode; deterministic native/embedded/physics workloads can choose LLVM; Wasm/.NET/Forge are separate explicit targets. Do not market universal hard-real-time, zero-allocation, no-JVM-GC or faster-than-Rust claims without exact linked-artifact, workload and platform proofs.

## Cross-cutting release gates

1. **P0 semantics:** portable positive/negative Oreslang fixtures; parser, type/effect/ownership analysis and formatter round-trip; include borrowed/defaulted/overloaded constructor and actor boundaries.
2. **P0 lifecycle:** LLVM sanitizer and linked-runtime no-tracing-GC audit, failed/partial initialization and cancellation; Java physical quiescence, Native Image/AOT and exception cleanup. Distinguish host JVM GC from guest arenas.
3. **P0 ABI:** external v1 adapter with real load/unload, version incompatibility, ownership handoff, hot-reload and late-callback rejection.
4. **P1 build:** deterministic lock/build receipts, incremental invalidation and cold/warm budget benchmarks; no benchmark threshold inferred from the reference simulator.
5. **P1 parity:** separately exercise Java/Graal, LLVM native, Wasm, .NET Native AOT and Forge, and record honestly unsupported combinations. Keep schema/fixture/model tests labelled DESIGN/REFERENCE. A zero-step GitHub Actions result is NOT_EXECUTED.
6. **Security:** do not copy private source to an unreviewed carrier or different organization; any privately approved exact-tree test runner must independently prove source/ref/branch/tree identity and preserve the protected-main policy.

## Related staged implementation tracks (do not duplicate)

- Common-source [draft PR #198](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/198): inferred outlives, suspension and native zero-GC obligations; authoritative on detailed lifetime semantics pending review.
- Common-source [draft PR #170](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/170): explicit unsafe/FFI authority boundary; no implicit safe-pointer escape hatch.
- Common-source [draft PR #173](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/173): escape-analysis/placement optimization admission; not general user-visible emplacement semantics.
- Java [issue #1455](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1455) and LLVM [issue #663](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/663): staged typed parameter-default lowering; do not fork the syntax.

## Machine-readable review corpus

The companion file `contracts/v1/developer-systems-hardening.v1.json` is a **candidate test inventory**, not execution evidence. `tests/developer-systems-hardening-v1.test.mjs` checks that each area has documented accept/reject scenarios and fail-closed evidence rules; it does not compile any `.ores` program. To upgrade an individual case, attach the exact source/tree SHA, backend compiler artifact digest, emitted/linked artifact digest, toolchain/profile, actual observed output/diagnostic and executable run URL. Never change `planned_only` based only on this manifest or schema check.
