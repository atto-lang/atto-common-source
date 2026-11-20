# Oreslang core / alloc / stdlib — Proof IR and evidence receipt v1

## Scope

This P0/P1 implementation standardizes a **restricted, pure signed-i64 scalar** proof interchange format and a fail-closed structural receipt checker. It deliberately does **not** change Oreslang language syntax or the existing 24-case core-math contract. It does **not** prove the actual compiler, backend, or complete libraries.

- `contracts/verification/v1/proof-ir.schema.json` defines the initial Proof IR envelope. Source provenance explicitly distinguishes `reviewed-blob`, `checked-ast`, `typed-hir`, and `typed-mir`. Manually reviewed blobs must not claim a checked typed digest.
- `contracts/verification/v1/proof-receipt.schema.json` defines a record for checked obligations, solver identity, full source/head metadata, runner/attempt/job/step claims, and optional **separate** guest-execution evidence.
- `scripts/verify-proof-receipt-v1.mjs` validates exact fields, digests, effects, checked source mode, mandatory UNSAT proofs and SAT negative controls, solver verdicts, bounded record sizes, stale/zero-step jobs, and guest isolation.
- `tests/verify-proof-receipt-v1.test.mjs` supplies intentionally damaged models and receipt metadata. These are harness tests, not Oreslang runtime tests.

Run the structural tests using `node --test tests/verify-proof-receipt-v1.test.mjs`.
To check a candidate pair, use `node scripts/verify-proof-receipt-v1.mjs /path/proof-ir.json /path/receipt.json`.

## Critical trust boundary

A structurally valid receipt is labelled `*_UNATTESTED`. **Never** translate that into `proof passed`, `source verified`, `backend refined`, or `release qualified`. Fake GitHub run IDs, binary hashes, or transcripts could still satisfy a JSON validator. Only an independently authenticated GitHub API/artifact retrieval and replay of the actual solver and compiler can promote a claim.

The current v1 validator additionally requires an evidence job in the same repository and at the exact source commit as the modeled source. This restricts the pilot to same-repo proof jobs. A later authorized cross-repo design must introduce independently authenticated source/guest binding; relaxing this check merely to obtain CI minutes is prohibited.

## Promotion requirements (not implemented by this structural gate)

1. Re-read current source and independently inspect actual checked frontend AST / typed HIR / MIR plus ownership/effect derivation. Pin content identities and independently review source-to-proof translation.
2. Re-run pinned Z3 or CVC5 on actual query bytes. Require UNSAT for the true obligations and SAT counterexamples for source mutants; reject `unknown`, timeout, unsatisfied preconditions, or missing transcripts.
3. Compile and run real Oreslang guests at exact heads, including signed-i64 MIN/MAX, reversed `clamp_int` bounds, and deliberately wrong expected results. Inspect full-valued observations rather than 8-bit process exit code.
4. Store independent read-only source/solver/compiler/runner evidence and validate real CI job steps, attempt, checkout SHA, binary and trace bytes. Source-free test canaries are not runtime parity proofs.
5. Keep `core` freestanding. Formal tools belong to host build/test workflows, not runtime-linked library code. Broader alloc/actor/async I/O proofs require dedicated ownership and temporal logic, not forced casting to QF_BV.

## Existing implementation links

- Java core formal pilot: `oreslang-source.java` PR #1873.
- Java checked-AST SMT: `oreslang-source.java` PR #1885.
- LLVM checked-AST SMT: `oreslang-source.llvm` PR #857.
- Independent semantic corpus: `contracts/library/v1/core-math-i64.json` (24 cases).
- Cross-backend acceptance program: `oreslang-platform-conformance` issue #150.

Unexecuted GitHub Actions workflows and merges that occurred despite no runner steps are **not** evidence that Java or LLVM currently meets this acceptance program.
