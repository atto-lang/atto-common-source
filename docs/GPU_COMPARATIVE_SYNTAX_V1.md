# AttoLang GPU syntax benchmark and v1.1 ergonomics proposal

**Status: design benchmark and candidate source syntax, NOT a compiler or GPU execution claim.** November 6, 2026. This document builds on [GPU_EXPLICIT_LAUNCH_V1](GPU_EXPLICIT_LAUNCH_V1.md), [CPU/GPU Task v2](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/main/docs/CPU_GPU_TASK_V2.md), and AttoLang's `rt borrow`/`rt share`/`rt take`/`rt copy` ownership vocabulary.

## Comparison of real ecosystems

| Ecosystem | Current representative syntax | What AttoLang should learn | What not to inherit |
| --- | --- | --- | --- |
| CUDA C++ | `__global__ void saxpy(...)`; `saxpy<<<grid, block, shared, stream>>>(...)` | SIMT, complete geometry control, shared memory, warp/subgroup operations, device events, advanced hardware features | C++ pointer/qualifier/chevron extension and positional hidden configuration |
| Rust / rustacuda | `unsafe { launch!(module.saxpy<<<grid, block, shared, stream>>>(...)) }` | Explicit unsafe FFI boundary and lifetimes | Reuse of triple-chevron launch macro |
| Rust / cudarc | `unsafe { stream.launch_builder(&kernel).arg(&out).launch(cfg) }` | Device-resident buffers, builder ergonomics, explicit streams and views | Unsafe low-level launch in everyday user programs |
| Rust / CubeCL | `#[cube]` kernel plus runtime generated launcher | One-source portable kernels, compile-time specialization, autotune, hardware-specific variants | Unchecked portability claims when an intrinsic is target-specific |
| Java / TornadoVM | `new TaskGraph("s0").task("k0", Kernels::saxpy, ...)` and `TornadoExecutionPlan` | Loop/context/tile tiers and dataflow/graph execution | Boilerplate task IDs, separate plan object for a single launch |
| Go / Gorgonia cu | `function.Launch(gx,gy,gz,bx,by,bz,shared,stream,params)` | Driver API explicitness, error reporting | Unsafe pointer parameter arrays and nine positional arguments |

Grounded sources (as of November 2026):
- NVIDIA programming guide: https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/intro-to-cuda-cpp.html
- Rust rustacuda: https://docs.rs/rustacuda/latest/rustacuda/macro.launch.html
- Rust cudarc 0.19.10: https://docs.rs/crate/cudarc/0.19.10
- Rust CubeCL: https://docs.rs/crate/cubecl/latest
- TornadoVM: https://tornadovm.readthedocs.io/en/latest/programming.html
- Go cu: https://pkg.go.dev/gorgonia.org/cu

## Decision: three ergonomic levels over one typed model

1. **High-level (future):** `gpu each`, `gpu reduce`; pure bounded elementwise/reduction effects with explicit device residency. No silent host execution.
2. **Kernel/SIMT (v1.1 candidate):** keep the existing `gpu fnc`, `gpu.global_id(axis)`, `GpuArray<T>` and `launch`; add a logical-domain geometry alternative to the current exact `grid`/`block` geometry.
3. **Tile/graph (future):** `gpu tile` and `gpu graph` as **typed library/compiler constructs**, not arbitrary embedded CUDA, requiring shape proof, resource budgets, explicit precision/synchronization and provider capabilities.

### One-dimensional logical extent (candidate)

```atto
pub gpu fnc saxpy(
    f32 scale, GpuArray<f32> x, GpuArray<f32> y,
    GpuArray<f32> mut out, u64 n
) => void {
    const u64 i = gpu.global_id(0);
    if i >= n { return; }
    out[i] = scale * x[i] + y[i];
}

suspends fnc run(
    f32 scale, GpuArray<f32> x, GpuArray<f32> y,
    GpuArray<f32> mut out, u64 n, GpuDevice device, GpuQueue queue
) => void {
    const completion = launch saxpy(scale, x, y, out, n) on gpu(device) {
        over: [n],
        group: [256],
        queue: queue
    };
    await completion;
}
```

`over: [n]` is **logical work-item extent**, not grid/block count. `group: [256]` is work-items per workgroup. The planner derives `grid.x = ceil_div(n, 256)` using checked arithmetic and pads trailing axes to 1. `over: [width, height]` and `group: [16, 16]` likewise derive a 2D grid. The *physical* launch may dispatch padded work-items: `over` does **not** remove the need for bounds safety.

