# Shared contracts before shared compiler source

Status: immediate collaboration model; future common-source integration plan.

Keep the Java/Graal and LLVM compilers and borrow checkers independent. Share the specification and evidence of behavior first. Backend-specific test suites remain necessary.

## Contract layers

| Layer | Purpose |
| --- | --- |
| Language specification | Syntax, types, ownership, effects, actor/isolation and execution semantics |
| TypeSpec | Versioned interchange models for suites, cases, backend readiness and reports |
| JSON Schema | Validate committed manifests and result structures, including unknown/missing fields |
| Source fixtures | Identical .ores programs with explicit expected admission or observable behavior |
| Backend adapters | Invoke the actual compiler/runtime and normalize outcomes |
| Differential tests | Compare required behavior on the supported intersection of backends |
| Backend-specific tests | Native memory/layout, isolation, JVM interop, JIT/AOT and realtime claims |

TypeSpec and JSON Schema define data shapes, not the language grammar or its semantics. Generated schemas and committed schemas need compatibility checks. Neither replaces compiler, ownership or runtime tests.

## Results and parity

Track feature maturity explicitly:

- Proposed, not implemented.
- Implemented and tested in Java/Graal only.
- Implemented and tested in LLVM only.
- Implemented and tested in both.

Also record readiness for each individual case: required or pending, with a reason for pending support. A feature can be implemented without its full guarantee being certified; retain that distinction.

Reports should identify the suite/schema version, fixture identities, compiler and adapter revisions, execution profile, toolchain, observed result and test evidence. Never turn a timeout, crash, missing compiler or unavailable runner into successful rejection.

Admission tests compare accept/reject outcomes. Diagnostic tests require the intended diagnostic category. Execution tests compare values, exceptions and observable effects. Concurrency tests use deterministic or explicitly constrained traces rather than requiring unrelated internal schedules to match.

## Existing starting points from the supplied discussion

The transcript describes these integration PRs:

