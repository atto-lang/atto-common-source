# Unifying Oreslang tensor, data and AI/ML actor pipelines — v1 (PROPOSED)

**October 18, 2026.** Shared language/runtime contract, not shipping Java/LLVM/Graal source interoperability. This PR is stacked on the sealed-state/autograd common-source drafts #78 and #76. The tensor row-batch/gradient implementation is in [oreslang-tensor PR #5](https://github.com/ores-truffle-oreslang/oreslang-tensor/pull/5); [oreslang-autograd PR #5](https://github.com/ores-truffle-oreslang/oreslang-autograd/pull/5) adds saved-forward value-consistency validation before invoking its gather VJP; aligned data loading + affine training is in [oreslang-ml PR #8](https://github.com/ores-truffle-oreslang/oreslang-ml/pull/8). These sibling PRs are independent and unmerged.

## One execution model for data and ML

A data pipeline is a **typed, bounded graph of actor stages**. A tensor graph is a **typed numerical/gradient computation DAG**. A model graph is a **parameterized tensor DAG**; an execution planner partitions it across one or more actor stages. Never assume one actor per tensor element/op, one actor per neural layer, or that an arbitrary data shuffle is differentiable.

Stages may execute pure `.ores` kernels on CPU while scheduling transport, resource leases and IO via capabilities. Same-node immutable buffer sharing/zero-copy requires independent storage proof; cross-isolate, remote and device memory need explicit authenticated leases or copies. All kernels must obey checked layout and finite arithmetic.

### Sole state + effects + RW rule

**Exactly zero or one concrete actor guest state declaration** is permitted:

```oreslang
define actor BoundedDataStage as
    state {
        partition_next: int = 0;
        actor_epoch: int = 1;
        admitted_bytes: int = 0;
        max_bytes: int = 1048576;
        watermark_ms: int = 0;
        // Eventually bounded maps: identities, active leases,
        // replay/ACK receipts, activations, gradients, checkpoint state.
        // No ordinary persistent actor instance fields.
    }

    private reserve(int sequence, int bytes): int
        with state.read, state.write
    {
        return using state.write(critical |s| -> {
            if sequence != s.partition_next; do
                return -1;
            fi
            if bytes < 0 || bytes > s.max_bytes - s.admitted_bytes; do
                return -2;
            fi
            s.admitted_bytes = s.admitted_bytes + bytes;
            s.partition_next = s.partition_next + 1;
            return s.partition_next;
        });
    }

    private used(): int with state.read {
        return self.handle_state(critical read |s| -> s.admitted_bytes);
    }

    // Typed DATA receive/ACK handlers are a future compiler milestone.
    // No state loan remains live while executing tensor kernels or awaiting.
end
```

`with` is a verified **effect upper bound**, `using` a **lexical state capability**, `critical` exclusive write admission, and `handle_state` the sealed runtime intrinsic. Read-only callbacks use shared read admission when their actor's actual executor policy admits it; default serial actor execution can still run only one turn at a time. State permissions do not imply concurrent thread execution. `state.read` cannot mutate or upgrade to write; read→write upgrade is rejected until a separately proven explicit transaction protocol exists. All state loans are ephemeral and nonescaping; no `await`, select, GPU submission, I/O or unverified call while a loan lives.

The actor's runtime-owned RW gate, mailbox headers, carrier tickets and CONTROL events are **not additional guest-owned fields**. Training weights are immutable snapshot leases whose ownership and generation are recorded in `state`; the pure tensor compute takes place **outside** the state callback. Failed compute cancels its reservation and credits, without publishing partial weights, gradients or sink effects.

## DATA/ACK/watermark protocol

The `contracts/v1/tensor-data/tensor-data-envelope.schema.json` JSON Schema Draft 2020-12 defines three ordinary DATA-plane message kinds: `data`, `ack`, `watermark`. It is **not** a trusted authorization token, a supervisor CONTROL envelope or an actual byte-level wire format. Fields are versioned by run, actor incarnation, graph generation, partition sequence and step/microbatch identity.

A validated DATA tensor descriptor is row-major `f64` with rank two, shape `[rows,cols]`, strides `[cols,1]`, and checked byte length `rows*cols*8` (bounded and checked before allocation). The frozen lease has a generation-scoped ID **issued by a trusted storage authority**. A guest-provided `lease.id` string alone is never an authenticated authority. No raw pointer, device address, cross-actor mutable borrow or arbitrary user object appears in a wire envelope.

Per-partition DATA arrives with contiguous sequence numbers. An application-level ACK releases reserved count/byte credits **only when the actual consumer has completed the admitted work**; it does not mean a durable external sink committed. Replay of an already ACKed identical digest can receive an idempotent receipt; changed-payload digests and old unknown receipts fail closed. Checkpoints include per-partition next sequence, watermark and dedup/ACK receipts or a durable equivalent, and fence prior actor incarnations after restart.

A watermark cannot decrease. For this conservative V1, each partition's watermark advances only after its currently admitted data finishes; cross-partition window-close safety requires the minimum watermark across **all active partitions**. Late events must be explicitly rejected or follow a separate retraction/upsert plan, never silently mutate a closed window. Idle partitions need an explicit coordinator-signed idle/retirement policy, not an inferred wall-clock timeout.

### Resource and fault contracts

