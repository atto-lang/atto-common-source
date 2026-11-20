# Namespace grammar and authority reconciliation — decision record (pending approval)

**Status:** Proposed. No backend can claim merged grammar parity or production package admission from this document alone.

## Candidate syntax

Recommend the contextual `ns` selector, selecting **one** flat namespace from **one** exact pinned package instance:

```ores
import ns billing from "pkg:checkout";
```

The existing `import namespace billing as payments from "checkout";` and `import namespace billing from "+/";` are **non-equivalent drafts**, not automatically valid aliases of that syntax. Whether and how lexical `as` and self-package imports work is unresolved. Do not remove those capabilities by quietly renaming the parser token.

## Authorization model (independent of syntax)

1. `pkg:checkout` identifies a dependency **alias declared by the importing package**, resolved from a verified manifest + lockfile to a pinned `PackageInstanceId`. It is never a physical pathname, `cwd`, `node_modules`, `ORES_PATHS`, global namespace spelling or a caller-supplied guessed package.
2. The namespace identity is **(PackageInstanceId, flat NamespaceName)**. Ten verified provider files may contribute three namespaces. A same-spelling namespace belonging to a different package contributes **zero** declarations.
3. The closed, immutable source inventory and its per-file ownership come from the verified manifest/lockfile and canonical file identities. Reject unlisted sources, symlinked entry/provider sources, nested package-manifest markers, traversal, duplicated physical IDs, stale digests and unsigned/unauthorized aliases **before** symbol/ABI lowering.
4. Imports are lexical, checked, source-local bindings. No ambient, unqualified cross-file access, re-export, private leakage, or runtime reflective namespace object.
5. Public ABI fingerprints include package identity, provider source ID, exported member name/arity, type/effects/ownership and visibility. A changed provider invalidates all affected dependent namespaces and cached executables.

## Explicit unresolved migration choices

- **Self package:** the existing `"+/"` root alias selects the nearest `.ores.pkg.toml` package. Ratify a namespace-specific spelling that preserves this authority without reusing a generic filesystem selector. The `pkg:foo` prototype does **not** yet implement this behavior.
- **Local alias:** `as payments` needs a validated lexical binding with duplicate and shadowing checks. The present `import ns a from "pkg:foo"` parser has no alias suffix. Do not claim an equivalent public API.
- **Overloads and non-function exports:** the scalar LLVM profile permits flat positional int/bool functions only. Types, classes, actors, named args, initializers and recursive provider calls are separate full-language capability gates, **not universal syntax bans**.
- **Manifest admission:** pinned host-supplied inventories in the current Java/LLVM experiments do not themselves prove that a lockfile or manifest was verified.
- **JS/Wasm/NativeAOT/Forge:** no success until the actual linked guest executes.

## Review and acceptance gates

- Independently review common-source #188, #189, #197 and the Java #2255/#2258/#2263 and LLVM #1162/#1224 stacks; ratify exactly one canonical grammar (or an explicitly documented dual grammar) and a migration rule.
- Add positive fixtures for a self-package import and a local alias, including namespace shadowing and package-private visibility; keep tests unsupported until each backend implements them.
- Preserve the shared 12-unit, 10-provider, 3-namespace, exit-43 corpus byte-for-byte across Java/LLVM (and eventually .NET/Wasm/Forge). Its three scalar-only negative cases must not be advertised as universal language rejection.
- Require exact PR head/tree, source-byte identity, compiler/build identity, nonzero CI job steps, native guest outputs, independently reviewed branch protection, and no unauthorized private-source movement.

**No branch promotion, merge approval, or cross-backend language-parity certification is implied.**
