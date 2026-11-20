# Portable heterogeneous compute stdlib — contract v1

Status: **normative API/layering contract**. Backend support remains separately
gated by compiler/runtime evidence. This contract does not by itself make
`gpu { }`, `gpu task { }`, device kernels, or vendor drivers executable.

## Decision

Oreslang owns heterogeneous-compute semantics, but does not bake vendor runtimes
into the language distribution.

- Compiler/language: `kernel`, `cpu { }`, `gpu { }`, `cpu task { }`,
  `gpu task { }`, domain/effect checking, ownership admission, kernel
  reachability and accelerator lowering.
- `std/compute`: portable immutable descriptors, capability checks, dispatch
  shapes and the source-visible facade for runtime-owned compute handles.
- Compiler/runtime authority: sealed `Device`, `Buffer<T>`, `Fence` and
  `KernelContext` handles. User source MUST NOT be able to fabricate these.
- Optional ecosystem packages: CUDA, HIP, Metal, Vulkan, OpenCL and other
  provider implementations, plus tensors/BLAS/ML/graph scheduling.
- `core` remains freestanding and accelerator-independent. Importing
  `std/compute` must never become a dependency of `core`.

The first packaged source slice is `std/compute` in the Java/Graal repository.
LLVM currently supplies lower-level accelerator contracts but does not yet have
the same packaged source-module linker; native parity requires a linker bridge,
not a duplicate source API.

## Source-visible value types

The portable source module owns immutable, forgeable *descriptors* only:

- `DeviceCapabilities`
- `BufferLayout`
- `DispatchShape`
- `KernelRequirements`

These are ordinary values and may be constructed by source code for planning,
validation and tests. They are not authority to touch a device.

All source-visible integer fields in these descriptors use the Oreslang signed
64-bit integer domain. A backend bridge MUST reject negative values where the
field is semantically non-negative; it MUST NOT reinterpret a negative source
integer through an unsigned native type. Portable descriptor helpers perform
structural semantic validation only. Trusted provider bootstrap may impose
stricter backend/device identifier grammar and metadata-size limits.

Buffer byte counts used for actual allocation or transfer require checked exact
arithmetic before authority is exercised. Structural descriptor validation is
not proof that `element_bytes * length` is representable or equal to an
allocation request; the compiler/runtime/provider boundary must verify the
exact byte count without overflow before allocation, upload or download.

Opaque runtime handles are intentionally different. A source-created object with
fields that resemble a device id, allocation generation or fence sequence MUST
NOT be accepted as a runtime handle.

## Required execution semantics

1. `gpu { ... }` is synchronous from the caller's language perspective:
   required device work is complete before the region produces its result.
2. `gpu task { ... }` is asynchronous and returns an awaitable task/future.
   Waiting must suspend/cooperate rather than pin a carrier thread.
3. Host orchestration is not automatically a device kernel. Only statically
   admitted kernel-compatible code is lowered to an accelerator target.
4. Transfers are explicit. Moving a value across CPU/device domains never
   authorizes an implicit upload/download or silent CPU fallback.
5. Device completion is fence-based. Cancellation is a request, not proof of
   quiescence; memory reclamation waits for verified completion/reset fencing.
6. A device launch validates target address width, layout/alignment, workgroup
   sizes, buffer bounds, scalar capabilities and backend/device identity.
7. Actor isolation remains authoritative. Device access cannot create a shared
   mutable alias to actor-private state or release a serial actor state lock
   merely because the actor awaits device completion.
8. Hard-real-time profiles reject hidden migration, runtime compilation and
   unbounded provider behavior. GPU use is admitted only when its resource and
   completion model satisfies the selected profile.

## AOT and reflection

Accelerator reachability is compiler-owned. Strict AOT builds discover kernels
statically and retain only explicitly selected compatible variants. Runtime
reflection or ServiceLoader-style discovery is not required for compute
providers. Provider registration should be explicit and tree-shakeable.

A strict-AOT artifact may choose among precompiled compatible variants at
runtime. It must not silently JIT an unavailable variant. If no selected
accelerator is compatible, the program either returns a typed unavailable
error or uses a CPU fallback only when that fallback was explicitly permitted.

## Backend/provider boundary

A provider may implement a vendor API, but the provider does not define Oreslang
semantics. Before submission the runtime must authenticate provider/device
identity, allocation provenance, ownership generation and fence state. Provider
errors map to typed Oreslang errors; providers may not reinterpret source
ownership or actor isolation.

Recommended ecosystem package naming is illustrative, not reserved:
`ores-compute-cuda`, `ores-compute-hip`, `ores-compute-metal`,
`ores-compute-vulkan`, `ores-compute-opencl`.

## Promotion gates

- G0: shared contract + packaged `std/compute` descriptor module + parse and
  boundary tests.
- G1: sealed runtime handle ABI and explicit provider registration on Java and
  LLVM, with negative forgery/provenance tests.
- G2: typed kernel AST/effects, CPU reference execution and one real GPU
  provider.
- G3: `gpu task` completion/cancellation integration and Java/LLVM conformance.
- G4: strict AOT/tree-shaking and hard-real-time profile enforcement.

Do not claim a gate from documentation or preflight-only tests. Each gate needs
compiler/runtime execution evidence on the exact commit under test.