- Bound mailbox messages, active microbatches, outstanding leases, **bytes** and receipt retention. Capacity checks never overflow and reject admission without mutating cursors/credits.
- No serial actor suspends holding its RW state loan waiting for downstream gradient/ACK feedback. Register context, dispatch, finish turn; later messages complete the reverse dependency DAG.
- A retry is not a second gradient contribution. Uniqueness includes (run, actorEpoch, graphEpoch, step, microbatch, input edge, parameter version).
- `panic`/STOP/cancel/teardown fence old epoch and refund active credits exactly once. Supervisor CONTROL remains separate from DATA/ACK; an ACK cannot forge a successful CONTROL outcome.
- MLOps weights use frozen versions and complete fan-in barriers; distributed optimizer commit needs a durable coordinated transaction and inference-generation visibility policy beyond any individual actor RW gate.
- Backward through gather is **scatter-add** of duplicated sample rows. Tensor operations register VJPs in `oreslang-autograd`; dataset sampling decisions, I/O, ACK, watermark and routing are normally non-differentiable effects.
- Make telemetry bounded: queue bytes, in-flight activations, oldest watermark, step/version, rejected replay codes, handler latency and lease pressure. Do not expose tensor content or high-cardinality private IDs by default.

## Independently authored schema authorities

Files are distinct **proposals**, deliberately not asserted equivalent:
1. `tensor-data-envelope.tsp` — peer TypeSpec model definitions.
2. `tensor-data-envelope.schema.json` — independently authored Draft 2020-12 schema.
3. `tensor-data-envelope.wit` — provisional Wasm component ABI shape, whose kebab-case field names and unsigned widths are explicitly mapped rather than assumed equal.

Future gate: generate a JSON Schema witness from TypeSpec, compare the two in memory with `ORESoftware/typespec-json-schema-validator` (bidirectional instance probes plus semantic guards), then record a digest-bound receipt. WIT ABI and canonical encode/decode require an independently versioned mapping and lossless integer bounds checks. Current peer declarations have semantic differences (e.g. TypeSpec generic `int64[]` versus exactly two nonnegative shape/stride elements in JSON Schema). These are **known drift** until expressible and verified; fail closed rather than relax the JSON Schema or pretend parity.

## Validation and release gates

`tests/tensor-data-delivery-contract.test.mjs` is a **host-only** model covering independent partitions, count/byte backpressure, stale epochs and lease rejection, descriptor/overflow, idempotent ACK, replay tampering, monotonic watermarks, snapshot/restart and cancellation. Isolated V8 execution at publication: **12/12 tests, 6,079 assertions**. It does not hold a real Oreslang actor RW ticket or durable sink.

**P0**: Java/Graal source compiler consumes canonical `state`+`with`+`using` syntax and runs a bounded DATA pipeline from source with actual tensors; verify exact-tree Maven, Native Image and fail-closed negative diagnostics.

**P1**: Same supported source subset in LLVM with owned buffer-lifetime semantics, ASan/UBSan, and compiled 3-stage forward/backward streams. Reject unsupported generic tensor features rather than host fallback.

**P2**: Actual `oreslang-tensor` row gather/scatter VJP and `oreslang-ml` dataset extraction compiled and executed with loss-decreasing training, finite-difference gradients, cancellation and resource-bounded replay.

**P3**: Multiple physical actor carriers (opt-in max=3), concurrent read grants, exclusive writes and logical cancellation/STOP/watermark race stress, with proof that any state loan ends before a yield/device wait.

**P4**: Deterministic shuffling, event-time windows, checkpointed cursor and sink transactions, 1F1B training, tensor/data parallel sharding, CPU/NUMA/GPU placement and authenticated remote actors.

Do not mirror private repository trees to another organization without an authorized private destination. A source-free numerical oracle, schema validator, TypeSpec witness or documentation page cannot replace an executed Oreslang compiler/runtime milestone.

## Audit hardening: bounded replay receipts (October 18)

The initial host reference model admitted an unbounded ACK-receipt map and used the JavaScript safe-integer range for tensor extents, whereas the independently authored schema caps row/stride values and byte lengths at 2,147,483,647. These were real semantic gaps. They are now corrected in the host ledger:

- `maxReceipts` is a required bounded accounting domain (default 1,024). Admission **reserves** a future receipt slot before consuming tensor byte/item credits; the ACK can then publish its receipt and release credits without receipt-memory exhaustion.
- If the receipt budget is full, reject new DATA with `DATA_RECEIPT_BACKPRESSURE`. Do not silently evict recent dedup records or claim at-most-once application without an authenticated durable checkpoint.
- To resume indefinitely, a later milestone must implement trusted **durable receipt compaction and epoch transition**. A local checkpoint object alone is insufficient to authorize old-receipt eviction. Future snapshots must also enforce integrity and bounded restore sizes.
- Rank-2 row/column extents, strides and byte length now match the JSON Schema integer caps in the host semantic validator. A JSON Schema string field is not an authority for a storage lease or digest identity.
- Latest isolated host reference: **12/12 tests, 6,079 assertions**. These are still not Java/LLVM compiled actor or TypeSpec emitter tests.

Never confuse a passing host state-machine test with a verified RW-lock implementation, durable exactly-once transport, tensor autograd guest run or model convergence.
