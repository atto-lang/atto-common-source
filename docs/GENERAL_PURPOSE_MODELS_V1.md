# General-purpose first-class computational models — v1 hardening RFC

**Status: PROPOSED / design and host-reference only.** This RFC refines the existing [ML model v1](MODEL_ACTOR_AUTODIFF_V1.md); it does **not** assert implemented `define model` syntax in Java/GraalVM, LLVM, Wasm, or an executable .ores guest. ML graph/train/actor contracts remain valid where not explicitly generalized below.

## Decision

`define model Name(...) as ... end` declares a *nominal, typed computational graph blueprint*, not a data-record/schema type, an actor, a neural network by default, a trainer, a service, a runtime thread, or a GPU executable. Use `class` / `record` / `struct` for domain data; use actor/Task/Stream/Workflow for effects, concurrency and supervision. The declaration is an immutable description; its value-level construction and execution are distinct. Preserve existing contextual `model` keyword and existing `|>` / `pipe` semantics.

Examples of meaningful models: tensor inference, DSP/image filters, physics time-step, deterministic economic/pricing functions, control/MPC kernels, statistical transforms, feature engineering, and a pure per-record ETL transformation. External data fetches, database writes, model serving, training loops, and remote execution stay outside the graph. Differentiability is an optional capability, **not** a condition of being a `model`.

### Three separable layers

1. **Definition**: nominal `ModelType<Inputs, Outputs, Config>` plus immutable `ModelGraph`; declaration has no import-time execution or mutable captures.
2. **Instance**: owned `ModelInstance`, with independently initialized and versioned parameter/state storage *only if the graph needs it*. A stateless graph can be an immutable zero-parameter value. Distinct instances never silently alias mutable parameters.
3. **Execution**: `model.run(input)` is the baseline pure synchronous CPU/freestanding-capable interpretation of a statically provisioned graph, conditional on supported ops/resources; `std.model` may provide dynamic allocation, async Tasks, batches, actor placement and accelerators, all explicitly selected. A model is not itself an actor. A `ModelSession` may own optimizer/training or staged simulation state without making the blueprint mutable. `model.predict` is an ML-domain alias, not the universal primitive.

This is an API design sketch, not a declaration of available syntax in the current compilers. Exact method signatures and generic constraints require Java/LLVM parity review.

## Canonical shape and grammar compatibility

Keep the accepted `define model Classifier(...) as Dense(...) ReLU() end` spelling. V1 nominal constructors must resolve to *typed model operations*, with NN layers a specialization; operators are not limited to tensor-shaped values. Operators can have scalar, fixed-size vector, record, or domain-specific, nominal input/output ports. No magic conversion of `|>` or `pipe` into model nodes. Retain the v1 static ordered sequence; the typed DAG and named-port/branch syntax is a **future explicitly versioned extension**, not retroactive approval of unimplemented new grammar.

Examples **conceptual, subject to future validated operator definitions**:

```oreslang
define model PriceEstimate(tax_rate: float = 0.15) as
    ValidatePrice()
    ApplyTax(tax_rate)
    RoundCurrency()
end

define model AudioFilter as
    DecodeSamples()
    LowPass(cutoff_hz: 3000)
    Normalize()
end
```

A physics step can be a pure `State -> State` transform. A multi-step simulation is an outer loop calling that step; cycles and time are not secretly introduced in the immutable graph. Recurrent nets, stateful operators and event feedback require explicit state-in/state-out or a separately specified, capability-checked session API. Never infer mutable feedback from graph edges.

## Mandatory static admission

- Every node resolves to a registered **nominal op signature** with exact input/output type and constraints (shapes/extents/layout/units where applicable); ports and types unify without implicit dtype conversion, reshape, broadcasting, unit conversion, GPU transfer, cloning or allocation. Explicit operators can do those conversions. Reject unresolved/ambiguous overloads and forged op metadata.
- Compiler verifies a finite deterministic topology, unique/stable node and edge identities, no cycles (including recursive model composition), no data-dependent topology, no side-effecting/suspending/FFI/spawn/clock/random/I/O operations. Graph construction uses only bounded checked compile-time constants and inert imports; op constructors may not run arbitrary user code at compile time.
- Pure models have no observable effects, but kernels can still fail deterministically on bad input or resource limits; use typed `Result`/errors and deny partially published output/state on failure. External non-determinism, random seeds and clock readings must enter as explicit typed inputs.
- Every runtime input is validated at the trust boundary, including rank, shape, stride, bounds, alignment, buffer byte spans, tensor element types, encoding and optional physical dimensions. Overflow and overlapping mutable views fail closed. No graph-provided pointer, lease or serialized metadata is trusted on its own.
- Check graph depth, node count, fan-in, live buffer/activation estimate and arithmetic overflow against an explicit compilation/execution budget; never allocate unbounded memory merely because a graph compiled. Freestanding profiles can statically provision all scratch. An op marked pure is **not** automatically safe for untrusted inputs or hard real-time use.
- Preserve lexical ownership and lifetime rules. Immutable code/graph descriptors can share inside authorized trust domains; `rt share` never publishes private pointers to unauthorized actors or processes. Mutable instance parameters/scratch/session state have exactly one owner, generation-aware leases and no loan spanning a suspension point.
- No op has ambient access to actor CONTROL, supervisor authority, filesystem, network or other capability. Optimizer, device, actor stage, transport and data-source permissions are each explicitly admitted by higher layers.

