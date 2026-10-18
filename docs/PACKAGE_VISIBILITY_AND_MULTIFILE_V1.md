# Oreslang package visibility and multi-file source packages — proposed v1

**Status:** proposed cross-backend language contract; NOT implemented or certified by Java/Graal, LLVM, .NET, Forge or Wasm. **Existing imports and default visibility remain unchanged until an implementation passes the normative tests.**

## Decision

Use **`pub[pkg]`** for package-scoped declarations and **`pub[file]`** for same-file visibility, alongside existing `pub` and existing default/private scopes. The formatter canonicalizes square-bracket spelling; parentheses and the long `package` identifier remain accepted aliases. Do not introduce an independent `package` modifier or reinterpret `define module` as a package.

- **File/code unit:** one `.ores` source file; imports remain explicit and qualified.
- **Module:** a named namespace declared with `define module`, possibly several per file. Modules do not determine package membership.
- **Package:** a build-time, immutable-for-one-build ownership grouping of one or more source files. Packaging is NOT an actor security/isolation or runtime-capability boundary.
- **Project:** the manifest-selected project root and import-resolution context; may contain several packages.
- **Dependency/package instance:** a resolved, versioned dependency belongs to its own package ownership realm even if it has the same source spelling as another instance.

Rust's `pub(crate)` is analogous to `pub(package)`, but in Oreslang a package is a manifest-defined source grouping, not a GitHub repository, directory, module, or entire project.

## Syntax and visibility

```ores
// src/auth/tokens.ores: package auth
pub[pkg] fnc validate_token(String token): bool {
    return token == "ok";
}

// src/auth/auth.ores: package auth
import fnc validate_token from "./tokens";

pub fnc authenticate(String token): bool {
    return validate_token(token);
}

// src/main.ores: singleton package (not auth)
import fnc authenticate from "./auth/auth"; // allowed
import fnc validate_token from "./auth/tokens"; // COMPILE ERROR: package-private
```

| Modifier | Allowed audience | Exported to external packages? |
| --- | --- | --- |
| `pub` | All importing packages, subject to regular module/export and capability rules | Yes |
| `pub[file]` | Code in the **same resolved source file**, including other modules declared in that file | No |
| `pub[pkg]` | Only source units with the **same resolved package instance ID** | No |
| no modifier / existing `private` | Existing lexical/file/type-private behavior | No |

### Accepted spelling and canonical formatter output

| Source spellings | Formatter output |
| --- | --- |
| `pub[file]`, `pub(file)` | `pub[file]` |
| `pub[pkg]`, `pub[package]`, `pub(pkg)`, `pub(package)` | `pub[pkg]` |

Brackets are canonical because the modifier is a compile-time qualifier, **not** an indexing expression or function call. Both delimiter forms are admitted for ergonomic compatibility, but only matching `[]` or `()` pairs are legal; `pub(file]`, `pub[pkg)`, empty scopes, arbitrary expressions, and unknown scope words reject. `pkg` and `package` normalize to the same `PACKAGE` visibility enum (and equivalent ABI metadata). Scope names are reserved contextually after `pub[`/`pub(`, not globally new identifiers. Bare `pub` retains its existing meaning.

### Scoped visibility on module declarations (normative)

All scoped qualifiers apply to **module declarations** as well as their eligible members. The formatter emits `define pub[pkg] module Auth as` and `define pub[file] module Internal as`. Parentheses and long aliases remain accepted in the same positions as on functions.

```ores
// src/auth/api.ores, resolved package auth
define pub[pkg] module Auth as

    pub fnc login(): bool { return true; }
    // Effective PACKAGE: pub member, package-scoped parent

    pub[file] fnc helper(): bool { return true; }
    // Effective FILE: restricted to src/auth/api.ores

    fnc internal(): bool { return true; }
    // Effective declaring-module only

end

define pub[file] module AuthHelpers as
    pub fnc extra(): bool { return true; }
    // Effective FILE, despite pub member
end
```

For a member `M.x`, access requires **both** visibility checks: the selected module declaration `M` must be accessible to the importer, and `x` must be accessible to the importer in the context of its declaring module. Public children never promote a hidden parent. A package-private module with a `pub` child is still package-private. A file-private module with a `pub[pkg]` child remains file-private.

A private **module declaration at file top level** follows current file-private top-level declaration rules, while a private **member inside a module** is available only inside that same lexical module. These are different lexical owners. Both static type checking and late/dynamic resolution enforce the same intersection; wildcard imports and publicly exported aliases cannot bypass it.

