# Explicit Exports v1

Status: proposed cross-backend source contract. This document is a source-language specification and reference-model input; it does not by itself prove that any compiler implements the feature.

## Goals

Oreslang supports declaration-site visibility and an explicit module/file interface.

Both declaration modifier orders are legal and semantically identical:

```ores
pub define class X as
end

define pub class Y as
end
```

Explicit exports are declaration metadata:

```ores
export class X;
export actor {Counter1, Counter2};
export type Count;
```

Exports are order-independent within a lexical declaration namespace. They may appear before or after the declaration they name, including at the top of a file or named module.

```ores
export actor {Counter1, Counter2};
export type Count;

import type ActorMail from "+/core/actor";

define actor Counter1 as
end

define actor Counter2 as
end

define type Count = int with gte 0;
```

An export does not terminate the import prelude. A real local declaration does.

## Visibility scopes

v1 reuses the package-visibility contract:

- `file`: current source file only
- `pkg`: current package instance
- `public`: unrestricted source API

Canonical scoped spellings use brackets:

```ores
export[file] type InternalId;
export[pkg] actor Worker;
```

Unqualified `export` means `public`.

The language does not add a `project` scope in v1. Project identity must be specified independently before such a scope can be soundly defined.

## Export bindings

Implementations should resolve source exports to explicit bindings rather than a single boolean on declarations:

```text
ExportBinding {
  owner_namespace_id
  local_symbol_id
  local_kind
  external_name
  scope
  origin
  source_span
}
```

A declaration-site `pub` creates an implicit binding under the local name. An explicit unaliased export creates the same external binding when no conflicting explicit visibility exists.

```ores
define class X as
end
export class X;
```

is externally equivalent to:

```ores
define pub class X as
end
```

## Aliases

Aliases create additional external bindings; they do not rename the local symbol.

```ores
define class InternalName as
end

export class InternalName as PublicName;
```

Only `PublicName` is exported here. If `InternalName` is independently declared `pub`, both names are externally available.

## Resolution

For each file/root or named-module namespace:

1. Parse imports, local declarations and unresolved export declarations.
2. Record whether any real local declaration has begun. Export metadata is transparent to the import-prelude rule.
3. Build the complete local symbol table and overload families.
4. Resolve explicit exports against local declarations only.
5. Validate declaration kind, visibility scope, explicit-private constraints, aliases and collisions.
6. Build the export-binding table.
7. Reject exported signatures that leak less-visible types.
8. Compute versioned ABI/link/tree-shaker metadata.
9. Lower the resolved interface to the selected backend.

A forward export is not a runtime forward declaration and creates no initialization edge.

## Placement

`export` is allowed only in declaration namespaces:

- synthetic file/root namespace
- named module body

It is rejected inside functions, methods, actor handlers, classes, lambdas and executable control-flow blocks.

## Typed and inferred exports

Typed forms validate declaration kind:

```ores
export actor Counter;
export class {Config, Snapshot};
```

An untyped export infers a kind only when the local spelling resolves unambiguously:

```ores
export Counter;
export {Config, Counter, Count};
```

If multiple logical namespaces/families make the spelling ambiguous, the compiler requires the typed form.

## Conflicts

- Exact duplicate export bindings are idempotent.
- Inline `pub` plus the identical unaliased export is idempotent.
- The same external name bound to different local symbols is an error.
- Conflicting scopes for the same local/external binding are an error.
- Explicit `private` plus any export is an error.
- Default-private plus export is allowed.
- An explicit `pub[file]` or `pub[pkg]` may not be silently widened or narrowed by a conflicting export.
- Duplicate visibility modifiers are an error.

## Imported bindings and re-exports

v1 local export syntax resolves local declarations only:

```ores
import class X from "./dep";
export X; // error
```

This prevents accidental authority widening. Re-export requires a separate explicit contract in a future revision, for example:

```ores
export from "./dep" {
  class X;
  actor Worker as PublicWorker;
};
```

A future re-export can never exceed the originating symbol's visibility.

## API leakage

An exported signature must not contain a type whose effective visibility is narrower than the export scope. The check is recursive through aliases, generic arguments, records/structs, function types and actor message types.

Exporting an actor does not expose actor-private state, mailbox internals or capabilities.

## Backend separation

Source visibility is not native linker visibility. Oreslang `export` does not automatically imply an ELF/Mach-O/COFF symbol, Wasm module export, CLR public/native export, JVM host export or JavaScript ESM export. Backends expose runtime symbols only when their ABI requires it.

