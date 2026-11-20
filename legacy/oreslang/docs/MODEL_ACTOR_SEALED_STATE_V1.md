# Actor-owned ML state and immutable parameter-version snapshots (v1)

**Status:** PROPOSED language/runtime contract, 2026-10-18. This document extends the draft `MODEL_ACTOR_AUTODIFF_V1.md`, not an implementation claim. Java/LLVM compilations, native tensor kernels and actor training are NOT verified by this PR.

## Hard language invariant

An Oreslang actor has **zero or one effective guest-owned `state { ... }` schema**; every persistent guest-owned actor value lives inside that schema. Actor instance fields such as `val Linear layer;`, inherited mutable fields, constructor-captured state, static side tables and out-of-band per-actor optimizer/tape caches are forbidden. Runtime-owned mailbox, gate tickets and GC/allocator metadata are not guest-accessible state.

A `define model` is an immutable typed graph blueprint and is **not** itself an actor. When a trainer instantiates actor pipeline stages, each concrete actor owns all its mutable model-stage data through its sole state schema.

### Illustrative actor (target source, NOT an executable fixture)

```oreslang
define actor DenseStage as
    state {
        active_version: int = 1;
        next_step: int = 1;
        // These types are proposed library abstractions, not stable exports:
        weights: FrozenParameterVersions;
        optimizer: OptimizerState;
        inflight: Map<ExecutionKey, ForwardContext>;
        gradients: Map<GradientKey, GradientAccumulator>;
        committed_steps: CommitReceipts;
    }

    receive(ActorMail<TensorMessage> mail): void
        with state.read, state.write, actor.forward, actor.backward
    {
        match mail.value over
            on TensorMessage.Forward as msg {
                // Short, synchronous read/write loan: verify epoch, reserve
                // an activation byte budget and PIN a frozen weight version.
                // The callback may return a verified, independent immutable
                // parameter lease/token, NEVER a state loan or mutable alias.
                const snapshot = using state.write(critical |s| -> {
                    return reserve_forward_and_pin(s, msg);
                });

                // No live state loan during matmul, device submission,
                // await, channel backpressure or downstream delivery.
                const output = dense_forward(snapshot, msg.input);
                const ticket = save_forward_context(snapshot, msg, output);
                using state.write(critical |s| -> {
                    publish_forward_context(s, ticket);
                });
                self.forward(make_forward_envelope(msg, output));
            }

            on TensorMessage.Backward as msg {
                const work = using state.write(critical |s| -> {
                    return admit_unique_gradient_and_snapshot(s, msg);
                });
                const result = dense_vjp(work, msg.gradient);
                using state.write(critical |s| -> {
                    merge_checked_gradient(s, work, result);
                });
                self.backward(make_backward_envelope(msg, result));
            }
        end
        mail.done();
    }
end
```

The syntax is **deliberately illustrative**: `using state.write(critical |s| -> ...)` is the proposed lexical exclusive state capability, equivalent in authority to the sealed `self.handle_state(callback)` write pathway. Ordinary actor callbacks cannot directly address `self.state`. Both read and write require an explicit verified loan; write always requires exclusive critical admission. Actual message typing/effects/transport and `using` grammar are subject to the existing actor-state compiler gates. `mail.done()` and `self.forward/backward` availability must not be inferred from this uncompiled example. A production implementation must provide exception-safe reservation rollback if forward fails after pinning.

## Why critical sections help versioning, but do not implement it

**Critical admission is a local atomicity primitive, not a version control system.** It serializes state transitions against other admitted modifications (including a configured >1 executing native actor thread), but it cannot guarantee correctness when old tensors remain in-flight after the loan ends, or when several actors commit on different nodes.

Use an **MVCC / read-copy-publish design**:

