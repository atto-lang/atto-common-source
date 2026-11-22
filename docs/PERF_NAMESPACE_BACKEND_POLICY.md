# Performance hooks: backend-owned namespaces or modules

**Status:** language-level guidance for backend implementations; no automatic
cross-backend parser, import-linker, or executable guest parity is implied.

The public contract defines **behavior and numeric probe identity**, not a
particular AttoLang container syntax. A backend may implement pure core
policies, alloc-tier bounded trace storage, and std-tier tracing APIs using
**file namespaces instead of `define module`**, where its parser/linker
supports that form. It may also retain an ordinary module for an existing
backend's compatibility profile. No compiler is required to load shared
`.atto` files from this registry.

Examples of *backend-specific syntax*, not interchangeable text:

```atto
// One-file flat namespace profile implemented by atto-source.js:
namespace perf;
pub fnc valid_probe(int probe_id) -> bool {
  return probe_id >= 1 && probe_id <= 2147483647;
}
```

```atto
// Rust browser compiler uses a different file header spelling:
use namespace core.perf;
pub fnc valid_probe(int probe_id) -> bool {
  return probe_id >= 1 && probe_id <= 2147483647;
}
```

A namespace is a compile-time identity and **must not itself create** a
runtime module object, implicit cross-package import permission, execution
capability, or mutable shared actor-global state. Explicit publication and
package visibility remain separate decisions. An implementation which cannot
link a namespace import must reject it; **never silently alias** it to a
different module, host object or runtime source eval.

## Verified scope and remaining limitations

- The JS compiler's current `program-v2` accepts one top-level
  `namespace perf;` header, but its freestanding-core compiler still
  requires `define module core`. The backend therefore ships independently
  maintained module and namespace source forms and a test asserting their
  complete Atto function bodies and compiled results agree. **The test
  requires material execution; mere check-in is not guest proof.**
- The Rust browser compiler recognizes `use namespace X.Y;` and
  `use default namespace;`, but namespace metadata is not an implicit
  file import or export. Explicit module linking/visibility may still be
  required for cross-file code.
- For other backends, retain a module candidate until the specific
  namespace grammar, import resolution, ownership semantics and AOT tests
  have passed. Source-level AST acceptance alone is insufficient.
- Each backend must keep its numerical IDs 23..29 and signed-i64
  overflow/sampling policy compatible. It is *not* necessary to keep
  text-identical source files.

Tests that compare namespace and module forms must compile **both**
independent Atto sources and assert the same public results, plus reject
duplicate/misplaced namespace declarations, unknown package imports and
attempts to gain host capabilities. Keep provenance at exact source blobs
and compiler head SHA, with executed runner steps.