### Expert exact geometry remains unchanged

```atto
const done = launch saxpy(scale, x, y, out, n) on gpu(device) {
    grid: [ceil_div(n, 256), 1, 1],
    block: [256, 1, 1],
    queue: queue,
    shared_bytes: 0
};
await done;
```

`over/group` and `grid/block` are mutually exclusive. No `group` field without `over`; no mixing with `block`, no implicit auto-tuning or silent device selection. Three-dimensional expert mode retains exact 3-element extent arrays for compatibility; logical mode accepts 1–3 dimensions and pads with 1. All dimensions must be checked nonnegative signed-64-bit values; physical groups must fit device-defined axis and total budgets. `group` dimensions must be strictly positive. A zero logical extent produces an empty, fence-quiescent completion after ordinary authority/loan preflight, not a physical zero-sized kernel.

### Tail safety, divergence and barriers

A logical extent does **not** justify blindly skipping every padded lane in every kernel: early return before a group barrier would deadlock or violate convergence. For the initial positive `over` device compiler release, require kernel-side checked bounds/footprint proofs; otherwise reject `GPU-LAUNCH-010` before artifact publication. A future compiler may synthesize lane masking only when it proves barrier-free execution and preserves required memory effects. For kernels with barriers, padded lanes must still participate in every convergent barrier and avoid out-of-range reads/writes. Never promise implicit out-of-range masking without a formal proof.

### Ownership and completion

- `launch` eagerly submits and yields exactly one `Future<void>`; `await` waits without pinning actor carriers.
- `GpuArray<T>` and views carry allocation/tenant/device/generation identities. `rt borrow`, `rt share` and `rt take` remain authoritative; host/device transfers are explicit APIs, never implicit at the call boundary. Lifetime of mutable device loans extends through **physical device quiescence**, not merely cancellation or Future drop.
- The compiler must prevent outstanding mutable alias footprints, stale/fake handles, forbidden scalar/host captures, actor sends, I/O, dynamic allocation, device `await`, and divergent workgroup barriers.
- The launch must bind to a concrete `GpuQueue` and `GpuDevice` with authenticated GPU capability. Future `@Requires` specialization and `group:auto` must be opt-in and record the selected provider/variant/precision; they are **not** part of v1.1 parser admission.
- No CPU fallback, no implicit transfer, no silent precision downgrade, and no pretending that host-only arithmetic tests prove hardware execution.

## Canonical grammar addendum

```ebnf
LaunchConfig = ( "grid" ":" Dim3 "," "block" ":" Dim3
               | "over" ":" Dim1to3 "," "group" ":" Dim1to3 )
               "," "queue" ":" QueueExpr
               [ "," "shared_bytes" ":" NonnegativeExpr ]
               [ "," ] ;
Dim3 = "[" Expr "," Expr "," Expr "]" ;
Dim1to3 = "[" Expr [ "," Expr [ "," Expr ] ] "]" ;
```

Named fields are part of source grammar and evaluated once in source order; no runtime dictionaries, positional shell strings or C++ preprocessor. The short spelling `over/group` can be normalized in typed IR to **both** logicalExtent and physicalGrid/physicalBlock; do not overwrite `over` with `grid` and lose the logical domain.

## Proof gates and honest status

- **G0** grammar, schema, fixtures, parser-AST tests and checked pure geometry (host-only).
- **G1** full typed/effect/borrow admission and immutable HIR for both variants; negative tests including over/barrier-tail ambiguity; no-artifact rejection.
- **G2** CPU reference differential tests clearly labeled as CPU; run real AttoLang guest source.
- **G3** real physical GPU, exact source/tree/compiler and kernel hash, authenticated queue/device/fence evidence and nonzero executed CI job steps.
- **G4** comparable normalized latency/bandwidth with NVIDIA C++, CubeCL and Java/Go on same hardware/workload, including precision, warmup, transfer and launch setup costs.
- **G5** capabilities and guest parity expanded target by target; mark unsupported provider features explicitly.

This is a design-quality benchmark, *not* proof that AttoLang is already faster, safer in all circumstances, or fully CUDA-equivalent. The new parser and C++ header work remains in draft PRs until executed source and hardware gates pass.
