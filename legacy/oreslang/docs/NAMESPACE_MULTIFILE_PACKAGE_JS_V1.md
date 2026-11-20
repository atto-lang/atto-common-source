# Package-local multi-file namespaces and JS ESM lowering — proposed v1

**Status: proposed contract with source-free reference tests only. No real Java, LLVM, .NET, Forge, Wasm or JS compiler execution is certified.**

## Decision

**A namespace never spans packages.** A package owns its namespace. Any number of verified source files in any folders **within that same package** may declare the same flat namespace header and contribute exported declarations to it. The namespace's identity is the pair (resolved PackageInstanceId, flat namespace name). Two packages may independently define namespace a, but those namespaces never merge.

A caller imports a namespace from exactly one package, using this NEW proposed syntax:

~~~ores
// pkg:foo/src/compute/math.ores
namespace a;
pub fnc add(int x, int y): int { return x + y; }

// pkg:foo/src/compute/stats.ores
namespace a;
pub fnc double(int x): int { return x * 2; }

// pkg:foo/src/compute/aggregation.ores
namespace a;
pub fnc aggregate(int x): int { return x + 1; }

// app/src/main.ores, dependency alias foo resolves to one pinned package
import ns a from 'pkg:foo';
pub fnc main(): int { return a.aggregate(a.double(a.add(20, 1))); }
~~~

The expected return value is 43. This is target syntax; current backends have not demonstrated it. The ns selector is distinct from existing import module, and single-quoted strings retain their normal parser rules. A namespace import selects a checked namespace interface spanning those three files, not a filesystem file, runtime actor, directory or globally shared namespace.

## Namespace vs module vs package

- **Package instance:** immutable build-graph ownership realm, resolved from verified manifests and pinned dependencies. This is NOT an actor security/isolation boundary.
- **Namespace:** flat compile-time aggregate keyed by (PackageInstanceId, namespace name) across source units carrying the same namespace header, regardless of folder.
- **Module:** existing define module M as ... end value/implementation scope. Its declarations are NOT implicitly assembled across files by namespace import. Modules are separate from namespaces and may appear inside a namespaced source file.

The previous draft incorrectly merged repeated define module declarations. **That model is superseded**. This contract changes the future intended semantics of namespace header from purely source metadata to compile-time grouping. Java draft PR #2169 currently describes the header as metadata only and must be reconciled; do not declare current compiler support based on this contract.

Each source file has **at most one** flat namespace header in v1, and a file without a header does not implicitly join a namespace. There is no syntax for one namespace declaration to enroll another package's files. Named module imports remain separate existing syntax.

## Resolver and assembly

1. Resolve the pkg:foo alias to exactly one pinned PackageInstanceId in the importing package's dependency graph. Missing, ambiguous, unpinned, stale or unauthorized aliases fail closed.
2. Enumerate source units that are **verified members of that package**, using the explicit source list in the existing proposed .ores.pkg.toml schema v2. Namespace membership comes from each file's namespace a; header, **not** from a directory name, matching repository name or the importing package.
3. Collect and typecheck a's declared public and package-scoped members into one namespace interface. Bind lexical name a to this exact checked namespace identity in the importing source unit. No implicit unqualified symbol injection.
4. Preserve every declaration's SourceUnitId, package ID, source span, overload identity, checked effect/ownership, and export provenance. Exported signatures cannot expose inaccessible types. Validate cycles and once-only initialization before emission.
5. Do not use global namespace tables, ambient ORES_PATHS or ORESLANG_PATH, JS node_modules, current working directory, symlinks, unlisted sources, nested package traversal, source text concatenation or recursive directory scans to fill namespace fragments.

Two different versions of foo can each have an a namespace, but version or alias changes invalidate compiled import bindings and ABI fingerprints. No merging across package versions is allowed, even with equal namespace spelling.

## Visibility and hardening

- pub declarations of namespace a are available to importing packages; pub[pkg] declarations are available only to code with the exact same PackageInstanceId; pub[file] only within its defining physical source unit; default-private members remain lexical/private.
- One source file's imports do not automatically become imports of any other source file that shares the same namespace. A namespace import is not a public re-export; re-exporting requires a separately checked explicit declaration.
- A duplicate visible declaration with the same kind/name/overload identity across fragments rejects. Different function arities may coexist under existing overload rules; JS needs an actual dispatcher or fail-closed lowering. Private/file-scoped helpers can reuse names in distinct source files without promoting them.
- No exported symbol can launder package-private or private identity, nominal types, actor state, Symbol IDs, capabilities or foreign runtime authority.
- Cross-package namespace access remains controlled by source-level visibility and runtime capability/ownership checks. A compiler-approved source import does not grant new host permissions or shared isolate state.
- Invalid path traversal, source aliases, conflicting source ownership, nested manifests, stale hot reload and public ABI leaks must reject. This source-free model checks textual paths and source IDs only; it is NOT proof against real filesystem symlink/hardlink attacks.

## Ten files / three namespaces

The actual fixture lives under fixtures/namespace-multifile-v1. Its package foo contains **10 files**: namespace a spans 3 compute files, namespace b spans 4 data files, namespace c spans 3 API files. All namespace identities belong to **foo only**, despite different folders. The app package imports only namespace a from foo and should compute 43.

## JavaScript ESM transpilation

Emit **one .mjs output per source file** plus one generated namespace entry per (package instance, namespace name), with explicitly selected public members. Example generated facade, with paths relative to the generated namespace entry:

~~~js
// dist/foo/namespaces/a.mjs
export { __ores_add as add } from "../src/compute/math.mjs";
export { __ores_double as double } from "../src/compute/stats.mjs";
export { __ores_aggregate as aggregate } from "../src/compute/aggregation.mjs";
~~~

Consumer lowering uses a verified package artifact path:

~~~js
import * as a from "<resolved-pinned-foo-artifact>/namespaces/a.mjs";
~~~

No arbitrary export * from source units, private/package-only leakage, implicit public re-export, dynamic eval or JS global namespace merging. Preserve source maps, mangled JS identifiers, callable overload dispatch, ESM live binding semantics, module cycles and deterministic one-time initialization. Dynamic computed lookup requires conservative reachability or rejection. Compile-time namespace identity remains owned by Oreslang; an ESM namespace object is only generated backend representation.

## Exact required verification

- The ten-file package and separate-package consumer MUST compile/link/execute to 43, first on Java/Graal and LLVM, then .NET/Forge/Wasm and a real Oreslang-to-JS transpiler. One import must resolve three members contributed by three files.
- Reject undeclared/ambiguous alias, missing namespace, package-instance mismatch, duplicate public symbol/overload, private/pkg/file leaks, malformed headers, symlink and nested manifest attacks, stale ABI and unsafe initialization.
- Real JS ESM output must load in Node/browser, exercise imports, preserve source maps and never leak private members. Source-free reference tests are not execution parity.
- CI requires exact source/tree SHA and actual steps, tests, exit codes and zero skips. An Actions workflow with no executed steps is NOT a passed test.

Compatibility work: reconcile Java PR #2169 (source namespace metadata), #2066 (resolved public export bindings), #1315 (module-lexical imports), existing PACKAGE_VISIBILITY_AND_MULTIFILE_V1.md manifest proposal, LLVM native module loader's namespace rejection, and the .NET/Forge/Wasm source graph restrictions.
