# Actor hierarchy, trait obligations, and differentiable stage admission v1

**Status: proposed target contract and host-only regression model, NOT native Oreslang execution or five-backend parity.** This complements `MODEL_ACTOR_AUTODIFF_V1.md`, `MODEL_ACTOR_SEALED_STATE_V1.md`, `ACTOR_ON_HANDLER_SYNTAX_V1.md`, and the Java actor-class integration draft #185. It is not a competing actor runtime or tensor implementation.

## Canonical object-model decision

`define actor A1 as ... end` declares a **nominal actor class**. Its implicit superclass is the compiler-intrinsic `Actor`; this is distinct from an ordinary user class and from an actor *callable* (`actor fnc`). `define class A1 extends Actor as ... end` is an actor-domain normalization target, not a way to turn an ordinary class instance into an actor at runtime. The actor's identity, lifecycle, mailbox, CONTROL authority, scheduler turn and isolation kind are compiler/runtime-owned.

1. **Exactly one concrete actor superclass** (or the implicit root); no arbitrary multiple class inheritance. An actor may extend only an actor-class root or actor subclass of the **same execution domain**. `Actor`, `IsoActor`, and `UntrustedActor` are separate intrinsic roots. A plain class, a supervisor, an arbitrary FFI host class, or an actor from another domain is not a valid actor parent. `ChildProcManager`, `GenServer`, HTTP actors and similar bases are eligible only if they are explicitly declared and linked as actor-safe, domain-compatible bases. Inheritance never gives OS/process/network permissions.
2. **Interfaces** specify stateless nominal method obligations. An actor may implement multiple interfaces and narrow `ActorRef<A1>` to a verified `ActorRef<Interface>`, preserving the original actor address, mailbox, generation and runtime authority. It may not manufacture an ActorRef from structural shape or perform an unchecked reverse/downcast.
3. **Traits** are behavior/capability proofs, not superclass instances. Reject trait instance fields, mutable statics, implicit state capture, or default implementations which access another actor's state, perform mailbox-escaping calls or acquire CONTROL. Trait default methods, if lowered, may be pure/stateless until separately proven actor-effect-safe. No duplicate/conflicting inherited slots. `Send`, `Sync`, `Share`, `Sendable`, and codec-qualified `Serializable<Format>` are distinct; a trait assertion cannot override ownership inference. `Share` implies `Send && Sync`.
4. **Nominal protocol ABI**: public actor methods, including inherited public methods, are the typed mailbox protocol; preserve normalized selector/name, arity, exact parameter/return signatures, visibility monotonicity and checked effects. Interface implementation must be verified against concrete resolved methods. Method bodies execute only under runtime-owned actor turn admission. No bound-method address escaping as a direct external actor call. Protected/private inherited helpers are not public ActorRef methods. No override of runtime-private dispatch, lifecycle or supervisor CONTROL primitives.
5. **Sealed state across hierarchy**: at most one *effective* guest `state { ... }` schema across the entire actor ancestry. An inherited schema cannot be replaced, shadowed, exposed by a public field, mutable trait default or subclass constructor. Do not permit a user class to smuggle actor state through an ordinary instance field. State can be read/written only through the verified lexical actor-state loan rules; cannot be held across kernel execution, `await`, send, serialization or hot upgrade. Inherited methods are subject to exactly the same state effects and incarnation fences.
6. **Hierarchy and lifecycle**: no cycles, no extending a final base, no bypass of sealed permits, and no weaker isolation, permissions, restart policy or trust tier. Constructors run under actor bootstrap authority and cannot suspend or publish a partially constructed self. `panic` goes to supervisor CONTROL; traits and classes cannot intercept it as a normal DATA event.
7. **No unsafe fallback**: until a backend checks the entire hierarchy, it must reject relevant actor/trait constructs. Parser success, an interface schema, a host oracle, or a scalar native run is not actor guest execution evidence.

### Illustrative *target-only* declaration