| Track | LLVM | Java/Graal |
| --- | --- | --- |
| Initial admission contracts | [#4](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/4) | [#488](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/488) |
| Semantic/diagnostic expansion | [#5](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/5) | [#489](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/489) |

These are historical starting points, not claims about their current heads, merge status or complete backend parity. Recheck the exact revisions before reuse. Focused compiler checks do not establish full Java JUnit, Native Image or native runtime correctness.

Leave the working contract integrations in their backend repositories for now. If this repository later distributes a canonical contract package, pin its version and verify fixture identity in both consumers; avoid an unversioned three-way copy of normative files.

## Memory safety and performance gates

The [ownership-first memory and performance contract](MEMORY_SAFETY_AND_PERFORMANCE.md) sets separate targets for collector-free LLVM native execution and low-garbage Java/Graal execution, alongside identical safe-source behavior and C++/Rust comparison workloads. Semantic admission alone does **not** prove deterministic drops, zero tracing collector reachability, independent heaps or benchmark parity. Each backend must provide real executed release-mode evidence for allocation, ownership, actor/async quiescence, FFI reachability, cleanup and GC/pause tails. Unsupported operations reject without output; a draft native arena implementation is not proof of complete source-language safety.

## Ownership syntax compatibility

The [ownership syntax contract](OWNERSHIP_SYNTAX.md) makes by-value ownership implicit and specifies that `owned` is not a standard keyword. The experimental LLVM `owned int` heap allocator marker must reject in normal compilation, and its test-only opt-in cannot count toward Java/LLVM source parity. Ordinary scalar bindings must not require an allocator or GC just to satisfy ownership semantics.

## Native I/O API naming

Source-visible native synchronous I/O operations **must** end in `_blocking`. Async I/O operations may (but need not) end in `_async`; names alone never replace execution/effect validation. See [the normative naming contract](NATIVE_IO_NAMING.md) for scope, existing Java/Graal migration gaps, LLVM support status, negative tests and versioned rollout.

## Executed guest result comparison

Use `scripts/executed_parity_gate.py` after each backend has compiled and
executed the **same exact Git-blob source fixture**. Inputs are two JSON
records with `backend`, `fixture_blob`, `source_tree`, `compiler_sha`,
positive `run_id`/`job_id`/`runner_id`, `conclusion: success`, positive
`executed_tests`, zero `skipped_tests`/`failed_tests`/`errored_tests`,
and integer `observed` results keyed by case. The gate rejects source
drift, missing execution evidence, divergent case sets or outputs.

For the canonical HTTP counter fixture, the parity gate also validates each
backend against an **independent observable oracle**, rather than merely
comparing two potentially identically-wrong outputs. It requires `main()`
and `counter_response(-1)`, `counter_response(0)`,
`counter_response(1)`, and `counter_response(2)` with results
`43`, `-43`, `0`, `43`, and `86` respectively. Other probes
may be provided, but must use canonical signed i64 argument notation and
have a nonoverflowing exact mathematical result `43 * count`. The gate
fails closed on unknown cases, missing mandatory probes, boolean results
or wrong arithmetic. Both backends must actually execute these cases and
record their observed results on pinned source trees; hardcoded JSON does
not constitute proof of execution.

These JSON records are **not authenticated by the script**. The caller must
first fetch actual Git trees, workflow jobs and logs from GitHub and check
their source identity and runner execution using `exact_source_gate.py`.
Never invent or assume CI observations from passing compilation alone.
The first common executable fixture is
`fixtures/http-guest-counter-handler.ores` (Git blob
`a0b3fc658d1460eab62c85b3cc897143ea77a7ff`); it establishes a
public guest-handler slice, **not** actor, HTTP socket or AOT feature parity.

## Parsing actual backend stdout

The two backend tests emit **different machine-observation shapes**. The
versioned adapter `scripts/http_guest_log_adapter.py` converts *captured raw
guest-test stdout*, not GitHub's rendered page or a manually fabricated list,
into a canonical `{backend, fixture_blob, observed}` JSON fragment:

```sh
python3 scripts/http_guest_log_adapter.py --backend graal --log graal-stdout.txt > graal-observed.json
python3 scripts/http_guest_log_adapter.py --backend llvm --log llvm-stdout.txt > llvm-observed.json
```

It requires exactly one backend-specific execution marker, rejects duplicate
JSON fields, checks the LLVM case count and source identity marker, and
applies the independent HTTP guest arithmetic oracle. The two backend
companion PRs are [Java #608](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/608)
and [LLVM #116](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/116).
They request 131 observations (main plus -1, 0, and 1..128). Their code
and logs still require funded exact-source runtime execution before use as
parity proof.

**This adapter does not authenticate logs or create CI provenance.**
Its output is deliberately only a fragment; it cannot be fed directly to
the full executed-parity gate without an independently verified binding
to each actual source tree, compiler revision, successful runner/job,
executed test count and zero skips/failures. The producer must verify those
facts against GitHub and attach them before invoking
`scripts/executed_parity_gate.py`. Never manufacture a run ID or assume
that the presence of a marker alone proves guest execution.

## Next contract groups

1. Move/copy/borrow/aliasing rules, lifetime violations, recursive types and cyclic references.
2. Shared/isolated actor ownership, single-writer guarantees, mailbox behavior and supervision.
3. Suspended borrows, futures/channels, wake epochs, cancellation and automatic preemption.
4. Actual return values, errors and effects from a Graal execution adapter.
5. Observable equivalence across supported AOT/JIT/hybrid profiles.
6. Hot-loading generations, stale handles, state migration and failed-activation cleanup.
7. Resource/effect contracts and backend-specific capability rejection.

For a future shared HIR → MIR pass, run this corpus before and after adoption on each backend. Keep independent implementations until the common path proves its supported semantics, diagnostics and runtime behavior without erasing useful backend-specific tests.


## Semantic authority and contradiction reconciliation (October 2026)

**Status: review-pending reconciliation of existing contracts, not a new async runtime or an implementation claim.** This section is an index and conflict ledger. The source of truth remains the ratified, versioned language semantics and their focused normative contracts; the Java interpreter is an implementation reference, **not** permission for other backends to inherit its incidental behavior. Proposed PR text is not automatically normative. No unreviewed documentation edit may silently change a compiler ABI or already shipped code.

**Precedence on disagreement:** (1) an explicitly ratified, versioned shared language contract and approved migration; (2) a ratified portable domain contract for its narrower concern; (3) backend-local implementation-status documents and tested behavior as evidence of what exists, *not* language authority. Conflicting drafts remain **OPEN** until language, ownership and backend reviewers sign off on an exact target and migration. A later dated proposal alone never overrides a ratified contract.

| Open reconciliation | Existing authoritative or conflicting materials | Proposed target resolution and required action |
| --- | --- | --- |
| Nested `Option` / `Future` | Java `docs/NESTED_OPTION_FUTURE_EXTRACTION.md` requires one-layer `unwrap` / `await`; Java #1101 proposes recursive canonicalization, while Java #1287 and #2193 require distinct nested types. | **OPEN — favor explicit one-layer extraction and explicit `.flatten()` only.** Do not treat `Option<Option<T>>` as `Option<T>` or `Future<Future<T>>` as `Future<T>` by type equivalence. An explicitly invoked `flatMap` may compose its returned Future by that combinator's declared result type; it is not an implicit conversion of the surrounding expression. Reconcile Java #1101/#1287/#2048 before promotion. |
| Actor reentrancy and `critical` | Java `docs/ACTOR_PREEMPTION.md` leaves pending-await actor reentrancy policy open; `docs/ACTOR_FAMILIES_SEALED_STATE_V1.md` and `docs/HYPHENATED_KEYWORDS_RW_CRITICAL_PARITY.md` specify sealed `handle_state`, state loans and critical permits; portable NIO contract and Java #2193 must agree. | **OPEN — target nonreentrant actor mutable-state transactions across suspension.** Distinguish a persistent **logical turn/admission ticket** from a temporary **raw state loan**: no raw loan can cross suspension; a compiler-verified exclusive logical ticket may persist and reacquire/revalidate a fresh loan on resume, fenced by generation, cancellation and ownership. CONTROL progress cannot mutate guest state out of turn. Same-actor carrier count stays one unless a separately proven parallel policy is enabled. |
| Per-actor physical parallelism | Portable `oreslang-platform-conformance/contracts/v1/NIO_ACTOR_EXECUTION_V1.md` documents `LOW=1`, optional `MEDIUM=2`/`HIGH=3` under proof gates; Java actor-state rules require one physical guest turn by default. | **OPEN — default single-flight.** Optional multithread admission stays fail-closed until isolated frames, disjoint/proven immutable data, state loans, cancellations and hot-reload ownership are demonstrated. Never reinterpret multiple outstanding messages or ActorGroup turns as parallel entry into one actor. |
| Strict I/O versus virtual-thread offload | Shared `docs/NATIVE_IO_NAMING.md` forbids worker-offloaded blocking data-plane operations; Java `docs/SUSPENSION_CONTRACT.md` documents an existing host offload caveat. Common-source #169 is a pending execution-contract proposal. | **OPEN — retain strict source API target**: `*_blocking` logically suspends the continuation using a compliant nonblocking provider, never parks an actor carrier or substitutes per-operation blocking workers. Label the existing Java fallback a nonconforming implementation gap; unsupported backends reject rather than claim parity. |
| Default evaluation versus explicit laziness | Shared `docs/GENERATORS_V1.md` explicitly specifies lazy `gen*` activation; Java `docs/FUTURE_PIPE_TRAP_AWAIT.md` proposes deferred, Future-aware pipeline stages; Java #2193 directs eager evaluation by default. | **OPEN — eager ordinary expressions** with explicit, type-directed exceptions for `gen*`, async Future composition and deliberately declared stream recipes. A `Future` is not permission to defer arbitrary side effects or alter ordinary `|>` evaluation without a ratified operator contract. |
| Optional/named arguments and overloads | Java `docs/NAMED_ARGUMENTS_CONTRACT.md`, #1335 and #2193 propose overlapping callable admission semantics. | **OPEN — compile-time unique call shape**, value-arity-based overload identity, source-order exactly-once argument evaluation. Optional omission, defaults, named labels and generics may not make two declarations applicable to the same legal call; require an explicit compile-time ambiguity error, not runtime dispatch. |
| Effects, borrow and actor-state authority | Shared ownership/effects designs, Java `docs/ACTOR_FAMILIES_SEALED_STATE_V1.md` and `docs/SUSPENSION_CONTRACT.md` distinguish declared `with` effects from acquired `using` capabilities. | **OPEN — compiler-enforced transitive effects and loan safety**. A declared effect never grants state access; `critical` never grants `state.write`; `Send` does not grant `Sync`, serialization or actor admission. Unsafe/FFI, unbounded allocation, blocking and suspension are rejected on qualified hard-RT paths unless separately proved in the relevant effect/profile contract. |

**Cross-language lessons, without copying another language's surface:** retain Rust-like compile-time move/loan and Send/Sync proofs without exposing runtime pin mechanics as everyday syntax; Erlang/OTP-like bounded mailboxes, supervisor isolation and generation-aware restart; F#-like explicit ADTs, exhaustive match and typed functional composition without hidden coercion or implicit laziness; Swift-like static actor isolation while **not** inheriting mutable-state reentrancy across suspension. These strengthen existing actor/Future/effect/ownership contracts; they do not authorize a second runtime or a new keyword.

**Required PR and conformance linkage:** every implementation PR introducing or changing one of these semantics must identify (a) the exact ratified contract path/version and its reviewed change, (b) compiler positives and rejection diagnostics, (c) adversarial runtime traces covering cancellation, race and actor generation, (d) affected Java, LLVM, .NET and WASM backend capabilities and explicit unsupported states, (e) exact source, compiler binary, tree and runner-executed-step evidence. Source-free reference models and schema tests are useful regression guards but cannot promote a guest capability to VERIFIED. Disputed cases remain pending rather than making one compiler's accident normative.

**Related non-duplicate work:** common-source [#169](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/169) specifies the portable OresVM async platform, conformance [#194](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/194) adds a scheduler model, conformance [#192](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/192) covers Task/Future/Observable adapters, and Java [#2193](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2193) records new strict-language decisions. Reconcile with those PRs; do not replace or separately implement their schedulers, state machines or adapters.