## Contextual keyword

Prefer `export` as a contextual keyword at declaration-namespace positions so existing non-declaration identifiers are not broken unnecessarily.

## Verification boundary

`contracts/explicit-exports-v1.json` and `tests/verify-explicit-exports-v1.mjs` provide a source-free reference oracle. Passing it proves the contract data and model are internally consistent; it does not prove parser/compiler/runtime parity. Backend promotion requires the same cases to run through each real compiler at an exact reviewed source revision.

## Concrete grammar and Symbol identities

Contract revision: `explicit-exports-v1.2026-10-26.5`. Consume this document,
the JSON vectors and the oracle from one exact commit. This revision recovers
the later #150 grammar/Symbol decisions that were present on the source-free
carrier but absent from the initial merge. It supersedes the earlier blanket
statement that all Symbol `as` forms reject.

- A terminating semicolon is mandatory.
- A group must be nonempty; singleton groups and one trailing comma are legal.
  Leading, repeated or missing commas, nested groups and per-item kinds reject.
- Scope applies to the entire declaration. The accepted `pub` scope aliases
  have equivalent `export` spellings; formatting uses `export[file]`/`export[pkg]`.
- Wildcards, qualified/path targets, generic/call-signature selectors and
  `export from` reject in v1. The re-export example above is future syntax only.
- Typed prefixes select declaration families, not runtime types such as `string`.
- An ordinary binding alias requires an identifier. Literal aliases reject.
- After committing to export grammar, malformed input must not fall back to
  interpreting `export` as an ordinary identifier.

| Source | Result |
| --- | --- |
| `export symbol ready as #ready;` | `EXPORT_SYMBOL_IDENTITY_TARGET_REQUIRES_SYMBOL_SOURCE` |
| `export symbol ready as 'ready';` | `EXPORT_LITERAL_ALIAS_UNSUPPORTED` |
| `export symbol #ready as #ready;` | Valid identity assertion; normalize to `export symbol #ready;` |
| `export string ready as 'ready';` | `EXPORT_UNKNOWN_DECLARATION_KIND` |
| `export symbol #ready as #other;` | `EXPORT_SYMBOL_IDENTITY_MISMATCH` |
| `export symbol #ready as Ready;` | `EXPORT_SYMBOL_BINDING_ALIAS_UNSUPPORTED` |

Diagnostic precedence is kind validation, then target/alias shape validation,
then semantic name/kind/visibility resolution. Thus a runtime type prefix reports
unknown declaration kind before an invalid literal alias. A Symbol identity
assertion still requires a local declared Symbol; it neither creates nor interns
a new public Symbol. The parser's `selfIdentity` marker is syntax provenance,
not a distinct export binding or ABI identity.

## Overload families, owner scopes and recursive leakage

Exporting a callable name exports its entire logical overload family. Both
`fnc` and `routine` families follow this rule. All explicit visibility modifiers
within a family must agree; unmodified overloads inherit that consistent family
visibility. Explicit `private` still prohibits exporting the family. A typed
selector cannot partially publish a private or restricted overload. Every
overload's signature participates in leakage checking and the ABI digest.
Actual signature/type validity remains a compiler responsibility.

Member accessibility is the intersection of the enclosing module and member
binding audiences. A public alias inside a restricted module cannot widen its
parent. Module-private defaults and file-private top-level defaults remain
distinct. Local export targets remain local to that lexical namespace; collecting
the complete source graph does not authorize searching imports, sibling modules
or other files for a target. Modules remain flat, as specified by the package
visibility contract.

Leakage checks follow resolved nominal type identities recursively through the
entire signature graph, including aliases, generics, records, function types and
actor messages. Track visited identities to terminate cycles; never skip a
visibility check merely because a type was visited in another audience. A type
exported under an alias is accessible by that identity without publishing its
original spelling. Imported type references require provenance-aware access
checks, even though local exports may not target imported bindings.

## Deterministic semantic ABI projection

Versioned linker metadata records namespace identity, local symbol/family
identity, declaration kind, external binding name, scope and canonical typed
signature/ABI digest. Sort bindings and overload signatures deterministically.
Origin and source spans may be retained as diagnostic provenance, but exclude
them from the semantic ABI digest. Inline `pub` plus a redundant explicit export,
duplicate identical exports, formatting and export/declaration order must not
alter that digest. Alias, scope or ABI-significant signature changes must alter
it. Owner namespace/source/package identities must remain part of the production
metadata and access checks; display names are not authority.