```ores
define interface TrainableStage as
    forward(batch: TensorBatch) -> Result<SendReceipt, StageError>;
    backward(gradient: TensorGradient) -> Result<SendReceipt, StageError>;
end

define actor DenseStage implements TrainableStage as
    state {
        // Types are library proposals: every persistent handle is owned here.
        weights: FrozenParameterVersions;
        inflight: ActivationLedger;
        optimizer: OptimizerState;
    }
    // Typed public protocol methods lower to ONE runtime-owned mailbox.
    // Short state loans reserve/pin, then close BEFORE CPU/GPU kernels or send.
end
```

This is a compilation target, **not** syntax/runtime proof; the effective Java actor grammar and current backend capabilities must be reconciled before treating it as an executable fixture.

## Neural/tensor execution as an actor graph, not actors-per-neuron

- `oreslang-tensor` stores checked contiguous tensor descriptors, strides, dtype/layout and caller-owned buffers. Implement neurons as vectorized matrix operations and fused activation kernels (SoA/AoSoA where useful). Do not spawn one actor per neuron, tensor element or scalar gradient.
- `oreslang-autograd` owns a reverse topological DAG, differentiable VJP registry, immutable saved-forward activation references and exact *edge*-indexed fan-in. Reusing one tensor twice yields two contributions even from the same sender. Missing VJP must reject rather than treat derivative as zero.
- `oreslang-ml` owns layers, losses, optimizer policy and explicit synchronous training barriers. A coarse actor per model stage, shard, or bounded worker partition owns `state { weights, activations, gradients, version, receipts }`, not a separate actor for each mathematical operator.
- A forward envelope carries authenticated run, stage/actor incarnation, graph generation, step, microbatch, parameter-version, edge, dtype/shape and bounded buffer lease. Forward records/pins the exact immutable parameter version and returns before its corresponding backward arrives as a *later actor turn*. Neither borrow nor critical section spans a kernel or remote wait.
- Backward accepts only a runtime-minted live activation capability for that exact context; reject duplicates, wrong edge, wrong version, old epoch, expired lease and shape/device mismatch before mutating any gradient ledger. Use deterministic reduction when requested; prevent NaN/Inf from entering an update.
- Before `prepare`, require **all planned microbatches and fan-in edges**, not merely the work observed so far. Preparing seals forward/backward admission and snapshots an independent candidate weight **and optimizer** state. Publishing uses a versioned atomic local transaction; cross-shard publication needs a durable coordinator manifest/recovery protocol (not just several local critical locks). Failed/cancelled steps must not partially publish.
- Bound queue count, tensor bytes, activation reservations, retained versions and idempotency receipts; release quotas exactly once on success/cancel/crash. An actor `pipe` represents stages, while `|>` stays value/function composition. A data pipeline may include a typed `DataLoader -> Transform -> DenseStage -> Loss -> Optimizer` graph with backward edges separately admitted.

## Five-backend release gate

| Backend | Target positive proof | Required negative before promotion |
|---|---|---|
| Java/GraalVM | Build/execute inherited typed actor protocol and sealed state under real runtime turn | ordinary-class parent, trait-state injection, actor-private method escape, state loan crossing await |
| LLVM native | Same source and actor envelope; deterministic native ownership | wrong actor domain, stale generation, bad parent/interface resolution, invalid gradient lease |
| Wasm | Real guest in worker-backed actor host, bounded typed transport | forbidden host import, wire ActorRef/capability forgery, lost worker cancellation |
| Cranelift | Initially reject all actor/class/model unsupported syntax without IR/JIT | every actor inheritance/trait/model negative; do not count this as implementation parity |
| .NET Native AOT | Fully native guest actor source and deterministic protocol | no JIT fallback, unsupported actor parent or interface, mismatched optimizer epoch |

All feature/evidence statuses start at `NOT_EXECUTED` for **this new contract**, even if another previously pinned case was proved. Require exact compiler SHA, identical guest blob digest, actual executed runner steps, observed output/error, sanitizer/resource receipts when applicable, and a tested rollback. The read-only host test `tests/actor-hierarchy-ml-v1.test.mjs` validates only this proposed admission/reference model.

**Security constraint:** platform-conformance issue #22 remains open. No private Git tree may be mirrored to a different organization without independently verified authorization and containment approval. Keep execution in the source repo or explicitly approved secure runner; never treat a private destination alone as sufficient authorization.