For files in the package, explicit imports of `Auth` are allowed but visibility of `Auth.helper` is restricted to the original source file. For files in a different package (even one with the same package name in another dependency), the `Auth` import itself is forbidden. In the declaring file, other modules may access `Auth.helper` because both enclosing module and member permit it. A `pub` public API cannot expose a private/package-only module as an inaccessible nominal type.

Do not add module nesting: Oreslang modules remain flat. Do not interpret `pub[file]` or `pub[pkg]` as actor state/memory isolation grants. Visibility modifiers on class/actor instance fields and methods remain gated on a separate sound access design.

### File visibility inside modules

The file's existing top-level default is file-private, so `pub[file]` on a top-level declaration is semantically redundant. Accept it without changing accessibility, but allow a `redundant-file-visibility` lint; do not silently rewrite it to `pub`. Inside a `define module`, the default member is **module-private**; `pub[file]` widens that member's visibility to other modules and top-level code in the **same source file**, but not to any other file, even inside the same package.

```ores
define pub module Auth as
    fnc internal(): void { return; }           // Auth only
    pub[file] fnc helper(): void { return; }    // other modules in this file
    pub[pkg] fnc validate(): void { return; }   // other files of this package
    pub fnc authenticate(): void { return; }   // public
end

define module LocalConsumer as
    fnc demo(): void {
        Auth.helper();       // OK: same file
        Auth.validate();     // OK: same package
        // Auth.internal(); // COMPILE ERROR: module-private
    }
end
```

A `pub[file]` declaration cannot be imported by an **other** file, even when that file belongs to the same package. Resolve file identity using the compiler's canonical source-unit identifier, never the string spelling of an import. Access still requires the containing module to be accessible; `pub[file]` does not make a hidden module accessible to another file. Effective access intersects all enclosing visibility bounds.

For v1, `pub[file]` is meaningful for module-contained declarations and is accepted but redundant for top-level declarations. **Do not widen private class/actor instance fields or methods to file-level access by accident.** If syntactically recognized there before a sound member-access rule is defined, reject those positions. `pub[module]` and `pub[in ...]` are reserved for separate design work; reject unknown scoped qualifiers.

`pub[pkg]` is accepted only on declaration kinds whose AST, compiler and runtime enforce it. The intended eventual kinds are functions, classes, actors, modules, types/aliases, contracts, traits, structs, symbols, constants, fields and methods; **unsupported kinds fail closed**, rather than dropping the qualifier. When `define` is used the canonical formatter ordering is `define pub[pkg] ...` (matching `define pub ...`). A member may be syntactically marked wider than its parent, but its *effective* audience cannot exceed the containing type/module's visibility along the import path.

A same-package declaration is NOT implicitly in scope in another file. An explicit import or declared namespace qualification is still required. File-global names and `define module` namespaces are not silently merged by package membership. Wildcard imports may list only members visible to the importer and do not grant additional authority.

## Manifest grouping: extend the existing format, do not invent a second manifest

The canonical project manifest is already `.ores.pkg.toml`; legacy `.oreslangc.cfg.toml` remains a migration input. The proposed **new schema version 2** adds explicit package-membership tables under that same manifest:

```toml
schema_version = "2"

[project]
name = "my-app"
root = "."

[source]
roots = ["src"]

[packages.auth]
files = [
  "src/auth/auth.ores",
  "src/auth/tokens.ores",
  "src/auth/permissions.ores",
]

[packages.billing]
files = ["src/billing/billing.ores"]
```

- Paths are **relative to the manifest's validated `[project].root`** and are compared by canonical resolved file identity. No globbing in v1: add files deliberately and reproducibly.
- Each source file belongs to **at most one package in a resolved project**. Duplicate, alias/symlink, colliding, missing, directory or out-of-root membership paths are **errors**. Never choose the first match or silently normalize overlaps.
- Files **not listed** belong to their **own singleton file package**, preserving current file-is-package behavior and preventing a sudden widening of authority.
- A manifest can declare zero packages. Without a valid explicit package grouping, the same singleton semantics apply.
- A separately recognized nested `.ores.pkg.toml` or legacy package/project marker defines an independent resolution boundary. Group membership cannot cross it; prior nearest-manifest and symlink-escape checks remain mandatory.
- No automatic grouping by folder, Git organization, same filename, `[project].name`, or shared `source.roots`.
- A dependency is **not** considered the same package simply because it declares the same `[packages.<name>]` name. Its versioned/resolved dependency instance and owning manifest are part of package identity.
- A future single-file `package` header may be sugar, but may **not** dynamically enroll a file in someone else's manifest or override verified ownership metadata.

