# AttoLang namespace-granular incremental compilation v1

**Status: proposed cross-backend build contract; reference planner tested locally. Not implemented or verified across all compilers.**

## Decision

A **package instance** is a dependency-resolution, visibility and output-bundle boundary, **not the minimum recompilation unit**. A package may own many flat namespaces; one namespace may be spread across multiple `.atto` files and directories (but must never absorb another package's files). Namespace identity is `(resolved PackageInstanceId, namespace name)`. `define module` remains a distinct language construct and does not implicitly merge namespace fragments. Each file has at most one namespace header in v1; it can contribute private and public declarations to the namespace. The compiler can do finer function/codegen-unit caching inside a namespace when dependencies are proven.

Example:

```atto
// shop/src/users/user.atto
namespace users;
pub fnc user_id(int x): int { return x; }

// shop/src/users/login.atto
namespace users;
pub fnc active_user(int x): bool { return x > 0; }

// shop/src/payments/charge.atto
namespace payments;
pub fnc charge(int cents): int { return cents; }
```

Updating `login.atto` with the same exported interface must not force `payments` to re-typecheck or regenerate. The package may need to relink; only affected namespace objects should be regenerated. A changed public contract for `users` invalidates verified importers of `users`, including cross-package importers, but not otherwise unrelated namespaces. An effect/ownership/actor-protocol/typestate/public-const change counts as an interface change even if its function name and parameter types are unchanged.

## Reference model and artifact identity

- [`contracts/namespace-incremental-v1.schema.json`](../contracts/namespace-incremental-v1.schema.json) describes a **validated, trusted compiler snapshot**: package instance ID and manifest digest; source-relative unit path, owner namespace and SHA-256; namespace interface SHA-256, resolved interface-import edges and inline-body edges; semantic and target codegen profile digests.
- [`experiments/namespace_incremental_v1.py`](../experiments/namespace_incremental_v1.py) models conservative re-typecheck, re-codegen, removals and dependent package relinking; [`tests/test_namespace_incremental_v1.py`](../tests/test_namespace_incremental_v1.py) exercises cold/no-op/edit, multi-file, ABI, inlining, deletion, manifest, toolchain, package-identity, cycles and malformed snapshots. **It does not parse `.atto`, load source, compile guests or validate trusted origin.**
- Before any cache hit, the real compiler must re-establish the *complete* manifest-pinned source-set and namespace membership, import bindings, source content hashes, macro-generated units, physical path/ownership constraints, visibility, compile-time constants, negative lookups, exported type/effect/ownership/actor contracts and all relevant dependency digests. The reference model accepts precomputed `interface_sha`; treating that field as a user assertion is unsafe.
- Persistent cache keys must be domain-separated and versioned, including frontend/IR contract version, compiler/toolchain version, target triple/features, execution profile, flags, imported package lock identity, canonical expanded source/code unit, public ABI and dependency digests. Never reuse another backend's object-code cache. Backend-neutral AST/HIR/MIR may be shared only when its exact verified schema/semantic/feature versions match.

## Invalidation and publication rules

| Change | Required action |
| --- | --- |
| No effective change, including source-map order | Reuse approved namespace artifacts |
| Private/body-only source edit | Recheck and regenerate the owning namespace (or finer verified unit); reuse caller typing and other namespaces |
| Inline/specialization/body embedding | Regenerate consumers that embed the changed implementation, including transitive inline consumers |
| Public ABI, effects, ownership, contracts, symbol resolution or namespace registration | Re-typecheck affected importers, including negative lookup and SCC closure; regenerate any changed codegen |
| File addition/removal, namespace reassignment, package lock rebinding | Re-enumerate all members; invalidate affected namespace(s) and dependent resolution and link artifacts |
| Manifest/semantic build-profile change | Recheck affected package namespaces and any dependents whose resolved bindings change |
| Target/codegen options or compiler version change | Regenerate corresponding target artifacts; reuse typed IR only if semantic inputs are proven unchanged |

A namespace can contain multiple sources and is compiled as a logical group, but object emission may occur per function/source fragment. Compile-time macros, generics, specialization, constant folding, whole-program/LTO optimization, reachability pruning, global initialization, actor hot-load generations and state-layout contracts can create extra cross-namespace edges. The backend must track those edges or conservatively recompile. SCCs require a bounded, deterministic interface-first plan rather than silently assuming an acyclic import graph.

Retyping an importer does not imply its transitive callers must be retyped if a correctly recomputed importer ABI stays unchanged; the reference planner currently uses a **safe conservative reverse-import closure**. This may be optimized later only with independent differential evidence.

Never publish a partially completed or failed build into a reusable cache. Hash stored artifact bytes, verify provenance before reuse, stage outputs in an isolated temporary location, and atomically commit the complete validated snapshot. A corrupted, incompatible or unauthorized cache entry must result in a clean rebuild or explicit error, never an unverified compile shortcut.

## Required compiler API and CLI behavior

1. `compile_package(snapshot, changed_units?, target)` rechecks complete pinned membership and computes namespace-oriented rebuild sets. Backend-specific names are permitted, but must report the same semantics.
2. `atto build --incremental` is the intended CLI operation; `--clean` forces a full rebuild and `--explain-rebuild` should print per-namespace causes, target identity, ABI-vs-body decisions and relink causes. These are **proposed UX**, not current supported flags.
3. For an exact snapshot/target, incremental and clean builds must have equal diagnostics, public interface, generated guest behavior and reproducible artifact bytes where deterministic output is promised. Debug path/timestamp fields must be normalized or explicitly exempted by reproducibility contract.
4. Disabled/unsupported incremental mode must fail explicitly or fall back to correct clean compilation; it must never skip semantic work and then claim incremental support.

## Backend rollout and evidence

- **Java/Graal**: extend the existing `IncrementalCompiler` (file-unit ABI reverse imports); reconcile overlapping draft AST/cache PR #697, namespace PR #1536 and package PR #1545. Real compilation must happen after the manifest/namespace gate.
- **LLVM, .NET NativeAOT, Forge, Rust compiler (`atto-source.rs`), JavaScript, Cranelift, HDL**: implement pinned package/namespace graphs and target-specific codegen invalidation with executable actual source fixtures. Rust compiler output to wasm32 belongs to `atto-source.rs`; `atto-source.wasm` owns separate Wasm backend/ABI and should not claim a second compiler exists. `atto-source.atto` and `atto-source.realtime` are bootstrap/planned repositories, not production compiler evidence.
- **Cross-backend**: `atto-platform-conformance`/`atto-compilers-parity-testing` should run identical 10-file/3-namespace clean-vs-incremental scenarios: no-op, body edits, ABI/effect changes, inline/call-graph edits, namespace move, file deletion, pinned dependency version swap, cycles, negative imports, corrupted cache, compiler/profile swap, and actor hot-loading compatibility. Measure per-namespace parse/type/codegen counts and artifact hashes, then execute positive and negative guest programs on each supported backend. Mark unimplemented/untested modes `UNSUPPORTED` / `NOT_EXECUTED`, not `PASSED`.

Related existing contracts: [`NAMESPACE_MULTIFILE_PACKAGE_JS_V1.md`](NAMESPACE_MULTIFILE_PACKAGE_JS_V1.md), [`COMPILATION-POLICY.md`](COMPILATION-POLICY.md), existing experimental `incremental_query.py` and tests. The canonical language-level namespace/import syntax remains owned by `atto-spec`; this document addresses build semantics and does not introduce new source keywords.