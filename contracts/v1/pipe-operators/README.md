# Oreslang pipe operators: integration and typed-port v2 draft

**Status:** candidate compiler contract, NOT an executable/merged cross-backend parity claim.

## Two orthogonal operators

- `left |> f(extra)` is an **eager value call** that evaluates `left` once
  and inserts it at positional argument zero: `f(left, extra)`.
  Pipe chains associate left-to-right; the existing limit is 128 stages.
  `|>` is neither an implicit `await` nor an actor router. Normal
  ownership, error and effect rules of function calls apply.
- `spawn A() pipe spawn B() pipe spawn C()` is an **actor graph**
  construction, not a function call/rewrite. The Java v1 candidate
  accepts 2–16 distinct live SHARED actors with exact identical
  `ActorMail<T>` domains; the result is a local, non-sendable
  `ActorStream<T>`, admitting exactly one flow. `ActorUtils.pipe(...)`
  is equivalent. Existing frame metadata and supervisor CONTROL are
  separate from guest data.
- `|`, `||`, `|x| -> ...`, `|>`, and contextual `pipe` must all
  tokenize without collision. Neither operator silently desugars to
  the other. Mixed programs must preserve the evaluator's left-to-right
  order and contain no implicit actor spawn from `|>`.

## v2 typed-port *proposal* (not existing source syntax)

No v2 source form is enabled by this contract. Candidate forward handle
type: `ActorStream<Ingress, Egress>` where `Ingress` is the owned value
accepted by root admission and `Egress` is the typed terminal forward
output. Bidirectional actor transforms have *four distinct ports*:
`ForwardIn`, `ForwardOut`, `BackwardIn`, `BackwardOut`. A possible
internal descriptor is:

```text
PipeStage<ForwardIn, ForwardOut, BackwardIn, BackwardOut>
```

For neighboring stages A then B, require exact nominal wire compatibility
of `A.ForwardOut == B.ForwardIn` and
`B.BackwardOut == A.BackwardIn` after explicit approved type
substitution. Generic `any` cannot substitute for a missing proof.
Replies/correlations are never supervisor messages. Terminal
`ActorStream<Ingress,Egress>` should not be published until both
directional contracts and all per-edge ownership checks pass.

Do **not** reinterpret existing v1 `ActorStream<T>` as the proposed
two-argument type. Backend parsers must reject unsupported arities or
heterogeneous ports until a versioned ABI, effect/ownership checker,
scheduler transport and executable guest fixture all exist.

## Mandatory construction, lifecycle, admission and backpressure gates

1. Validate graph/stage types, unique ActorIds, same runtime, permitted
   trust domain, generation and quotas **before publication**.
2. Reserve actor slots and bounded edge credits; spawn/link under a
   transaction. A failed stage creation, initialization or binding
   revokes only actors/resources **owned by that construction**, not
   pre-existing actor references. No partially published stream may
   escape, including on failure of stage 3/16.
3. On success publish the sealed route once, then admit DATA. Every
   accepted enqueue must have one success/failure acknowledgement.
   Full queues produce scheduler-owned suspension/Future completion,
   not thread/carrier blocking or silent drop. Cancellation races share
   the admission commit boundary.
4. Keep DATA, priority CONTROL, reverse replies, code-generation fences,
   and ownership domains separate. No borrowed actor memory survives a
   suspend, host transfer or hot-reload fence.
5. Terminal states Completed/Failed/Cancelled are mutually exclusive,
   visible once per incarnation. `get_done` is a physical barrier after
   every stage finalizes, including the failure path: never settle it
   merely because cleanup dispatch was rejected.
6. Multi-flow and graph/DAG fan-out are separate gated features. V1
   successful first `send` consumes the single root-flow credit.
   Do not claim multi-flow, `Future<void>` admission or backpressure
   from the v1 Java proof.

## Cross-operator same-source fixture

`fixtures/mixed-actor-and-value-pipes.ores` contains both operations
inside one executable guest program. It should print `-5` using the
existing authenticated Source -> Transform -> Sink round trip and a
scalar three-function `|>` chain. A compiler must run that **same
source** at the exact candidate commit, not separately pass isolated
Java actor and value pipe branches. `cases.json` remains pending for
all backends until actual guest execution and negative proofs are
available; a green JSON static check never certifies compilation.

## Required negative/stress evidence

- Mixed lexer precedence, lambdas and bitwise; 128/129 `|>` stages,
  16/17 actor stages, invalid stage callable, wrong type.
- Duplicate actor identities, foreign runtime, independently-owned
  borrowed stage, stage-1/2/3 spawn failures, supervisor registration,
  source root reentry, concurrent bind/cancel/hot-upgrade.
- Queue capacity 1 and saturation across all edges; cancellation
  before/after enqueue commit, no lost/doubled packets, terminal
  observer dispatcher rejection, actor restart generation fencing.
- Repeated JVM and Graal Native Image, LLVM native/sanitizer, other
  backends when implemented; pin exact source blobs and actual CI
  steps, include no-step failure as **unverified**.

Relevant candidate work: Java actor #1145, Java value #1073,
actor hardening #1329 and #1333, value hardening #1330;
native actor #345 and native scalar #455.
