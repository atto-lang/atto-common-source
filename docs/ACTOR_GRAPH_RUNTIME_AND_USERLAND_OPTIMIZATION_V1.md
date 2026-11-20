# Typed actor graphs and userland mathematical optimization — v1 audit and hardening

**Status (2026-10-20):** proposed cross-backend graph admission/transport contract and host-only reference tests. **Not** shipping Oreslang Java/LLVM graph IR, native actor scheduling, a neural-net trainer, an LP solver, or a certified MIP engine. The test suite is a semantic regression guard; native guest execution remains `NOT_EXECUTED`.

## Decision: share runtime primitives, not application algorithms

Keep three distinct layers:

1. **Value/model graph:** the immutable, typed computation DAG (including neural-network operators, VJPs, fusions, losses and parameters). The proposed `define model` syntax builds this blueprint; it is NOT an actor instance.
2. **Actor execution graph:** an admitted deployment/scheduling graph of coarse actor stages with bounded typed edges and message receipts. Multiple tensor operations may fuse into one actor. Existing `pipe` and `|>` retain their separate actor/value pipeline meanings.
3. **Userland algorithm work graph:** a dynamic, iterative worklist that uses exactly the same actor graph admission, bounded transport, supervision, checkpoints and lease protocol; it does NOT add `mip`, `integer`, `simplex`, `branch` or `neural` language keywords.

The actor runtime should know NOTHING about objective functions, integrality, neural-network losses, branch selection or LP/MIP presolve. Its responsibilities are checked graph admission, typed delivery, scheduling, resource accounting, actor lifecycle and supervisor CONTROL.

## Audit findings and immediate dispositions

| Area | Risk and invariant | Disposition |
| --- | --- | --- |
| Topology | Cyclic data dependency can deadlock training or fake completion | Proposed validator rejects cycles among ordinary data edges; explicit feedback only in bounded `worklist` mode. |
| Graph identity | Version-only or topology-only IDs let stale operator policies and shapes pass | Canonical generation fingerprint includes mode, operation identities, operator attributes, typed ports and edges. A digest is an integrity binding, NOT authentication. |
| Port typing | Mismatched tensor shapes/layouts, duplicate senders to scalar ports | Exact `dtype/shape/layout` match for admitted tensor edges, explicit multi-input ports, no implicit copy/reshape/broadcast. |
| Backpressure | Unbounded mailbox, edge, activation, buffer, token, receipt retention | Bound count AND bytes AND per-edge credits AND future receipt slots before admission. Fail closed without mutating cursors. |
| Replays | Same delivery ID with changed payload, forged ACK or stale incarnation | Message and completion bind run, graph digest, actor incarnation, distinct edge and payload hash; actual actor transport must authenticate issuers/leases separately. |
| Actor guest state | Other persistent actor fields or live mutable state loan on await | At most one `state { ... }`; only sealed lexical read/write loans, exclusive short critical writes; no loan during tensor kernels or messages. |
| Training barrier | Optimizer prepared after only some scheduled microbatches, then more arrive | Declare the *entire expected cohort* before forward admission; require every microbatch's expected gradient fan-in before prepare; reject forward after prepare. |
| Local / distributed publish | Weights and optimizer update twice or shards publish mixed versions | Candidate immutable; local guarded atomic update of both; multi-shard snapshot manifest with durable coordinator fencing and recovery. |
| Solver correctness | Unsafe bound pruning, infeasible incumbent, premature termination | Library-only verified relaxations/candidates; no prune on heuristic or numerically uncertified estimates. Distributed quiescence counts queues, tasks, children and undelivered effects. |

The regression model in `tests/actor-graph-admission-contract.test.mjs` checks topology, typed ports, operator/digest binding, credits, replays and epoch fencing; `tests/model-actor-state-versioning-contract.test.mjs` checks versioned stage barriers and pins. Neither proves compiler enforcement, cryptographic transport identities, CPU/GPU execution, durable ACKs, scheduler fairness or distributed consensus.

## Required graph admission before spawn / reconfigure