## Canonical diagnostic namespace

Export-specific parser and semantic failures use the shared `EXPORT_*` category namespace. Message text may vary by backend, but category identity is part of cross-backend conformance. General language errors that are not export-specific (for example a duplicate overload signature that is illegal even without an export) may retain their existing language-wide diagnostic category.

## Reference-model coverage limits

The oracle models one lexical namespace at a time. `context.ownerScope` is a
trusted fixture projection of an already-resolved enclosing module's scope;
it is not a module parser or graph resolver. Access vectors use trusted resolved
file/package-instance IDs. `signatureRefs` is a flattened nominal signature
graph supplied by fixtures, not a production generic/type parser. ABI vectors
compare canonical projections of supplied signature strings, not a production
ABI hash implementation. Imports, filesystem identity, runtime late lookup,
tree-shaker retention and target symbol-table exposure require real compiler,
linker and runtime tests separately. Unsupported is admission safety, not parity.

The formatter must preserve export order, grouping, typed/untyped form and
aliases, apart from canonical scope spellings and the redundant Symbol identity
normalization; its resolved binding multiset must remain unchanged.

## Backend acceptance and implementation audit

All rows consume the exact commit containing this revision's document, contract
and oracle; a tracker link alone is not a version pin. Every backend must execute
the shared positive/negative source cases, including the four Symbol forms,
before claiming implementation parity.

| Backend / tracker | Additional acceptance boundary | Current audit evidence |
| --- | --- | --- |
| Java/Graal [#1363](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1363) | Complete local collection, explicit-vs-default private provenance, bindings, module intersection, import/late lookup, ABI/tree-shaker retention | Main parser blob `dcd7b40abdf2ef545e01b920debf7b30936cd6d9` rejects module declaration modifiers at line 176; no explicit export parser/binding path identified in that file. Existing visibility-test blob `def94fbd7e664377e7d97e56f8d4d56e4d86e2f5` covers inline visibility, not this export contract. Static findings only. |
| LLVM [#637](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/637) | Source graph/package identity, full family resolution, native symbol and cache/ABI boundaries | Main parser blob `ec07810a0e989e86de343d992339292cf3b096f5` has declaration `exported` checks for type forwards; no explicit-export parsing path identified in that file. A forward declaration is not an export binding. Static findings only. |
| .NET [#148](https://github.com/ores-truffle-oreslang/oreslang-source.net/issues/148) | Typed source/link metadata, Native AOT access and intentional CLR/native exposure | Requirement tracked; real compiler execution not established in this audit. |
| Wasm [#123](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/123) | Full linked source graph and explicit Wasm ABI exports | Requirement tracked; source-free/admission checks do not establish graph or runtime parity. |
| Forge [#104](https://github.com/ores-truffle-oreslang/oreslang-source.forge/issues/104) | Derive generated visibility from resolved bindings on every generated target | Requirement tracked; backend execution not established in this audit. |
| JS [#7](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/7) | Reconcile runtime module objects with the intentional ESM/host ABI boundary | The tracker requires ESM-exported runtime module objects. Specify which objects are intentional ABI entries; source `export` alone cannot authorize them. |
| Formatter [#77](https://github.com/ores-truffle-oreslang/oreslang-format/issues/77) | Binding-preserving formatting and import-prelude legality | Formatting success is separate from compiler correctness. |

Minimal read-only verification order:
1. Pin the document/JSON/oracle blobs from one commit; inspect the revision and
   expected diagnostic categories before comparing backend claims.
2. Trace actual backend parser, unresolved export AST, family collection,
   binding resolution, scope/leakage policy and metadata lowering. Inspect
   explicit-private provenance: collapsing it with omitted visibility loses
   information required by this contract.
3. Inspect source fixtures and their compiler invocation, then exact-SHA job
   steps and artifacts. Require actual frontend/link/runtime execution for the
   claimed layer. Unsupported rejection is not a passing positive fixture.
4. Compare normalized bindings, diagnostics, authorized access and semantic
   metadata across backends. Inspect target export tables independently.

Evidence stays in separate categories: static implementation finding, executed
source-free model, executed backend test, or unexecuted/unknown CI. A failed job
with null/empty steps proves no test assertion result and does not establish
the cause of runner admission failure. This revision changes the common contract
and reference oracle, not Java/LLVM/.NET/Wasm/Forge/JS compiler implementations.

