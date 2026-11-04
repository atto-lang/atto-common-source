# State-region admission trace contract (candidate v1)

**Status: source-free checker; not compiler or backend parity evidence.**

This candidate normalizes the logical linearization history of a mutation domain so Java/Graal, LLVM, WASM, .NET Native AOT and Forge can eventually produce comparable safety receipts. It does **not** require matching scheduler interleavings, wall-clock timestamps or heap allocation strategies.

## Trace envelope

A full JSON document contains:

- `schema_version: 1`, `backend` (one of `java`, `llvm`, `net`, `wasm`, `forge`).
- `source_sha`: exactly 40 lowercase hexadecimal digits, intended to be independently matched to the exact compiled source commit. Merely providing a SHA-shaped string proves nothing.
- `thread_count`: 3, 7, or 15 for the initial contention matrix.
- `minimum_parallel_readers` (optional): a positive integer that must be reached in the reported grants.
- `events`: global, strictly monotone `seq` values recorded at the actual admission/access/release/retirement **linearization points**, not at arbitrary log-print completion times.

Supported event operations:

| `op` | Required fields | Meaning |
| --- | --- | --- |
| `request` | `seq, ticket, domain, actor_generation, execution, execution_generation, carrier, mode` | Generation-fenced logical execution requests `read` or `write`. A carrier is a distinct observed platform worker, not a distinct logical task. |
| `grant` | `seq, ticket` | Successful admission, counted against all live grants on the same domain and generation. |
| `access` | `seq, ticket, execution, execution_generation, kind` | Actual protected `read` or `write`. Additional domain/generation fields, if present, are checked for equality. |
| `release` | `seq, ticket, execution, execution_generation` | Physical guard release, not merely logical revocation. |
| `cancel` | `seq, ticket` | Queued request aborted before grant. |
| `suspend` | `seq, ticket, execution, execution_generation` | A **successful** actor-visible suspension. It must not occur with that execution's live/queued loan. |
| `retire` | `seq, domain, actor_generation` | Logical stop; no new requests, grants, or state accesses. Existing guards may physically finish. |
| `reclaim` | `seq, domain, actor_generation` | Physical arena reclamation; no active or pending loans may remain. |

Tickets are never reused within one trace. A single logical execution cannot make overlapping requests for the same mutation domain. Newer readers may not bypass an earlier pending writer. Writers are exclusive, and mutation requires write authority. Cancellation must remain distinguishable from a successful grant. Every domain in a complete trace must eventually retire and reclaim.

## Run a checker self-test

```sh
node --test tests/verify-state-region-trace-v1.test.mjs
node tools/verify-state-region-trace-v1.mjs path/to/captured-trace.json
```

The first command exercises synthetic positive and adversarial traces at 3/7/15 carriers. It proves **only the checker**, not actual concurrency or an Oreslang frontend. A checker result explicitly says `trace_consistent_not_guest_verified`.

## Evidence needed to promote this to a gate

1. Independent audit that traces are complete and emitted directly from each backend's authentic compiler/runtime admission, access and physical retirement boundaries (no fabricated replay or source-free simulator).
2. Verify exact source Git SHA and artifact identity externally against checked-out, approved source. Keep actual commit SHA, workflow run/job, non-empty executed steps, compiler mode, JUnit/CTest or guest stdout and all source blobs.
3. Compare identical positive/negative Oreslang source byte sequences on all five backends, not merely trace files. Unsupported, crash, runner-admission failure or skipped tests are not PASS.
4. Add adversarial cancellation, duplicate releases, actor incarnation reuse, nested lock ordering, delayed callbacks, migration, teardown and hot reload. Run the runtime at real 3/7/15 active threads under sanitizers/toolchain probes and verify bounded wait and memory lifetime.
5. Never move private source to external CI carrier organizations without independent protected-main review and explicit destination allowlisting. Source-free checker runs are not private-source export authorization.

The validator checks **reported safety invariants only**. It cannot establish trace completeness, data-race freedom for uninstrumented memory, true physical parallelism, liveness, hard-real-time bounds, zero allocation or absence of GC.

Related drafts: Java [#2296](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2296), Java carrier regression [#2322](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2322), LLVM [#1192](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1192), and canonical actor-state modes [#187](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/187).
