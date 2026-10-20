# Oreslang Reachability Manifest v1

`ores-reachability/1` is the backend-neutral contract for whole-program tree shaking.

Every closed-world application backend SHOULD emit this manifest immediately after semantic reachability and before backend-specific code generation or linker garbage collection. Library builds emit the same format but root their externally visible public API instead of executable entry points.

## Required invariants

- The complete source program is parsed and semantically checked before pruning.
- `roots`, `retainedSymbols`, and `removedSymbols` are mathematical sets serialized in ascending Unicode scalar-value/code-point order.
- Every string in the manifest MUST be well-formed Unicode. Producers MUST reject malformed surrogate/UTF-8 input rather than hashing replacement characters.
- `compileTimeConstants` keys are serialized in the same Unicode code-point order.
- `roots` MUST be a subset of `retainedSymbols`.
- `retainedSymbols` and `removedSymbols` MUST be disjoint.
- For every semantic declaration category represented by a backend, the closed-world graph MUST classify each declaration exactly once as retained or removed. A backend MUST NOT omit a declaration category merely because its lowering is unusual.
- Duplicate semantic symbol identifiers MUST fail closed.
- Every explicit executable root MUST be retained. Specialization may remove dependencies below a root, but it MUST NOT silently erase the externally requested root itself.
- Unknown dynamic dispatch, reflection, FFI, plugin loading, actor message dispatch, host-visible resumable entrypoints, or externally visible library ABI MUST fail closed by conservatively retaining possible targets or rejecting the build.
- A backend MUST NOT consume this manifest for pruning until every source-semantic construct that the backend can emit is either represented in the reachability graph or explicitly rooted as externally visible.
- Backend-specific DCE may remove additional implementation-only helpers, but MUST NOT remove a semantic symbol that the manifest retains.
- Backend-specific lowering MUST NOT resurrect a semantic symbol listed as removed.

## Cross-backend use

Java/GraalVM, LLVM/native, Wasm, embedded/mobile/desktop, GPU, FPGA and ASIC backends compare this semantic manifest before their own target-specific lowering. A backend may attach a separate target report containing emitted bytes, sections, kernels, RTL modules or gates, but that report does not change semantic reachability.

Target-specific host ABI roots are explicit inputs to reachability. For example, a Wasm actor export or native resumable-loop entrypoint cannot be treated as dead merely because ordinary source code does not call it.

## Determinism

Canonical serialization for digesting is UTF-8 JSON with no insignificant whitespace, object fields in schema order, sorted arrays, sorted constant keys, and JSON escaping per RFC 8259. Producers SHOULD expose SHA-256 of those exact bytes.

String ordering is by Unicode scalar value, not UTF-16 code-unit order or locale collation. Valid UTF-8 bytewise ordering is equivalent for scalar values; UTF-16 producers must compare decoded code points.

Canonical numbers use these rules:

- integral values use base-10 ASCII with no leading zeroes except `0`;
- floating values must be finite;
- negative floating zero is serialized as `0.0`;
- finite floating values use the producer's shortest round-trip decimal for the source IEEE-754 width, with exponent marker normalized to lowercase `e`, no `+` sign, and no redundant leading zeroes in the exponent;
- a floating value that has an integral mathematical value retains a decimal point (for example `1.0`) so integer and floating build constants do not collapse to identical manifest text.

This format intentionally contains no timestamps, host paths, tool cache identifiers, random identifiers, or nondeterministic traversal order.

## Fail-closed evolution

Adding a new source declaration kind, dynamic dispatch mechanism, actor entrypoint, runtime-exported continuation, foreign symbol surface, or backend-generated host entrypoint requires one of:

1. a new semantic reachability edge;
2. an explicit root rule; or
3. rejection from tree-shaken builds until its reachability semantics are defined.

Linker garbage collection, GraalVM reachability, LLVM global DCE, Wasm optimization, or hardware synthesis are second-line optimizers. They do not substitute for this semantic contract.
