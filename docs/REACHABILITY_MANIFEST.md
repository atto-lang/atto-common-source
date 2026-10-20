# Oreslang Reachability Manifest v1

`ores-reachability/1` is the backend-neutral contract for whole-program tree shaking.

Every closed-world application backend SHOULD emit this manifest immediately after semantic reachability and before backend-specific code generation or linker garbage collection. Library builds emit the same format but root their public API instead of executable entry points.

## Required invariants

- The complete source program is parsed and semantically checked before pruning.
- `roots`, `retainedSymbols`, and `removedSymbols` are sets serialized in ascending Unicode code-point order.
- `compileTimeConstants` keys are serialized in ascending order.
- A symbol MUST NOT appear in both `retainedSymbols` and `removedSymbols`.
- Every explicit executable root MUST be retained unless it was eliminated by semantics-preserving specialization before graph construction.
- Unknown dynamic dispatch, reflection, FFI, plugin loading, actor message dispatch, or externally visible library ABI MUST fail closed by conservatively retaining possible targets or rejecting the build.
- Backend-specific DCE may remove additional implementation-only helpers, but MUST NOT remove a semantic symbol that the manifest retains.
- Backend-specific lowering MUST NOT resurrect a semantic symbol listed as removed.

## Cross-backend use

Java/GraalVM, LLVM/native, Wasm, embedded/mobile/desktop, GPU, FPGA and ASIC backends compare this semantic manifest before their own target-specific lowering. A backend may attach a separate target report containing emitted bytes, sections, kernels, RTL modules or gates, but that report does not change semantic reachability.

## Determinism

Canonical serialization for digesting is UTF-8 JSON with no insignificant whitespace, object fields in schema order, sorted arrays, sorted constant keys, and JSON escaping per RFC 8259. Producers SHOULD expose SHA-256 of those exact bytes.

This format intentionally contains no timestamps, host paths, tool cache identifiers, or nondeterministic traversal order.