- Compile a versioned immutable `GraphPlan` with stable node/edge IDs and type/effect signatures. Include node operation IDs and ALL semantically relevant config/attributes in a canonical fingerprint; reject unrecognized identity-affecting metadata. Freeze or independently copy storage before admission.
- Limit node/edge count, structural depth, tensor rank/dimensions, attribute size, bytes and actor resource capability requests. Never allocate a tensor before validating checked `shape × element_size` and buffer lease extents. Symbolic shapes require solved constraints, not unchecked run-time guesses.
- All ordinary data edges must be acyclic; `fanIn=many` permits multiple explicitly numbered **edges**, not repeated delivery on one edge. Matching ports alone do not prove that every contribution arrived: the runtime keeps a per-context expected-edge ledger.
- Iterative feedback is a **separate worklist execution mode** with explicit bounded credit/delay and a seed/work-source. Reject implicit cycles. An annotation is only admission metadata; an actual scheduler must implement credit return, fair work requeue, cancellation and global termination detection. Do not reinterpret `define model` reverse-mode backprop as a cyclic `worklist`.
- A revised graph is a **new graph generation**. Old actor refs, messages, pinned tensor leases and optimizer receipts cannot enter the new plan without explicit checkpoint-and-migrate authorization. The digest alone is insufficient identity: bind authenticated run, actor incarnation, authorized edge, generation and underlying transport session.

## Scheduling / delivery / state-loan invariants

A received message is not a completed task. A queue-enqueue receipt is not a consumer-processing ACK. A consumer ACK is not a durable sink commit. A local `critical` write is not a distributed transaction. Report these outcomes separately.

Admission must atomically reserve: the per-edge message credit, stage mailbox credit, in-flight byte budget, activation/context reservation if needed, and an eventual dedup-receipt slot. Every terminal path (success, failure, cancel, stop, poison envelope, restart) must release the appropriate credits **exactly once**. Retiring an actor fences all future admissions of its epoch and waits for currently executing state callbacks to quiesce before reclaiming their live borrows; it does not silently declare outstanding external effects rolled back.

- Hold a lexical state loan only long enough to validate/reserve, capture independent immutable storage leases, update per-message ledgers, and commit publication.
- Compute neural kernels, LP relaxations, objective bounds or cuts outside the loan. Transport to other actors happens outside it. An actor processing its own `forward` turn cannot await the `backward` traffic that requires the same serial lane.
- When a step is prepared, **seal** its forward admission set. Commit requires exact expected cohort, complete per-edge gradient fan-in, matching epoch/graph/step/weight/storage identities, no existing commit receipt, and immutable candidate weight **and optimizer state**; keep the next version unreadable until published.
- Existing pin leases can outlive version publication; only reclaim after *all* readers, transport users and device completions release, or after an independently proven cancellation/device abort barrier. Pin/count and byte budgets must not be unbounded.
- Bound replay receipts. When full, backpressure or move to authenticated durable receipt compaction plus a fenced epoch change; never silently evict an old idempotency key while continuing to claim exactly-once.
- A coordinator's declaration of quiescence requires no queued, reserved, actively evaluating, suspended, requeued, orphaned, unacknowledged or uncommitted work, including work crossing a graph edge during the snapshot. Mere local empty queues are insufficient. Establish durable checkpoint/outbox rules separately.

## Neural nets on this substrate

Use `oreslang-tensor` for independent storage/strides/layout and kernels, `oreslang-autograd` for VJPs, reverse DAG fan-in and activation/checkpoint lifetime, and `oreslang-ml` for model/operator/optimizer/trainer APIs. Compilation should reject missing VJP, ambiguous shapes, tensor mutation aliases, unauthorized device hops and differentiation through non-differentiable routing/ACK/worklist control. Training initially uses synchronous one-version fill-and-drain CPU execution; 1F1B, parameter sharding and GPU require independent evidence.

A tensor graph fan-out requires distinct incoming backward contributions per edge, including repeated use of an operand. Accumulate once per edge with a deterministic reduction policy if requested. The optimizer barrier counts planned microbatches, not merely contexts that happened to arrive. Inference readers of sharded weights must observe one globally published manifest, never a mixed shard revision.

## IP / MILP / MIP must remain userland

Create an opt-in library family (proposed names, not assertions that these modules already exist):

