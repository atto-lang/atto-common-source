# First-class models, tensor graphs and differentiable actor pipelines — v1 proposal

**Status:** normative candidate language/runtime contract, NOT compiler support or training parity. October 18, 2026.
**Authority:** common-source language semantics; numerical algorithms remain pure Oreslang in `oreslang-tensor`, `oreslang-autograd`, `oreslang-ml`. The existing compiler backends remain independent pending shared-HIR adoption.

## Canonical source spelling

```oreslang
define model Classifier(
    features: int = 784,
    hidden: int = 512,
    classes: int = 10
) as
    Dense(features, hidden)
    ReLU()
    Dense(hidden, classes)
end

pub fnc main() suspends {
    const trainer = ml.trainer(
        Classifier(),
        loss: CrossEntropy(),
        optimizer: AdamW(lr: 0.001),
        pipeline: ml.pipeline(
            stages: #auto,
            devices: #auto,
            schedule: #one_forward_one_backward
        ),
        microbatches: 16
    )
    await trainer.fit(dataset)
}
```

This is an **unimplemented example**, not a passing `.ores` program. `Dense` is the readable layer spelling and may be an alias of the existing planned `Linear` operator; do not create two independent matrix kernels. Initial tensor reference calculations are f64/CPU, not an implied generic f32/GPU ABI. `dataset` is an application-provided typed value.

The explicit `ml.pipeline(...)` option is a *placement/scheduling plan*, not the graph, a new actor operator, or a requirement to create a user-level actor per neural layer. It may be omitted; initial default is single-stage CPU fill-and-drain execution with one microbatch. `#auto` placement requires capability admission and resource limits; cannot silently request a GPU or off-host execution.

## Syntax and static meaning

```ebnf
model_decl    = "define" "model" IDENT [ "(" [ formals ] ")" ] "as"
                model_item { model_item } "end" ;
model_item    = nominal_layer_call [ ";" ] ;
nominal_layer_call = IDENT "(" [ compile_time_arguments ] ")" ;
```

1. `model` is a contextual declaration keyword immediately after `define`; do not globally reserve it in unrelated identifier positions without a separate migration.
2. Formal parameters use ordinary Oreslang named/default-argument typing and compile-time constant defaults. `model` declarations do not execute arbitrary module-import code.
3. V1 body is a non-empty **ordered sequence of statically resolvable layer constructors**. Reject arbitrary expressions, I/O, suspending calls, nested actor spawns, mutation, uncontrolled recursion and dynamic topology. The lowered graph is immutable after instantiation, barring an explicit new generation.
4. Layer signatures carry tensor dtype/shape/stride/layout, gradient rule and parameter schemas. Adjacent ports must unify without implicit reshape, dtype conversion, copies, broadcasting or device transfer. Batch dimension may be symbolic but consistently constrained.
5. Each declaration denotes a nominal **model type** and graph blueprint. `Classifier()` creates an instance with independently owned trainable parameter storage, stable parameter IDs and a graph generation. Calling/using a model for inference is not itself training.
6. Internally lower to a `ModelGraph` of typed operations, then independently to `ExecutionGraph` partitions of actor stages. Stage count need not equal layer count. Operator fusion must preserve the observable mathematical and ownership semantics.
7. Do not hijack `|>` (eager left-to-right function value pipeline) or `pipe` (typed actor pipeline). Model declaration order is its own graph notation.

## Automatic differentiation

- Backprop is built into `ml.trainer` for graph operations with registered VJPs (vector-Jacobian products). No user-written `self.backward` is necessary for built-in layers. A custom layer must declare an admissible VJP; absent gradients produce a **compile/admission diagnostic**, not zeros.
- Forward records only the necessary immutable activation/checkpoint information in generation-scoped leases. Backward traverses the **reverse dependency DAG**, not merely a reversed linked list. If a tensor/parameter has multiple downstream uses, sum contributions exactly once per distinct incoming edge (including repeated operands); enforce fan-in completion.
- Reduction order can be deterministic under a requested policy. Floating-point arithmetic is not mathematically associative: reproducibility guarantees must name dtype, reduction order, kernel backend, seeds and optimizer policy.
- Support explicit `detach`/no-grad boundaries when added; `detach` is never implicit on message delivery, a device hop, or an actor boundary. Unsupported dynamic control flow and higher derivatives fail closed in v1.
- Trainable parameter and optimizer state have unique mutable owners. Frozen immutable tensors may share within authorized allocation/trust domains; `rt share` does not export private pointers. Across isolation boundaries and machines, use an admitted copy/transport or scoped lease.

## Actor stage state and parameter ownership (normative refinement)

Every concrete actor stage owns all persistent guest data through its **single `state { ... }` declaration**, not arbitrary actor fields such as `val Linear layer;`. State must be borrowed only inside sealed lexical read/critical-write loans. Short critical transactions protect reservation, snapshot pinning, gradient accumulation, and local weight/optimizer publish; tensor kernels, awaits and actor sends happen after releasing the state loan. Forward/backward must reference the same immutable pinned parameter version. Local criticality alone cannot guarantee distributed optimizer atomicity. See [the detailed state, snapshot and commit protocol](MODEL_ACTOR_SEALED_STATE_V1.md).

