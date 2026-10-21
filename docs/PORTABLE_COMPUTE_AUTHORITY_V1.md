# Portable compute authority ABI v1

Status: **G1 runtime authority contract**. This does not enable `kernel`, `gpu { }`, or `gpu task { }` source syntax.

The runtime owns sealed `Device`, `Buffer<T>`, `Fence`, and `KernelContext` capabilities. Ordinary Oreslang source may inspect portable descriptors but may not construct, deserialize, or reinterpret descriptor fields into these capabilities.

## Device

A device authority is bound to backend id, device id, a nonzero provider generation, and tenant domain. Textual ids and generations are diagnostics/provenance only; they are never sufficient to recreate authority.

## Buffer

A real device allocation has a nonzero allocation generation, positive byte length, positive power-of-two alignment, type tag, owner domain, and one device authority. In source semantics buffers are affine. Runtime host implementations may internally hold multiple object references, but they must linearize all state transitions so aliases cannot create concurrent duplicate authority.

States are `idle -> in-flight -> idle|poisoned`, with `poisoned -> retired` only after verified backend quiescence. Retirement of an in-flight or non-quiescent allocation is forbidden.

## Explicit transfers

`upload` and `download` are explicit operations. A transfer validates exact device authority, owner domain, positive length, and overflow-safe bounds before moving the buffer to `in-flight`. It returns an unforgeable fence receipt carrying the allocation generation, monotonically increasing sequence, direction, and opaque submission proof.

Completion validates the exact receipt. Cancellation changes the buffer to `poisoned` but does **not** prove quiescence. Reclamation remains forbidden until the backend acknowledges that the cancelled operation is physically quiescent.

No transfer may silently migrate devices or fall back to CPU.

## Promotion

G1 is satisfied only when Java and LLVM/native implementations execute negative tests for forged/stale receipts, wrong device/domain, out-of-bounds transfers, cancellation/quiescence, and generation/sequence failure. Source syntax remains fail-closed until typed compiler/effect admission exists.
