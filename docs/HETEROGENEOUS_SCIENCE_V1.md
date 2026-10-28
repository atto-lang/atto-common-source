# Heterogeneous scientific execution v1 — incremental implementation contract

Status **REFERENCE MODEL ONLY**, October 28, 2026. This proposal integrates with the existing [portable compute stdlib](./PORTABLE_COMPUTE_STDLIB_V1.md), [G2 kernel IR](./PORTABLE_COMPUTE_KERNEL_G2.md), [tensor/data actor contract](./TENSOR_DATA_ML_ACTOR_PIPELINES_V1.md), [autodiff actor contract](./MODEL_ACTOR_AUTODIFF_V1.md), and [hard-real-time contract](./HARD_REALTIME_V1.md). They remain authoritative within their existing scope; this contract does not replace or retroactively promote them.

## Model and non-goals

The `contracts/v1/heterogeneous-science/reference.mjs` JavaScript model and its Node tests implement **host-side reference oracles**, NOT Oreslang parser/runtime features. `std.quantum`, OpenQASM3 emitting, device allocation, GPU kernel lowering, Arrow/Parquet, MPI, real QPU access, actual differentiable execution, and hard-realtime scheduling are NOT claimed supported by this contract.

**Memory domain** is part of the type/effect boundary: host, pinned_host, gpu, remote and qpu. Move/borrow/copy must be checked against owner, generation, live loans and device fences. Qubits are linear: no clone, copy, serialization or arbitrary device-domain transfer. A QPU measurement destroys the right to reuse the measured qubit for gates. Any host/device transfer is **explicit**; a requested GPU operation may not silently fall back to CPU. An opaque runtime authority is required in a real compiler: a guest-created numeric token does not grant access.

**Two distinct pipelines**:
- Classical orchestration with actors, tasks, explicit transfer and hardware handles, able to suspend; no unbounded state loan across suspension.
- Statically compiled device/circuit regions: pure numerical GPU kernels or strictly quantum gate/measurement operations. No arbitrary I/O, actor sends, host allocation, dynamic code loading, error unwinding or blocking in a device kernel.

## Numeric and tensor contracts

Checked rank/shape/stride/byte-width arithmetic is performed before indexing or allocation, with a signed-64-bit budget. Mutable views cannot contain aliasing zero strides. Backend-specific address widths require additional checked target admission. Broadcasting is deterministic and shape checked. FP reproducibility requires a named rounding/contraction/reduction order contract, not just repeatable host-JS sums. Autodiff transformations may only cover pure admitted scalar/tensor operations; I/O and actor messaging are not differentiated.

## Quantum v1

Do not introduce additional surface syntax until the frontend AST/effect checker can enforce linear Qubit values, measurement effects and target capabilities. First QPU output is OpenQASM 3 for `h`, `cx`, `measure` (reference emitter only); QIR can follow. QPU feedback with coherence-limited deadlines must execute at an admitted controller, not as ordinary cloud-host `await`. Host quantum orchestration remains async, cancellation-aware and capability-gated.

## Real-time and HPC

Hard-real-time acceptance needs a complete pinned AOT code path, bounded allocation and queues, target/OS/RTOS scheduling policy and **measured WCET + blocking + interference + release jitter**. Numerical estimates in the reference model do not constitute timing evidence. Distributed work must include partition/generation fencing and deduplicate retries. MPI should be a provider interface rather than a compiler keyword.

## Evidence and promotion

G0: versioned contract and tests running in ordinary CI.
G1: actual Oreslang accepted/rejected guest programs on Java and LLVM; unsupported backend features fail closed.
G2: real CPU/accelerator execution on verified targets with ownership/fence tests.
G3: quantum circuit emitted by a real Oreslang compiler and executed in a pinned simulator, plus optional real QPU tests.
G4: reproducible HPC and hardware-bound deadline evidence, with named hardware and runtime.
G5: independent executed parity on Java, LLVM, .NET, Wasm, Forge and Cranelift where capabilities exist; no fake parity from host-only tests.

Never count schema validation or model tests as guest execution. Preserve per-backend `unsupported` states and source/binary digests.

## Workstreams

1. **Heterogeneous ownership/effects:** typed HIR/MIR domain, effect and generation proofs; backend-specific handles.
2. **Data science and ML:** native columnar/tensor values, Arrow/Parquet interchange, autograd, StableHLO; bounded streaming.
3. **GPU:** verified CPU reference lowering then GPU provider, workgroup/barrier and device-memory/fence semantics.
4. **HPC:** vectorization and distributed arrays/MPI; reproducible floating-point reductions.
5. **Hard realtime:** static effect and budget admission, bounded scheduling and measured hardware WCET.
6. **Quantum:** linear qubits, circuit IR, OpenQASM3/QIR, simulator and QPU provider, controller-local feedback.
7. **Robotics:** bounded sensor/DMA actors and safe affinity to accelerator/control targets.

This is intentionally **one incremental foundation PR**, not a claim of implementing all seven production subsystems.
