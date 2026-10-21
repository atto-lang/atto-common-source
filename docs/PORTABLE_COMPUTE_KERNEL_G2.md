# Portable compute kernel IR v1 — G2

Status: **source-neutral compiler/runtime contract**.

This gate does not enable `kernel`, `gpu { }`, `cpu { }`, `gpu task { }` or `cpu task { }` in ordinary Oreslang source. The current frontends continue to reject those reserved execution-domain tokens until a typed source AST, effect proof and lowering path exist.

## Why this layer exists

Oreslang should not depend on Java reflection, runtime bytecode inspection or a vendor-specific HAT API to define accelerator semantics. The compiler owns one closed, typed kernel representation and providers lower that representation to host or device execution.

G2 begins with a deliberately small kernel subset that already has native implementation evidence:

- homogeneous `f32` fields,
- AoS, SoA and AoSoA physical layouts,
- elementwise `scale`, `bias` and `scale-bias`,
- finite scalar coefficients only,
- checked signed-i64 byte arithmetic.

The subset is intentionally boring. It is an executable conformance oracle for Java/Graal and LLVM before general source kernels are admitted.

## Effects

An admitted kernel is pure numeric work. It cannot perform host I/O, allocate dynamically, lock, mutate actor state, send mailbox messages, unwind exceptions/panics, use reflection, or launch nested device work. Those effects are rejected before provider selection.

## CPU reference provider

The CPU reference provider is explicit and deterministic. It is a conformance/testing backend, never an implicit fallback for a failed GPU request and not a hard-realtime claim.

It executes the same physical layout offsets as the device lowering. Input/output aliasing is rejected. For the `scale-bias` reference operation, floating-point contraction is forbidden so a backend cannot silently replace the two specified f32 operations with a fused operation that changes rounding.

## GPU artifact

The first device artifact remains OpenCL C 1.2. Java/Graal and LLVM/native both emit this artifact from the same G2 kernel semantics, and exact cross-backend artifact parity is a promotion gate for the admitted subset. Emitting syntactically valid OpenCL is still not evidence of GPU execution. A real provider must authenticate the physical device, buffer provenance, quotas and completion event before G3 can claim actual device execution.

## Promotion criteria

G2 requires Java and native CPU execution of the same kernel cases, matching layout byte offsets, matching output bit patterns for finite conformance vectors, negative validation coverage, and continued fail-closed source parser behavior.

The next gate after this contract is a trusted OpenCL provider with explicit allocation/upload/enqueue/event/download/release state, not parser enablement.

## Artifact ABI requirements

Every emitted OpenCL artifact carries portable artifact ABI version 1 and
declares that the provider must validate 64-bit device addressing, IEEE-754
f32 support, little-endian scalar byte interpretation, exact required byte
capacity, and both global NDRange dimensions before enqueue.

The little-endian requirement is explicit because Java host reference buffers
use a canonical little-endian f32 byte representation and the current native
host path rejects big-endian hosts. A provider must reject an incompatible
device rather than silently reinterpret uploaded bytes.

These fields are descriptive admission requirements, not device authority and
not evidence that any hardware work executed.

## CPU reference concurrency

The deterministic CPU reference provider holds a whole-kernel execution lease
over both input and output host buffers. Host reads or writes using those same
buffer authorities serialize with execution; they cannot interleave
element-by-element with a running reference kernel.

When two buffers are involved, implementations acquire execution ownership in a
stable order so reversed concurrent launches cannot deadlock. This is a
conformance/runtime safety rule, not permission for arbitrary shared mutable
guest aliases.
