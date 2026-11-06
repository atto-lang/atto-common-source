# AttoLang explicit GPU kernel launch v1

**Status: proposed language/typed-IR contract, not implemented or guest-verified.** New source uses `.atto`; existing `.ores` remains compatible where supported.

This extends the current Java/Graal `gpu fnc`, `GpuArray<T>`, `gpu.global_id(axis)` and SIMT semantics (Java GPU PRs #98/#113). It does not replace the existing CPU/GPU region/task contract in [CPU_GPU_TASK_V2](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/main/docs/CPU_GPU_TASK_V2.md), which defines `gpu task {}` as producing one `Future<T>`. It must not resurrect C++/CUDA `<<<...>>>` syntax or silently reinterpret the existing `gpu {}` anonymous-callable spelling. Explicit launch is a new, unambiguous host-side operation.

## Source syntax (candidate)

```atto
pub gpu fnc saxpy(
    f32 scale,
    GpuArray<f32> x,
    GpuArray<f32> y,
    GpuArray<f32> mut out,
    u64 n
) => void {
    const u64 i = gpu.global_id(0);
    if i >= n { return; }
    out[i] = scale * x[i] + y[i];
    return;
}

suspends fnc compute(
    f32 scale, GpuArray<f32> x, GpuArray<f32> y,
    GpuArray<f32> mut out, u64 n, GpuDevice device, GpuQueue queue
) => void {
    const completion = launch saxpy(scale, x, y, out, n) on gpu(device) {
        grid: [ceil_div(n, 256), 1, 1],
        block: [256, 1, 1],
        queue: queue,
        shared_bytes: 0
    };
    await completion;
}
```

Syntax sketch:

```ebnf
ExplicitLaunch = "launch" QualifiedGpuKernel "(" ArgList? ")" "on" "gpu"
                 "(" DeviceExpr ")" "{"
                   "grid" ":" Dim3 ","
                   "block" ":" Dim3 ","
                   "queue" ":" QueueExpr (","
                   "shared_bytes" ":" IntegerExpr)? 
                 "}" ;
Dim3 = "[" Expr "," Expr "," Expr "]" ;
```

The `grid` field counts groups; `block` counts work-items per group. This is *not* lexical nesting of host code inside a GPU kernel. The call is submitted eagerly and its type is precisely `Future<void>`; `await` suspends the logical host task without pinning a carrier. Kernel device helpers, unlike entry points, cannot be launched with this form. No implicit Future flattening occurs when a launch is used inside another task. Existing host calls to named `gpu fnc` retain their current inferred-extent semantics until a separately versioned migration; explicit launches must not bypass their safety checks.

## Checked semantics

1. **Kernel entry.** `gpu fnc` is the existing declaration. An explicit launch requires a statically resolved, device-lowerable, `void`-returning GPU entry. GPU-to-GPU helper calls are not new launches. No C++ host/device attributes or pointers enter the language grammar.
2. **Eager order.** Evaluate explicit arguments left-to-right, then device, then launch fields in written order under ordinary AttoLang effects. Validate ownership, residency and capability before enqueue. Any failure is a typed error, not a CPU fallback.
3. **Dimensions.** Each of grid/block is an unsigned, checked 3D extent. Block components must be strictly positive. Exact physical `grid/block` grid axes must be **strictly positive**; a zero physical grid is rejected as `GPU-LAUNCH-003` before enqueue. Logical `over/group` extents may be zero: after the same ownership/capability and launch-field preflight, a zero logical extent produces an empty, already-quiescent Future **without** dispatching a physical zero-sized kernel. Products, device limits, shared-memory budget and queue association are checked without overflow; a block dimension above target maximum is rejected.
4. **Buffer safety.** Only owned device buffers/views and admitted device-copyable scalars/records cross the kernel ABI. Device and queue belong to the same admitted tenant/device/generation. No `HostBuffer`, arbitrary host pointers, actors, closures, capabilities or objects with host finalizers. Every mutable view requires a unique non-overlapping write footprint, including through SoA/AoSoA/SoAoS descriptors. Kernel args have explicit transfer/residency: no hidden DMA.
5. **Async lifetime.** A successful submission creates exactly one host-owned completion Future and a provider-backed fence. Cancelling or dropping the Future cannot prematurely recycle, move, free, hot-upgrade or expose an in-flight buffer. Release occurs only after authenticated device quiescence. Fence completion/error is delivered through the scheduler, never a blocking carrier wait.
6. **Device effects.** Kernels cannot suspend, await, allocate dynamically, perform I/O, send actor messages, dynamically dispatch unknown methods, recurse, access host state, or hold actor critical sections. No user closures are transferred via queue/channel.
7. **Workgroups.** `gpu.global_id(axis)`, `gpu.local_id(axis)`, `gpu.group_id(axis)` preserve existing intrinsic names. Group-local memory, barriers, subgroup operations, atomics and order/scope semantics require additional typed intrinsics/effects and verified target support. Barriers in divergent control flow must reject unless convergence is proven. Floating-point reductions require declared determinism/precision; no silent precision downgrade.
8. **Placement.** Explicit placement is authoritative. Provider options include NVIDIA (PTX/CUDA), AMD (ROCm), SPIR-V/Vulkan, Metal and WebGPU where physically available. Each has independently negotiated versions, features, target constraints, ABI and proof status. No backend may claim parity because a host reference or CPU emulator ran.
9. **Security.** Require the existing isolate GPU authority plus device-scoped allocation/queue authority. Prevent forged generations, stale handles, cross-tenant command submission, and concurrent mutable aliasing. Capture exact compiler/source/tree, kernel binary, device metadata, fixture and run hashes for hardware claims.
10. **Compatibility.** `gpu {}` anonymous kernels and the separate synchronous GPU region grammar have a known spelling conflict. Do not silently reinterpret either. Resolve contextually or through an explicitly gated migration with parser negative tests. `gpu task {}` and `task {}` retain the v2 eager Future contract.


## v1.1 ergonomic refinement (additive candidate)

The full cross-language benchmark and proposed three-level AttoLang GPU design are in [GPU_COMPARATIVE_SYNTAX_V1](GPU_COMPARATIVE_SYNTAX_V1.md). Keep the existing exact `grid/block` form unchanged. Add a mutually exclusive logical `over/group` form for concise 1–3-dimensional launches, with checked `ceil_div` grid derivation, explicit queue/device and original logical extent retained in typed IR. Tail masking cannot be assumed safe for divergent group barriers: compiler proof or rejection (`GPU-LAUNCH-010`) is required. `gpu each`, `gpu reduce`, `gpu tile`, `gpu graph`, automatic tuning and provider-specific extensions remain future proposals, **not v1.1 shipping execution**.

## Canonical syntax decision across concurrent GPU proposals

The canonical candidate is **`gpu fnc` for the kernel declaration** and **`launch kernel(args) on gpu(device) { ... }`** for explicit dispatch, extending the previously introduced GPU vocabulary and current Java parser-AST draft. Separate draft conformance PRs [#504](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/504) and [#505](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/505) show `compute fnc ... device`, `define pub kernel ...`, `launch ... with`, and `kernel.launch`. Those are unapproved alternative sketches, **not** synonyms or currently accepted AttoLang source. They must not silently fork the language grammar. Keep their reference oracles but align release-facing examples and compiler gates to this canonical spelling before integration.

Physical grid components must be positive (even if a zero-grid no-op could be mechanically simulated). Empty *logical* workloads remain explicit no-dispatch results. A planner's `totalDispatchedLanes` / `total_dispatched_lanes` counts padded physical lanes, not semantic logical work-items; the kernel-tail checker must reason about both.

## Minimal typed GPU launch IR

See [gpu-explicit-launch-v1.json](../contracts/v1/gpu-explicit-launch-v1.json). HIR/MIR must preserve kernel symbol identity, ordered arguments, geometry, owning tenant/device/queue/generation, capability demands, buffer access footprints, copy/precision policy, fence and cancellation state. The verifier rejects an IR node containing host buffers, unchecked dimensions, missing queue/device, forged owner, unbounded workgroup allocations, or unknown device effect. The schema is proposed only; this repository does not yet provide shared HIR/MIR implementation.

## Acceptance ladder

- **G0 contract**: review this grammar and executable manifest/fixture-shape tests, without claiming source parsing.
- **G1 parser + borrow/effect**: actual Java/Graal then LLVM `.atto` parses positive launch, rejects negatives before IR/artifact emission, and preserves legacy callable/region rules. Negative mutation tests must each fail with their named diagnostic.
- **G2 CPU reference**: independently tested deterministic SIMT semantics for computation and geometry, explicitly labeled CPU reference, never promoted as GPU.
- **G3 physical GPU**: real compiled AttoLang source, real hardware dispatch, output comparison against scalar oracle, ownership/cancellation/fence checks, and exact source/tree/compiler/device/step receipts. A zero-step hosted run is runner admission failure.
- **G4 expanded CUDA-like features**: checked multidimensional workgroups, shared memory, group barriers, subgroup ballots/shuffles, atomics/scopes/orders, streams/events, memcpy pipelines, graphs, cooperative/cluster launch, tensor/matrix acceleration, multi-GPU, occupancy/benchmark/profiling.
- **G5 parity**: the same source and expected diagnostics run independently through Java/Graal, LLVM, .NET, Wasm, Forge and Cranelift where target capability exists. Unsupported targets fail closed, never silently execute on CPU.

Tracked upstream: [common-source heterogeneous semantics #182](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/182), [heterogeneous end-to-end #184](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/184), [LLVM real GPU gate #1137](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1137), [conformance GPU contract #215](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/215).