1. **Reserve / pin.** In one brief critical state transaction, validate run, graph generation, step, microbatch, actor incarnation, resource quotas, and committed weight version; reserve byte credits and pin an immutable weight snapshot. Record a unique execution key. Return only a generation-scoped immutable lease/token, never a reference to the actor's `state` object.
2. **Compute outside state.** Execute CPU/GPU kernels using immutable leased buffers; autograd owns immutable saved-forward values. GPU completion events and transport acknowledgements are awaited outside any state loan. A device handle is not automatically an Oreslang borrow, transfer, or cross-actor permission.
3. **Backward admission.** Match a live forward context and the exact recorded parameter version; reject wrong edge/generation, duplicate edge contribution, unknown activation and expired lease. Accumulate fan-in exactly once, with deterministic reduction order when requested.
4. **Prepare optimization.** After *every* admitted microbatch/edge in the current synchronized step has finished, compute an independent frozen candidate weight buffer and optimizer-state candidate. Validate shapes, finite values, and checkpoint/ownership budget. Do not mutate the committed weight storage in place.
5. **Publish with compare-and-swap.** Within one critical state transaction, check expected (run, incarnation, graph generation, step ID, active version), presence of a prepare receipt, no outstanding current-step backward dependencies, and absence of an existing commit receipt. Replace the weights **and optimizer state** with the prepared immutable next version and persist an idempotent receipt. Advance version exactly once. No await or device operation occurs in this transaction.
6. **Retire safely.** Old parameter versions and saved activations are dropped only after their pins/leasing readers, GPU work, and authorized transport uses have settled. Cancelling a step releases its own reservations exactly once and fences stale arrivals. Resource exhaustion is explicit backpressure/failure, never silent unbounded copies.

The parameter version is not just a counter. A snapshot binds **storage identity + immutable contents + dtype/shape/device + version + lifecycle epoch**. If a buffer can be mutated through any other alias after being frozen, the snapshot contract is violated even though the counter has not changed.

## Required state structure and boundaries

The single state schema may contain owned parameter handles, an optimizer record, version-to-lease maps, saved context descriptors, gradient fan-in counters and commit receipts. It may **not** expose raw mutable tensor storage to userland outside critical scope. A returned frozen version lease must be an independently checked capability minted/managed by the storage subsystem, not a borrowed `state.weights` object with its wrapper cast to readonly. Merely doing `rt share` does not fix an outstanding mutable alias.

Actual large tensor buffers should live in ownership-checked allocator/device storage; the actor state owns their handles and associated lifetimes. This preserves the single-`state` rule without duplicating multi-GB parameter arrays whenever a control field changes.

Different parameter shards owned by different actors each have a local `state` gate. **No collection of independent actor critical sections provides an atomic distributed commit.** V1 synchronizes them at an optimizer barrier; prepare all shards, validate all receipts, then publish a coordinated generation/step manifest or recover from a consistent checkpoint. Inference readers must not observe an uncommitted mixture of shard versions. Crashes after partial local publications require durable commit recovery/fencing; a coordinator acknowledgement alone is insufficient.

A shared actor cannot exploit read-only frozen versions to mutate cross-actor state. Private/untrusted actors obey their respective isolation and device-capability policies. Multiple threads executing a stage require actual runtime serialization of write loans and proven concurrent read admission, not a declaration-level promise.

## Static rejection cases

A conforming compiler must reject:
- `define actor Bad as val Linear layer; state {} ... end` and any second or inherited effective state schema.
- `self.state`, returning/capturing `s` from the loan, saving `s.weights` as a mutable alias, or publishing the loan through a message.
- `await`, suspension, GPU work submission or untrusted calls while a state loan/critical write permit is live.
- A `state.read` callback that writes or calls an unverified mutating function; `with state.write` without a lexical loan must not grant access.
- Unsynchronized in-place mutation of a frozen parameter version, forged gradient/commit receipts, or a second optimizer update for the same run/step/version.

Fail closed for compiler/backend configurations that cannot enforce these properties.

## Runtime/protocol acceptance cases

- two and many microbatches under one frozen weight version;
- fan-in contributions received out of order, repeated-edge disambiguation;
- insufficient fan-in blocks commit;
- duplicate forward, gradient, cancellation and commit are handled idempotently/rejected as specified;
- old-version gradient, wrong run/step/graph/incarnation, unknown/expired lease and stale optimizer prepare rejected;
- a frozen snapshot survives later publication without content mutation and retires only when pin count reaches zero;
- byte-budget and count-based backpressure; critical-section exit before every wait or compute;
- cancel-before-prepare, cancel-after-prepare, crash-after-local-publish and coordinated multi-shard recovery;
- random interleavings with 1 and 3 permitted actor execution threads, cancellation at each transition, race sanitizer and deterministic replay.

