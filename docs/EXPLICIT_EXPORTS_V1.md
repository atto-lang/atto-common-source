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

import type ActorMail from "+core/actor";

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
