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

## G1b staged source HIR — explicit evidence boundary

The Java/Graal branch [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582) now calls `GpuLaunchSourceHirV1.lower` from the production TypeChecker after parsing the actual `GpuLaunchExpr`. This creates immutable source-shape IR for named kernel, ordered operands, named device/queue, **physical** or **logical** geometry, checked signed-64-bit literal/integer expressions, and shared bytes. It rejects effectful geometry, unsupported host calls, static division by zero, signed overflow, negative dimensions, zero physical axes, and zero group sizes; the TypeChecker also checks lexically bound geometry symbols against its integer type.

**This is neither a completed typed kernel IR nor an execution token.** The candidate's only admissible evidence state is `SOURCE_SHAPE_ONLY_NOT_EXECUTABLE`. Unresolved names, GPU ABI types, device view residency, mutable alias proofs, actor/tenant ownership, kernel effect closure, barrier convergence, and device completion fences are **unproved**; the TypeChecker always raises `GPU-LAUNCH-008` after shape analysis. Do not treat a successful HIR candidate as a capability or use it for enqueue. Further stages must add compiler-issued, identity-bound proof artifacts before any GPU command can be emitted.

The [conformance corpus #502](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/502) includes forward-looking negative fixtures for arbitrary geometry host calls and noninteger lexical grid bindings. They are proposal-only and remain `NOT_EXECUTED` across providers. LLVM's existing generic `GPU-LAUNCH-008` denial does **not** establish diagnostic parity with Java's new source-HIR checks.

## G1c: typed GPU kernel source subset (Java, no device authority)

The canonical `pub gpu fnc` declaration now has its own `Ast.GpuKernelDecl`, **not** an ordinary CPU `FunctionDecl`, on Java/Graal [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582). This prevents interpreter/callable registration from silently reusing host-function execution. Production TypeChecker calls `GpuKernelSourceHirV1.lower` for a bounded, typed source-HIR prototype, then **always** rejects with `GPU-KERNEL-008`. This is a source-typing milestone, not enabled device compilation.

The G1c prototype currently supports explicit `int`/`i64`, `f32`, `bool`, `GpuReadBuffer<f32>`, `GpuWriteBuffer<f32>`, and `GpuReadWriteBuffer<f32>` types; immutable scalar locals; 0–2 static-axis `gpu.global_id`; f32 device reads/writes; arithmetic; simple single-branch guards and void return. It rejects host calls, dynamic dispatch, suspension, unknown intrinsics, mutable local bindings, read-only stores, write-only loads, unbound symbols and implicit numeric conversions. Its immutable instruction/value tree is tagged `TYPED_SOURCE_ONLY_NOT_EXECUTABLE`.

**Excluded/unproven**: complete kernel-entry signature binding at launch sites, physical address/bounds checks, buffer provenance, alias/loan ownership, tenant queue generation, padded-tail and barrier convergence, device code generation, cancellation, verified fence completion, numerical oracle and hardware execution. A typed source plan **must never be interpreted as a compiler-issued launch authority**. G1c compiler tests and new seven-case kernel conformance corpus in [platform-conformance #502](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/502) remain `NOT_EXECUTED` until independently run on exact immutable source. The previous G1b shape IR still remains nonexecutable.

## Acceptance ladder

- **G0 contract**: review this grammar and executable manifest/fixture-shape tests, without claiming source parsing.
- **G1 parser + borrow/effect**: actual Java/Graal then LLVM `.atto` parses positive launch, rejects negatives before IR/artifact emission, and preserves legacy callable/region rules. Negative mutation tests must each fail with their named diagnostic.
- **G2 CPU reference**: independently tested deterministic SIMT semantics for computation and geometry, explicitly labeled CPU reference, never promoted as GPU.
- **G3 physical GPU**: real compiled AttoLang source, real hardware dispatch, output comparison against scalar oracle, ownership/cancellation/fence checks, and exact source/tree/compiler/device/step receipts. A zero-step hosted run is runner admission failure.
- **G4 expanded CUDA-like features**: checked multidimensional workgroups, shared memory, group barriers, subgroup ballots/shuffles, atomics/scopes/orders, streams/events, memcpy pipelines, graphs, cooperative/cluster launch, tensor/matrix acceleration, multi-GPU, occupancy/benchmark/profiling.
- **G5 parity**: the same source and expected diagnostics run independently through Java/Graal, LLVM, .NET, Wasm, Forge and Cranelift where target capability exists. Unsupported targets fail closed, never silently execute on CPU.

Tracked upstream: [common-source heterogeneous semantics #182](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/182), [heterogeneous end-to-end #184](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/184), [LLVM real GPU gate #1137](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1137), [conformance GPU contract #215](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/215).

## G1c.1 — source-level 1D tail-guard audit, not allocation bounds

Java/Graal [#2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582)
adds `GpuKernelTailGuardV1`. The typed source-HIR lowerer now performs a
mandatory, conservative pass over its immutable instructions before returning
a candidate. Device f32 loads/stores must use the exact lane-zero index on a
path established by `i < n`, or after an `i >= n { return; }` branch.
Mismatched lanes, reversed conditions, accesses outside the branch, non-lane
indices and effects outside the closed kernel subset are rejected.
The audit result `SOURCE_TAIL_GUARD_ONLY_NOT_EXECUTABLE` is not a device proof.

This **does not** prove that the user-supplied bound `n` is at most each actual
device buffer's capacity. A future typed launch binder must pair the bound
with every authenticated allocation length, borrow/alias loan, generation,
grid/group configuration, barrier-convergence proof and GPU completion event.
Do not accept this audit result as a dispatch ticket, guest parity or
hardware bounds guarantee.

LLVM [#1457](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1457)
now recognizes the narrow `gpu fnc` header and selected forbidden
lexical effects, but does not emit a typed kernel AST or GPU device IR.
A well-formed declaration is rejected with `GPU-KERNEL-008`; malformed
ABI headers and explicit forbidden effects receive specific diagnostics.
This must not be described as Java/LLVM typed kernel parity.

The companion [kernel corpus in conformance #502](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/502)
records nine `.atto` source cases with exact Git blob identities.
All seven backends remain `NOT_EXECUTED` until compiler-backed runs
produce nonzero steps and source/guest receipts. Physical GPU execution,
safety under driver failure and cancellation are still unimplemented.

## G1d — source signature binding and capacity predicate (separate PR trees)

Java/Graal [GPU source #2582](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2582)
adds `GpuKernelSourceLinkV1` for a static same-compilation-unit `gpu fnc` declaration
to `launch` site linkage, enforcing unique kernel identity, exact argument
arity, supported literal types and rejection of host-effect argument expressions.
Any lexical argument referring to a buffer is still
`LEXICAL_NAME_UNTYPED`; it does not prove a device-buffer type,
module capability, allocation identity or lifetime. The linker returns
`SOURCE_SIGNATURE_ONLY_NOT_EXECUTABLE`, and production TypeChecker continues
to reject GPU execution. The [five-case source-link conformance manifest](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/feat/atto-gpu-explicit-launch-contract-20261106/contracts/atto-gpu-kernel-source-link-v1.json)
is proposal-only and `NOT_EXECUTED`.

Independently, Java [GPU footprint #2583](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2583)
adds `GpuKernelCapacityPreflightV1`. For the restricted 1D f32 kernel,
it requires exact equality between supplied scalar n and logical over,
ensures every supplied view has at least n x 4 bytes, validates four-byte
alignment and the read/write parameter contract, and composes the existing
footprint overlap, quota, tenant and device checks. Overflow is rejected.
A zero logical extent is non-dispatching, but still undergoes ordinary view
validation. Its report is `SNAPSHOT_CAPACITY_SHAPE_ONLY_NOT_EXECUTABLE`.
**The supplied view records must eventually be backed by an authenticated
immutable provider snapshot; caller-created records are not allocation
authority, and a successful check cannot grant loans or enqueue.**

These changes exist on **two independent Java draft PR heads**, not a
single compiler-verified tree. The capacity preflight currently receives
a caller-constructed view list; it is not yet automatically bound to the
typed kernel signature or trusted device allocation registry. The source
tail guard proves only canonical lane-index syntax, not allocation capacity.
Before G2/G3, merge/reconcile the sources on one exact tree, implement
compiler-issued typed bindings, authentic provider snapshots, generation
fencing, cancellation-safe ownership loans and verified device completion.
`steps=[]` and `steps=null` are runner admission failures and never prove
any of this. No CPU fallback.

## G1d safety audit: canonical tail bound and module visibility

A conservative Java source audit found that a 1D kernel could previously
pass the tail-guard source check with a different parameter `m` or a
nonnegative constant, while the separate buffer-capacity preflight checked
`n`. This proof mismatch is incompatible with safe device dispatch.
The Java source checker now accepts the restricted 1D f32 indexed access
only when the guard compares `gpu.global_id(0)` (or its checked immutable
local alias) against the **specific integer kernel parameter named `n`**.
`if i < m` and `if i < 1024` are denied with
`GPU-KERNEL-010`, and conformance corpus #502 pins the mutations as
`NOT_EXECUTED` source fixtures. This is not the eventual general
symbolic range and array-length solver; alternative proven bounds require
a different, complete proof artifact. The capacity check still does not
read authenticated provider allocation metadata.

Separately, Java `GpuKernelSourceLinkV1` no longer resolves unqualified
kernel names from arbitrary other modules. A source-only unqualified launch
looks **only** within its lexical module. Even if the external target is
`pub gpu fnc`, qualified cross-module source links are now rejected because
this stage has no verified import or linker-alias authorization. Private
cross-module kernels are rejected separately. This source linker never
issues a device capability. The program remains fail-closed via
`GPU-KERNEL-008`.

LLVM native source admission now rejects malformed
`gpu.global_id(axis)`: the source-only allowlist accepts exactly one
literal axis 0, 1 or 2. A dynamic, unsupported or multi-argument axis
fails with `GPU-KERNEL-006`, as do unknown device/host calls. This
does not provide a typed LLVM GPU builtin or a backend kernel binary.
Compiled test runs, provider ownership, alias quiescence and actual
hardware device results remain `NOT_EXECUTED`. No implicit CPU fallback.

**Security gate:** Do not combine source tail checks, untyped lexical
launch names and caller-supplied footprint records into an executable
launch permit. Require a single immutable compiler-issued typed device
IR with imported symbol identity, generated bounds/alias proofs, trusted
provider snapshots, generation-scoped allocation loans and an authentic
device completion fence, all bound to exact source/kernel binary identity.

## G1d combined-tree integration (private source, nonexecuting)

A dedicated [draft Java integration PR #2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610)
has a two-parent Git merge of source PR #2582 at
`ec09ddba0068e10a420ba5bf7abd0490b702023c` and host-footprint
PR #2583 at `62ede3accf28d2673bb307b5bf9c3a8fd65116a5`.
The verified initial integration head is
`bf196efe8ef8f6d8eec1927fb70137097bc60136`, with Git tree
`8ef58d1f6625f53e247a6a29da83a415139e6bc3`. Both agent PR branches
remain unchanged and the integrated tree includes their GPU source and
host-footprint files without a same-path conflict.

`GpuKernelSourceCapacityJoinV1` checks source typed kernel name/arity,
source link, canonical n and the 1D tail source guard, then **derives**
the expected view read/write mode from the kernel signature instead of
trusting caller-supplied expectedAccess flags. It validates positional
buffer snapshots, host-view overlap/tenant/quota constraints and exact
1D f32 capacity, but cannot authenticate caller-supplied View records.
The only result is
`SOURCE_JOINED_CAPACITY_SHAPE_ONLY_NOT_EXECUTABLE`.

The integrated draft includes 11 JUnit join regression cases, the
2048-trial host-only capacity smoke, the original 2048-trial host
footprint oracle, and an exact-PR-head Maven workflow. All compiler/JUnit
runs remain `NOT_EXECUTED`: sampled source-org GitHub jobs returned
`steps=null` due runner admission. The source GitHub repository is
**private**; moving its exact code into a funded cross-org carrier
requires independently authorized review and is not approved by
source-only status. Retain GPU-KERNEL-008/GPU-LAUNCH-008 and disallow
device dispatch, CPU fallback, physical GPU or ownership/fence claims.

## G1e source-declared host parameter matching (still no GPU authority)

Java/Graal draft [#2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610)
now includes `GpuKernelTypedSourceArgsV1` and
`GpuKernelSourceCapacityJoinV1.auditTypedSource`. G1e checks
source-declared host formal types against the kernel source signature
and rejects mismatched f32 buffer access, unsupported or nested element
types, unsupported scalar conversions, undeclared lexical names and
writable source argument aliases. Reports are immutable and always
`DECLARED_HOST_ABI_SHAPE_ONLY_NOT_EXECUTABLE` or a containing
nonexecutable host-capacity report. The Java PR head for this change is
`ccb85fe1bf9303d1d714a5b350500a9fda46af6d`
(tree `995214d81d884bb2c20666f65b8271eda67c808c`).

**Important:** This is a *source declaration checker*, NOT actual
TypeChecker resolution of all local variables, ownership/borrow transfer,
authentic GPU memory or a provider-issued launch permit. Existing
legacy source-only `audit` paths remain nonexecuting. The 13 new JUnit
cases are authored but NOT_EXECUTED due `steps=null` GitHub runner
admission failures. The separate [eight-case proposed conformance
corpus](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/502)
contains exact Git blob fixtures and explicitly disallows promoting
fixture integrity into compiled guest or physical GPU evidence.
No private-source cross-org mirror without independent authorization.

### G1e.1 call-site and anti-forgery source hardening

At [Java/Graal PR #2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610)
head `c2070cb604aa70f4e399aff4605657740ea3922f`
(tree `e01abe6bb44b52b99eae11975eee8da2777b237e`),
G1e now cross-checks its declared host formal parameter types with
an **actual direct GPU launch AST in that caller**, matching every
source argument name/literal kind and positional index. A forged link
from another host callable, a modified lexical name or a declaration
with no launch fails closed, as do unproved nested call sites.
The focused Java G1e suite now has 16 authored JUnit cases; negative
cases construct the parser AST before asserting the binding rejection,
so an earlier parser error cannot spoof a passing binding test.
No compiler-issued lifetime proof, authenticated provider data,
real device launch or guest execution exists. Hosted exact-head jobs
reported `steps=null`, so JUnit evidence remains NOT_EXECUTED.

### G1e.2 restricted host AST and immutable canonical n (2026-11-06)

The latest Java integration draft #2610 head is `dd742dc21aa6438775654e2597d2548e6287cccc` (tree `34dd5b4d9b8c6e96314ab2cd498869bd8fef838a`). G1e now intentionally accepts only a single direct GPU launch and an optional trailing void return. Host local shadowing, extra host calls, early return, another launch and nested effects are unproved and denied. The source-only launch requires logical `over: [n]`, a static positive 1D group, unit trailing axes, zero shared bytes, and exactly one immutable declared host integer `n` passed to the kernel as `n`. A literal or unrelated parameter cannot stand in for the bound. Both public TypeChecker entry points repeat GPU denial after annotation expansion. These restrictions are not final AttoLang GPU syntax: deeper control-flow/geometry proofs are future work. Conformance PR #502 pins 18 source-only G1e fixtures, while focused Java suites contain 19 G1e typed-argument, 24 G1e control-flow, six TypeChecker gate, and 18 source-capacity JUnit methods, all NOT_EXECUTED due runner job `steps=null`. Authenticated allocation, generation-fenced loan, device completion and physical GPU proof remain absent. The original G1d two-parent merge head remains preserved separately from the latest subsequent G1e integration head.


### G1f independently constructible GPU typed-HIR records

The Java G1e/G1f source HIR is a public record-based representation,
not a compiler-trusted capability. At [Java/Graal GPU integration PR #2610](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2610),
latest head `8a0d6e21c01b976a13d0503c73df202b52eb1e8d`,
tree `4019960af3ca0d358766a0a58b84b5741953c11f`,
the source tail verifier rechecks forged typed value opcodes, operand types
and arity, declared read/write buffer capability, scalar local bindings
and instruction metadata. An arbitrary Value/Instruction/Plan must not
supply false source-guard evidence.

The Java PR includes a dedicated 21-case forged-HIR JUnit suite
(20 expected rejections plus a canonical non-executable control), and
four source-capacity integration forged-plan regressions among 22
authored integration tests. The [G1f conformance receipt](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/502)
pins the Java Git blob identities but does NOT execute the private Java
compiler or JUnit. Hosted workflow steps still return null; all cases
are `NOT_EXECUTED`. This is distinct from a provider-authenticated
allocation or immutable compiler-issued ownership proof. Keep physical
GPU dispatch, implicit CPU fallback, and merge promotion disabled.