The companion host-only test demonstrates a **control-plane** version/commit ledger. It does not test critical integration, Oreslang parser/type checker, actual autograd gradients, CPU/GPU kernels or distributed durability.

## Completion gates

G0: proposed semantics + standalone host-only executable state-transition tests (this PR).
G1: Java/LLVM negative guest source checks for illegal actor fields/state escapes, and precise parser/effect diagnostics.
G2: compiled CPU tensor forward/VJP with frozen parameter version leases and finite-difference gradient validation.
G3: real multi-stage actor training with exact source-tree test evidence, bounded memory, cancellation/fault replay and commit gates.
G4: controlled multi-thread actors, GPU events and distributed shard commit/fencing, with sanitizer and provenance artifacts.

**No private source mirroring to an unrelated GitHub organization without explicit authorization.** Earlier host-only oracle runs are not native guest execution evidence.

## Implemented follow-up (October 18, 2026, still host-only)

- `tests/model-actor-rw-state-contract.test.mjs`: eight deterministic async host admission scenarios. Model preserves parallel read cohorts, exclusive writers, queued-writer fairness barrier, cancellation (including idempotent cancellation), bounded waiting queue, epoch retirement, forged/double ticket rejection and local atomic version publication while immutable old scalars remain valid.
- `tests/model-actor-state-versioning-contract.test.mjs`: nine MVCC/optimizer-ledger host scenarios from this draft. Together they test **state ownership and admission as separate abstract machines**, not as a compiled actor runtime.
- `oreslang-ml` draft [PR #7](https://github.com/ores-truffle-oreslang/oreslang-ml/pull/7): a proposed `.ores` actor scalar-gradient source fixture exercises read-only `using`, write `using(critical ...)`, both `self.handle_state(critical read ...)` and `(critical write ...)`, declared `with` effect rows, duplicate microbatch admission and premature/stale optimizer checks. Its test suite has isolated host V8 reference evidence only. The actual `.ores` program is **not yet verified** compiled/executed.

The RW host model is intentionally **conservative on nested same-owner admissions**: all nesting is rejected until the native/Java verified reentrancy policy is implemented. A separately admitted write does not inherit a former read ticket; read→write upgrade never happens implicitly. A retiring gate lets already running callbacks unwind before state reclamation; cancelling a queued waiter cannot release an executing permit. No OS/native mutex is held over an Oreslang guest callback or `await`.

Do not conflate a host simulator's `gate` member (runtime-only admission metadata) with a second guest-owned actor field. In Oreslang source, all guest-owned persistent state remains in the sole `state { ... }` variable. The scheduler's authenticated gate remains internal.


## Hardened host MVCC audit (October 19, 2026)

**Scope: control-plane simulator only.** The companion host suite is not compiled Oreslang, and its simulated pointer swap is NOT evidence that either Java/Graal or LLVM implements transactional actor state publication. PR #78 was merged before production release gates G1–G4 were established; that merge must not be treated as proof of production parity.

This audit found and regression-tested the following concrete failure modes in the prior simulator:

1. **Underfilled optimizer barrier:** previously any nonzero number of finished microbatches could commit, even if the configured step needed more. Admission is now bound to a bounded step manifest (count, optionally exact microbatch IDs). A partial or unplanned batch cannot publish weights.
2. **Caller-owned execution-key alias:** the forward ledger previously retained a caller-provided object. Mutating that object after admission could change the version used by cleanup. Store an immutable independently owned copy and compare the backward key with the originally admitted context.
3. **Borrow/lease authority confusion:** shallow checks of returned loan objects missed nested mutable aliases; copied frozen snapshot wrappers could release the original snapshot. The host simulator now checks nested return references, allows only explicitly minted immutable opaque receipts/leases, and requires original snapshot/prepare capability identity. **This dynamic scan cannot catch closures or replace compile-time loan-escape analysis**, and a real transport must not accept client-invented capabilities.
4. **Prepare-to-publication race:** new forwards or backward mutations were previously admissible while an optimizer candidate was already prepared. They are now fenced until that step commits or cancels. The prepare receipt binds run, graph, actor incarnation, step and expected weight version.
5. **Partial publication on failure:** commit previously performed multiple mutations to the live root: publish version, update optimizer, refund pins, clear contexts and advance step. It now prevalidates refunds and counters, constructs a detached successor (versions, optimizer, receipt ledger, credits, step) and swaps the simulator's sole state root **once**. Cancellation likewise stages refunds before a single root swap. In actual Oreslang this must be implemented as a runtime-verified critical transaction or atomic state-root publication, not arbitrary guest access to `self.state`.
6. **Unbounded ledger/pins and integer overflow:** historical commit receipts and frozen snapshot leases are now independently bounded in the host model; counters, budgets, manifests and version collision are validated before publication. Overflow, replay, duplicated delivery and exhausted credits fail closed. Trimming old receipt history is safe only while monotonic run/step/epoch fencing remains enforced.

The hardening includes repeatable deterministic interleaving tests across 48 seeds × 5 consecutive two-microbatch steps, exercising out-of-order edge completion, snapshot retention after publication, optimizer monotonicity and version retirement. Fault cases inspect the *unchanged old root* after a rejected publication or cancellation. All of this remains host-oracle evidence only.

### Still-blocking threats (not solved by the host suite)

- **Authenticated gradient origin and ownership.** A string edge name and matching header are not authentication. The production Mailman/ActorMail boundary must seal the producer actor identity, producer incarnation, consumer incarnation, graph edge ID, delivery nonce and run/step/weight-version identity. The gradient receipt ledger must be keyed by that authenticated tuple, not by user-supplied JSON. Exactly-once contribution at the stage is separate from at-least-once transport delivery. Neither signature nor possession of an echoed identity field is sufficient without runtime provenance.
- **Optimizer candidate provenance.** The reference `prepare(step, version, candidateValue)` still accepts caller-supplied candidate scalars after barrier completion; it cannot prove they came from accumulated VJPs. Real prepare must bind a frozen gradient digest and an optimizer computation manifest to an immutable weights **and optimizer-state** candidate, then verify this evidence during local CAS publication.
- **Crash/durable recovery.** A single in-process pointer swap prevents ordinary exceptions from exposing partially modified in-memory simulator state. It does **not** provide process-crash durability, WAL discipline, device DMA completion, replica coordination or globally atomic shard publication. A restart must fence earlier actor incarnations, reconstruct durable receipts and publish a manifest only after all shards satisfy commit/recovery rules.
- **Real resource accounting.** Byte credits currently cover logical activation reservations, not a proof of bounded allocator heaps, native tensor ownership, GPU snapshot buffers, pending transport acknowledgements or actual device-event lifetime. Real frozen storage must be deep immutable with no accessible mutable alias.
- **Compiler/effects enforcement.** No host JavaScript alias scan can rule out closure capture, callback reentrancy, async suspension inside critical state, nested actor state aliases or foreign function escape. Java and LLVM compiler negatives plus actual guest training remain mandatory.

**Evidence rule:** the source simulator's results must be labeled `HOST_ONLY`. Do not attribute Node-native, LLVM-native, Graal, tensor-VJP, distributed-commit, or race-sanitizer success unless the exact changed tree actually ran in the corresponding engine. While security incident oreslang-platform-conformance #22 remains open, do not copy private source to any cross-organization CI mirror even if that carrier is currently private. Use authorized same-org CI and provenance gates.

### Next executable release gates

- Integrate authenticated receipt types and bounded ledger into production actor runtime; reject stale run/graph/step/version/producer/consumer incarnations.
- Implement detached prepared optimizer publication via sealed `handle_state`/lexical `using state.write`, preserving sole actor `state` ownership, with real compiler-negative escape/effects tests.
- Compile and execute the `oreslang-ml` scalar actor fixture and `oreslang-autograd` VJP under both Java and LLVM; check numeric gradients against independent finite differences and prove exact source-tree identity.
- Exercise deterministic cancellation/failure injection, multi-shard restart recovery and bounded native memory under concurrent actor work.


## Reconciled cohort and activation lifetimes

A planned step may exceed the in-flight activation capacity. Each completed backward fan-in retires its activation and byte/pin credits into a bounded completed-microbatch set; optimizer preparation still requires the entire planned cohort. Snapshot leases retain their independent identity and pin budget. Prepare/commit/cancel preserve exact capabilities, validate the full pin ledger, and stage a detached successor before one local state-root publication. This remains a host-only model, not native guest or training-runtime proof.