- `oreslang-optimization`: algebraic `Variable`, `LinearExpression`, `Constraint`, `Objective`, sparse CSR/CSC matrices, immutable `Problem` and checked domains; pure problem validation, exact integer/binary domain semantics.
- `oreslang-lp`: userland continuous LP algorithms (primal/dual simplex or interior point), independently checked primal/dual residuals, tolerances, bounds and explicit `Optimal | Infeasible | Unbounded | NumericalFailure | Interrupted | Unknown` results. Approximate floating-point bounds are not automatically rigorous certificates.
- `oreslang-mip`: userland branch-and-bound / branch-and-cut, verified incumbent updates, branching heuristics, presolve/cuts and a worklist of immutable node subproblems. It consumes an LP relaxation API and actor graph services without compiler/runtime MIP special cases.
- Optional `oreslang-neuroopt`: ML-learned branching/selection suggestions. These are **heuristics only**; a neural prediction cannot certify primal feasibility, a valid dual bound, infeasibility or optimality.

For minimization, prune a node by incumbent only if its **valid lower bound** cannot improve the best verified feasible solution within a declared objective tolerance. For maximization use a valid upper bound. Do not prune on incomplete LP solves, NaN/Inf, heuristic value, stale bounds, unchecked integrality or mixed epochs. Validate each candidate against all original linear constraints, variable bounds and integrality (within explicit numerical tolerances); do not quietly promote a continuous relaxation solution to a MIP incumbent.

Userland branch-and-bound actors may maintain a local work queue, incumbent and cut versions within their one `state` record. A coordinator owns the global incumbent epoch and node-credit ledger. Children have unique stable IDs and inherit immutable problem bounds/cut generations; duplicate node retries cannot emit duplicate children or overcount termination. Branching can occur concurrently only after atomic work reservation and fenced publication; compare-and-swap incumbents against a verified objective and run/epoch. Untrusted/user-defined branching callbacks are effect-checked; solver workers have bounded memory/time/node quotas and return cancellation/errors via typed supervision.

**Do not confuse MILP with autodiff.** Linear-programming feasibility and integer branching are discrete optimization procedures, not a VJP network. Models may propose warm starts or priorities but cannot replace solver proof rules. No solver dependency should leak into `core`, the parser or the actor scheduler.

### Illustrative API (design target, NOT compiled)

```oreslang
import optimization as opt;
import mip;

const p = opt.problem()
    .binary("x")
    .integer("y", lower: 0, upper: 6)
    .continuous("z", lower: 0.0)
    .minimize(3*x + 2*y + z)
    .subject_to(2*x + y >= 4)
    .build();

const result = await mip.solve(p, limits: mip.limits(
    max_nodes: 10000,
    max_inflight: 64,
    max_bytes: 67108864
));
// The solver API is intentionally userland. No 'define mip' keyword.
```

`x/y/z` builder bindings and arithmetic sugar above are illustrative and not yet supported Oreslang library source.

## Release gates and expected test evidence

**G0:** host-only graph normalization and malformed graph cases, callback/loan/admission/ACK model, full-cohort optimizer barrier regression, typed worklist route. CI outcome must be reported separately from isolated harnesses. NEVER mark guest compilation PASS for these tests.

**G1:** Java and LLVM real source fixtures compile graph declarations or existing `pipe` APIs and reject invalid cycles/ports, mutating snapshots, unauthorized state loans and unsupported compiler syntax at named diagnostics; record exact blob/tree/compiler SHA.

**G2:** source-executed three-stage CPU data DAG and a neural MLP with correct fan-in, training convergence, numeric gradient oracle and bounded memory under cancel/restart; independent Java/Graal AOT and LLVM native evidence.

**G3:** actual iterative worklist actor pipeline with deterministic single-thread MIP reference problems, trusted LP relaxation oracle, feasible incumbent validation, no false pruning, node-credit termination and restart checkpoint replay; initially serial, then bounded parallel.

**G4:** distributed graph reconfiguration, lease auth, transport loss/reordering, optimizer shard atomic publication, durable sink/MIP coordinator and optional GPU/1F1B. Each has independently measured storage/time safety; no proxy tests.

There is an unresolved private-source confidentiality incident (platform-conformance issue #22). **Do not mirror Oreslang source into any other organization** solely to obtain GitHub Actions minutes, even if the target is currently private; independent authorization is required. Prefer source-org CI. Do not merge any host-only fixture as evidence that Oreslang graph, tensor or optimization guest execution is complete.