## Differentiation is an opt-in *capability* (v1 semantic correction)

A model that is used only for forward inference can freely contain nondifferentiable operators. **Do not emit `MODEL_MISSING_VJP` during a forward-only declaration.** Emit it when an explicit differentiable/training API requests a reverse path through an operation that must propagate gradients but has no validated VJP. Do not silently substitute zero or truncate gradients. Requesting a gradient only for selected targets requires validated VJPs on every live dependency path connecting the chosen output and target; unrelated branches need none.

VJPs must cover broadcasting/unbroadcast, duplicate operands, per-edge fan-in, saved activation version leases and dtype-specific numeric behavior. Optimizer and training state are not intrinsic to `ModelGraph`; trained parameters are a separately owned/versioned `ModelInstance` or session. CPU deterministic inference is the first target; stochastic operations require explicit seed/state input (not an ambient RNG).

This corrects the overstrict reject fixture `contracts/v1/model-autodiff/fixtures/reject_missing_vjp.ores`: interpret it as a *gradient-admission* negative fixture after expansion, not as evidence that a nondifferentiable forward-only model is illegal. Keep existing ML actor protocol, rollback/version fences and optimizer barrier requirements.

## Ownership, identity, portability, optimization

- Nominal model *type* identity is distinct from graph content fingerprint. Graph ID records declaration/package/code-version + typed op ABI and static config. Graph generation changes on shape/op/code changes; instance ID and parameter/optimizer version change independently. Never use a raw pointer or actor ID as a stable serialized graph ID.
- A blueprint/compiled op graph may be shared immutably; stateful `ModelInstance` is not implicitly `Copy`, `Sync`, serializable, or actor-transferable. Inference on a genuinely immutable frozen snapshot may be parallel `Sync` where the underlying buffers, kernel contracts and trust domain prove it. Training mutations remain single-owner/transactional.
- Compiler transforms (CSE/fusion/reordering/folding/placement) require equivalence under documented numeric precision, rounding, NaN/Inf, ordering and overflow policies; prohibit reordering across explicit observation/ownership barriers. Provide a portable reference evaluation mode and versioned golden tests.
- Save/load is opt-in with a stable, versioned schema. Serialize graph references, validated public tensor values and explicit parameter state, never closures, raw pointers, mutable borrows, code addresses, optimizer secrets or untrusted executable operator code. Reject unknown ops/ABI drift and oversized/synthetic descriptors.
- Hot reload follows generation fencing: a live session pins its graph and parameter versions; no implicit shape migration or mixed old/new tensor operations. Explicit validation/migration/rollback is required before publishing a new instance.

## Placement

| Layer | Responsibility | Exclusions |
| --- | --- | --- |
| `core::model` (proposed freestanding facet) | Nominal identity, static op/port descriptors, checked shape/bounds, pure evaluation *interfaces*, error/capability/effect metadata, fixed-size graph view | No required heap, OS, autograd, Tensor allocation, actor scheduler, GPU |
| `alloc::model` | Optional owned graph builder, scratch planners, buffers, generation-checked storage/leases | No mandatory OS/GPU |
| `std::model` | General graph execution, batching, diagnostics, serialization, profiling, dynamic operator registry behind explicit trust policy | No implicit remote side effects |
| `std::tensor` and `std::autograd` / dedicated packages | Tensor ops, VJP, finite differences, backward graph, saved activations | Not required for a scalar/DSP/business model |
| `std::ml` / `oreslang-ml` | Dense/ReLU, model.predict, trainer, loss, optimizer, training and actor pipeline plan | Not in `core` |
| domain libraries | `std::signal`, `std::control`, `std::sim`, finance/ETL libraries when useful | No new compiler keywords per domain |

Freestanding `core` must remain usable without Linux, threads, malloc, JIT or floating-point hardware (ops requiring f64 can be unavailable on a target). Public APIs should favor a shared type/trait contract and library-lowered IR over intrinsic ML kernels.

## Compatibility and acceptance gates

1. **Contract-only**: host oracle checks infer-only un-differentiable graph, gradient missing-VJP path, unrelated non-grad branch, effect/cycle/type/missing dependency/overflow/memory budget failures, deterministic topology and instance ownership.
2. **Compiler**: both Java/Graal and LLVM parser/HIR emit the same nominal model signatures, identical diagnostics and effects, contextual-keyword, zero-import-side-effect and serialization-negative cases. Existing ML v1 syntax must remain accepted.
3. **Real guest**: run and compare pure CPU non-ML scalar/record and signal model fixtures on both backends; execute an independent reference oracle and fault-injection/alias failures; record exact compiler/fixture SHA and executed steps.
4. **ML**: prove VJP for requested outputs/targets only, numerical finite differences, fan-in, optimizer commit and activation generation controls.
5. **Optional scaling**: actor, Task, GPU, remote, replay/hot reload and hard real-time profiles require their own scheduler/resource/security/trace-refinement gates.

**No real compiler/backend or runtime coverage is claimed by this RFC or by its source-free reference tests.** Do not mirror private Git trees across organizations unless a separately reviewed source/destination authorization policy permits that exact export.