**Package identity:** after resolving and validating the import graph, assign an opaque compiler-owned `PackageInstanceId` using the resolved package/dependency instance, canonical owning manifest identity, declared package key (or canonical singleton source identity) and project-root context. Identity must be independent of CWD, symlink spelling, text changes and incremental compilation order, but must never collide across distinct installed dependency instances. A source file's package membership may change only through a new graph/build generation. The HIR, export ABI, hot-reload metadata and incremental dependency graph must carry the ID, not recompute access from a path string at runtime.

## Resolver, typechecker, runtime and security requirements

1. **Resolve complete graph first.** Validate manifest schema/version, source ownership, imports, and strongly connected components before any guest execution. An import cycle does not weaken visibility.
2. **Static accessibility:** for each selected declaration `d` and importer `i`, `PUBLIC` admits as before; `PACKAGE` requires `PackageInstanceId(d) == PackageInstanceId(i)`; `FILE` requires `SourceUnitId(d) == SourceUnitId(i)`; `PRIVATE` uses existing lexical rules. For imported module members, the linker MUST evaluate the module visibility and member visibility separately and require both. Require a valid visible path through parent modules/types. No private alias/public re-export laundering.
3. **Public ABI hygiene:** `pub` signatures, constructors, structural shapes, contracts and exported actor messages may not expose an inaccessible package-private nominal type/member. Require a public abstraction or reject.
4. **Runtime parity:** late imports, reflection, dynamic dispatch, aliases, wildcard selectors, hot-reload generations and runtime class/member access must use the same visibility result; don't rely solely on the import statement's textual spelling. Package-private members never enter a public structural view.
5. **Trust boundary separation:** package visibility never grants host access, file/network permissions, shared mutable actor state, cross-isolate pointer access, FFI, or symbol minting. Cross-package `pub` must still obey capability/ownership requirements.
6. **Caching and reload:** changing package membership/visibility invalidates relevant importers, ABI fingerprints and hot-reload compatibility checks. No stale compiled export or old-generation handle may be used to regain access.
7. **Build integrity:** refuse unrecognized schema version 2 until implemented; no silent fallback to schema 1. A manifest grouping must be pinned with the dependency graph; imported source content is not allowed to spoof a group's manifest authority.
8. **Core/no-std:** package accessibility is a compile/link rule requiring no OS or allocator in the runtime, preserving freestanding core builds.

## Implementation sequence and conformance gates

- **Contract:** this specification and `contracts/package-visibility-multifile-v1.json` define admission cases and unresolved implementation status.
- **Java/Graal:** extend parser/AST visibility enum, manifest validator/import graph, all export selectors (including actors/modules/aliases; see issue #859), typechecker and runtime, ABI/incremental loader, formatter and JUnit tests. Coordinate with canonical `+/` project-root import PR #1082.
- **LLVM:** add source graph and import linking (tracked in LLVM #341) before claiming multi-file visibility. The current bootstrap only supports single-file compilation. Unsupported syntax must reject without LLVM IR output.
- **Other backends:** use common fixtures; do not count a parser acceptance or schema linter as executed compiler parity.
- **Proof:** test same-package relative and `+/` imports, cross-package denial, singleton defaults, `pub[file]` same-file cross-module access and other-file rejection, redundant top-level `pub[file]` equivalence, modifier synonym normalization and mixed-delimiter rejection, module-declaration `pub[pkg]`/`pub[file]` accessibility, containing-module intersection, module-member visibility, nested manifest denial, symlink aliases and escapes, duplicate membership, cyclic imports, wildcard laundering, public signature leakage, compile cache invalidation, hot-reload and late/dynamic calls; distinguish source tests from executed exact-commit CI.

**Migration:** existing schema v1 projects and `.oreslangc.cfg.toml` imports retain existing semantics. Schema v2 is opt-in and unsupported compilers fail closed. The rollout must not make previously private symbols importable just because files share a project root.

Related: [canonical project-root import contract PR #51](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/51), [Java implementation PR #1082](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1082), [Java private-export hardening #859](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/859), [compile-time constants #23](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/23), [native linking #341](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/341).
