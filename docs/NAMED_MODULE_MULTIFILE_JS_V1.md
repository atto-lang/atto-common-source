# Multi-file named modules, package imports and JS/ESM lowering — proposed v1

Status: **proposed contract and executable source-free reference oracle only**. No Java, LLVM, .NET, Forge, Wasm or JS compiler execution is certified by this PR.

## Decision

A named Oreslang module is a logical namespace, not a file. The compiler may aggregate **explicit fragments** of the same named module across multiple source files **only within one verified PackageInstanceId**. Ten files can define three modules; importing one of those modules resolves its complete checked, visible member set. One package can import a public module from a different resolved and pinned package instance via one import.

Preserve three existing distinctions:

1. The file-header 'namespace source_name;' is flat, source-level compile-time metadata. Do NOT reinterpret identical header names as import permission, package authority, or automatic module merging (Java namespace/module boundary PR #2169).
2. 'define module Name as ... end' is the named implementation/value scope. Its partial fragments are assembled at link time; imports are not textual includes.
3. A package is an immutable build-graph ownership realm, not a namespace, runtime isolate, actor security boundary, or directory. Package grouping and scoped pub are defined separately in PACKAGE_VISIBILITY_AND_MULTIFILE_V1.md.

No new 'namespace' declaration keyword is required. Prefer extending the existing 'import module' selector to resolve a package-graph target rather than introducing another runtime namespace form. The following syntax **is an intended interface, not currently accepted uniformly by backends**.

    // package analytics, file src/compute/math.ores
    namespace analytics_source;
    define pub module compute as
      pub fnc add(int a, int b): int { return a + b; }
    end

    // same package, file src/compute/stats.ores
    define pub module compute as
      pub fnc double(int n): int { return n * 2; }
    end

    // consumer package, dependency alias 'analytics' pinned in its manifest
    import module compute from "pkg:analytics";
    pub fnc answer(): int { return compute.double(compute.add(20, 1)); }

One import selects the **module**, not a file, directory, wildcard or a synthetic aggregator source file. A package may declare multiple modules and a file may contribute to multiple modules. Fragments must all be discovered through the verified project/dependency source graph, not by ambient recursive filesystem search.

## Identity and assembly

- ModuleIdentity = (PackageInstanceId, flat module name). SourceUnitId and SourceSpan identify each declaration/fragment. An identical source 'namespace' header does not merge modules across packages.
- PackageInstanceId is derived by the manifest/dependency graph as described in the existing package-visibility contract. Two different installed versions/aliases never share identity even when their package names and module names match.
- The manifest v2 package membership and explicit source file lists are prerequisites; the assembler does not grant membership to stray, nested-manifest, symlink-escaped or unlisted source files.
- Do not accept file order, traversal order, import order, CWD or symlink spelling as semantic tie-breakers. Reject duplicate definitions at the same overload identity, kind/name conflicts, and conflicting module visibility/contract/initializer metadata. Distinct function overload arities may coexist only when existing overload rules allow them.
- Require **explicit compatible module visibility** on each fragment. A private/file-root fragment must not silently join a public multi-file module. Module and member visibility intersect. Default-private members remain private to their defining fragment in this v1 partial-module model; cross-file callers must use public or package-scoped exports. A 'pub[file]' member cannot become package-public merely because its parent module is shared.
- A public module may expose 'pub' members externally and 'pub[pkg]' members only within the exact package instance. A package-scoped module cannot be imported from another package, regardless of member pub. Wildcards, aliases, public facade exports and JS barrels cannot widen visibility.
- A single module import assembles the whole *reachable declared module interface* before checking qualified names; no duplicate lazy source loading. Preserve strongly connected components, deterministic once-only init and reject unsafe observable initialization cycles until properly lowered.
- Prevent public signatures from leaking narrower-visibility types; preserve checked effects, ownership, actor state seals, symbol identities and full type/method overload provenance through assembly. 'pkg:' is not host access or a filesystem capability.

## Package specifier (proposed)

Keep the existing explicit 'import module Name from "<source file>"' behavior. Add 'pkg:dependency_alias' as a separate **manifest-resolved** module target. The alias selects exactly one pinned PackageInstanceId; the import's module name selects the module inside that package. The same-package alias is allowed only when manifest metadata resolves it to the exact same package instance. Missing, ambiguous, unpinned or undeclared aliases reject. Never fall back to ORES_PATHS, ORESLANG_PATH, JS node_modules, npm, cwd, symlink traversal, relative source search or a different version.

This is not yet a working zed-pkg importer. Versioned package dependency resolution, source-list membership and attestations must be implemented before the syntax is promoted into a shipping compiler.

## JavaScript / ES module transpilation

Emit **one compiled .mjs module per source unit**, and a *generated module entry .mjs* for each publicly importable logical module. For example:

    // dist/compute.mjs (GENERATED FROM VERIFIED EXPORT BINDINGS)
    export { __ores_add as add } from "./compute/math.mjs";
    export { __ores_double as double } from "./compute/stats.mjs";

    // consumer output
    import * as compute from "./resolved/pinned-analytics/compute.mjs";

The symbol names shown above are emitter-chosen examples. The real emitter must mangle JS reserved identifiers, preserve overload dispatch and separately emit types into declaration metadata. It must never concatenate source text or treat transpilation as an untrusted JS 'eval'. The entry's public exports derive from the *resolved effective export table*, never 'export *' from arbitrary file paths. Package-private members may use compiler-internal linking but MUST NOT be published as public ESM entry exports. Publishing JS source is not an actor/security isolation boundary.

ESM has live bindings and cyclic-module TDZ behavior. Define and test once-only initialization and cycle admission explicitly instead of relying on JS import order. Static qualified lookups permit tree shaking; truly dynamic namespace indexing requires conservative reachability or explicit rejection under restricted AOT profiles. Preserve deterministic source maps, manifest/package provenance, graph fingerprints, module identity, hot-reload compatibility and stable import ABI hashes. Cross-package module re-exports require explicit independently checked syntax; importing is not implicit re-exporting.

## Required compiler proof gates

1. A 10-file package with three module identities compiles and runs; importing a module from one other file can call all accessible members declared across its fragments.
2. A distinct consumer package imports a public multi-file module through one **pinned** package alias; changing alias version changes identity and invalidates dependent ABI/build products.
3. Reject duplicate definitions, same-name conflict with different declaration kinds, missing namespace, mixed module visibility, ambiguous aliases, unlisted ownership, parent/child manifest crossings, hardlink/symlink duplicate identity and visibility/type leaks.
4. Prove private/file/package/public access, wildcard and alias behavior, overloaded callable resolution, imported actor/symbol ownership, cycles and once-only init across graph boundaries.
5. ESM codegen golden tests: one entry per module, one source output per source unit, deterministic explicit re-exports, no private/package-only leaks, stable mangling, source maps, safe dependency paths, no code generation on failure.
6. Run **real** .ores compile/link/execute fixtures in Java and LLVM first, then .NET, Forge, Wasm and JS. Test output after deleting/hiding source files and use an independent JS oracle (Node or browser). Host model passing is not compiler execution.
7. Record exact backend source/tree SHA, executed job step details, fixtures, exit codes, zero skipped cases, and explicit per-backend statuses. Never claim five-backend parity based on a source-free model or GitHub Actions jobs that did not execute.

## Integration / conflicts to reconcile

- Java PR #2169 distinguishes source namespace and module and reserves '__root__'.
- Java PR #2066 adds explicit export binding provenance; use its effective exports, not ad hoc 'pub' AST flags.
- Java PR #1315 adds lexical module-scoped imports; fragments must not leak a module's import prelude into other fragments.
- Shared PACKAGE_VISIBILITY_AND_MULTIFILE_V1.md currently describes a **proposed** manifest schema v2, not an implemented feature.
- Existing native module linking (LLVM, .NET) selects individual source units, and LLVM currently fails closed for linked source namespaces. These are known gaps, not permitted alternate semantics.

The companion JSON fixture and Node test run a deliberately narrow source-free link/export model to catch contract inconsistencies. They are NOT substitutes for Oreslang compiler or JS transpiler integration tests.