## Typed forward/backward actor transport

The built-in differentiable stage contract **uses the existing typed actor directionality** (`self.forward`, `self.backward`), but messages for training carry a validated envelope:

```text
TensorForward { run_id, step_id, microbatch_id, graph_generation,
                weight_version, edge_id, tensor_descriptor, buffer_lease }
TensorBackward { run_id, step_id, microbatch_id, graph_generation,
                 weight_version, edge_id, tensor_descriptor, gradient_lease }
StepCommit { run_id, step_id, graph_generation,
             expected_weight_version, optimizer_id }
```

- `edge_id` identifies a distinct graph contribution, not merely an actor sender. An envelope is invalid if an identifier is missing, duplicated, outside the graph, stale or from the wrong generation/version.
- The receiver checks dtype/shape/strides/extents and checked byte-length/offset arithmetic before admitting a buffer, and checks that the lease permits the requested access. No raw pointer is a wire identity.
- Maintain an activation context keyed by (run, step, microbatch, graph generation, weight version). A backward envelope is admitted only for a matching live context and edge; reject duplicates, late/unknown gradients, stale leases and cross-step reuse. Release activation context after all required contributions or cancellation.
- Messages and in-flight activations are bounded. Capacity exhaustion applies backpressure or an explicit failure, never unbounded allocations.
- **Serial actors must not await their own downstream backward completion while retaining actor-state exclusivity.** Process forward, record a valid lease, publish output and end the handler; backward arrives as a later turn. Any resource lock is released before asynchronous dispatch.
- Actor supervision and restarts do not equate to exactly-once computation. Every commit uses idempotency/generation checks, and recovery must either restore a consistent checkpoint or abort that step without publishing partial optimizer state.
- Backward direction is training-gradient traffic, not a reply or supervisor/CONTROL channel. Cancellation and `raise`/`panic` retain their existing propagation rules; gradient transport does not capture them as ordinary values.

## Optimizer synchronization and schedules

- V1 requires **synchronous SGD/AdamW step boundaries**: accumulate all scheduled microbatch gradient contributions at the *same* parameter version; run finite-value/shape/lease checks; then publish the next parameter version atomically per coordinated step. Every step has at most one committed optimizer update.
- 1F1B scheduling is a scheduling policy, not asynchronous stale-weight training. Forward/backward of a microbatch use a matching weight version. A scheduler may defer parameter updates until all relevant microbatches have backward-completed. Weight stashing is a future separately gated mode.
- Expose `#fill_drain` first, then `#one_forward_one_backward` after memory/reentrancy proof. Multi-stage execution must preserve topological dependencies and bounded memory, and must reject invalid stage counts/device requests rather than downgrade silently.
- Actor stage placement is an optimization. Minimize actor-per-scalar/actor-per-element overhead by compiling fused tensor operators and tiling large tensor computation onto workers; mathematical kernels remain in the tensor/numeric stack.

## Layering and freestanding boundary

| Home | Responsibility |
| --- | --- |
| `core` | Existing minimal types, ownership and freestanding primitives. No mandatory heap, OS, neural-network or GPU dependencies |
| `alloc` | Opt-in contiguous storage, checked tensor views/arenas and buffer leases |
| `oreslang-tensor` | Pure Oreslang tensor kernels; later accelerated backends under the same checked ABI |
| `oreslang-autograd` | Pure Oreslang VJP rules, tensor tape, fan-in, saved-activation lifecycle |
| `oreslang-ml` | Layer descriptors, model instance, optimizer and training API |
| actor runtime | Typed bounded forward/backward transport, CONTROL-aware scheduling, resource admission |
| Java/LLVM frontends | Contextual `define model` grammar, static graph/type/effect/ownership validation and lowering |
| `oreslang-ml-conformance` | Backend-independent numerical oracles and pinned executed-guest evidence |

## Release gates (all initially PENDING)

**G0 (this PR):** shared proposed spelling, coherent grammar, positive/negative fixture registry, host-only contract self-tests.

**G1:** Java and LLVM parse and reject invalid `define model` sources; verify unchanged `|>`/`pipe` behavior. Emit typed model graph IR with stable IDs.

**G2:** `Tensor<T>` ownership-safe contiguous storage, unbroadcast VJPs, gradient finite differences and committed parameter versions exercised by real `.ores` programs.

**G3:** compiled guest CPU MLP inference/training, exact forward/backward fan-in, deterministic convergence and independent numerical oracle comparison.

**G4:** multiple real actor stages and bounded 1F1B/backpressure, stale generation/replay/cancel/restart tests, sanitizer/ownership assertions; benchmark peak activation bytes against fill-and-drain.

**G5:** optional GPU, cross-process and multi-node transports only with explicit device/lease/security admission and real measured evidence.

Proposals, schemas, host-only tests, emulator traces or source mirrors alone do **not** prove a compiler executed Oreslang or that a device transport is zero-copy. Do not export private source into another organization without explicit authorization, regardless of available CI minutes. Record compiler commit, exact fixture blob, toolchain, executed runner steps, results and artifacts for each backend/mode.
