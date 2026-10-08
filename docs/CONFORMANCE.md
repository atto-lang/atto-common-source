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

## Next contract groups

1. Move/copy/borrow/aliasing rules, lifetime violations, recursive types and cyclic references.
2. Shared/isolated actor ownership, single-writer guarantees, mailbox behavior and supervision.
3. Suspended borrows, futures/channels, wake epochs, cancellation and automatic preemption.
4. Actual return values, errors and effects from a Graal execution adapter.
5. Observable equivalence across supported AOT/JIT/hybrid profiles.
6. Hot-loading generations, stale handles, state migration and failed-activation cleanup.
7. Resource/effect contracts and backend-specific capability rejection.

For a future shared HIR → MIR pass, run this corpus before and after adoption on each backend. Keep independent implementations until the common path proves its supported semantics, diagnostics and runtime behavior without erasing useful backend-specific tests.
