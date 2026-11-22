# Allocation and ownership parity contract v1

## Scope

This is a **portable behavioral contract**, not a shared implementation.
Each `atto-source.*` compiler owns its own `.atto` implementations of
`core`, `alloc` and `std`. Backend-specific internal arenas, Vec growth
floors, actor schedulers and host runtimes are permitted. Only externally
observable semantics and fail-closed safety checks must agree.

The machine-readable source of truth is
[`contracts/alloc/ownership-parity-v1.json`](../contracts/alloc/ownership-parity-v1.json).
Its exact Git *blob* SHA pins the semantic cases submitted in execution
records. Keep canonical source declarations `define pub` and prefer
namespaces for new libraries. Existing draft library modules may be
migrated independently after compiler parser support is confirmed.

This contract is intentionally **not** a claim that the eleven compilers
currently implement these behaviors. Every `candidate_backend` starts
with `evidence_state: NOT_VERIFIED`. Draft PRs are pointers to
work-in-progress, not demonstrated conformance.

## Portability model

- `hosted`: Java, LLVM, Rust, Cranelift, Forge, WASM, .NET, JS and the
  self-hosted Atto compiler, if and when it supports guest allocation.
  Each applicable case must execute or be reported as unsupported,
  with a separate negative guest admission proof. Unsupported is **not**
  marked parity PASS.
- `restricted`: HDL and realtime profiles, which may reject dynamic
  allocation/actor operations if their target contract cannot implement
  them. An explicit compile rejection is better than generating an
  unsound executable. Restricted targets still need layout, ownership,
  borrow and unsupported-heap admission evidence.
- `PASS` outcomes mean an executed positive behavior passed its
  oracle. `REJECT` means an intentionally invalid program or operation
  was **actually rejected at the required phase**; a crash, skip, planned
  source file or fake success marker is not proof.
- The registry cases are abstract semantic obligations. A backend
  must supply **real backend-owned .atto source fixtures** and an
  immutable case-to-fixture mapping. A source-only test that greps for
  names cannot satisfy a `guest` outcome.

## Safety properties

The cases cover alignment and arithmetic overflow; reservation
admission, quotas, duplicate/stale retirement; use-after-move,
double-drop, mutable/shared loan exclusivity; normal, early-return
and exception cleanup exactly once in LIFO order; failed-destructor
quarantine; forged allocator receipts; Arc last-strong and Weak
upgrade outcomes; and actor quiescence. A backend may implement
a different physical allocator but MUST NOT invent guest-visible
deallocation authority from forgeable integer tickets.

For truly unsupported features, add a **separate** backend-owned
negative fixture and record the unsupported capability explicitly.
Do not record a positive case as PASS merely because a host simulation,
mock or policy ledger ran. Native AOT, ASan/UBSan, hard-real-time and
actor cancellation each require additional execution receipts.

## Provenance and CI

1. Record the exact source HEAD commit and exact source Git-tree SHA.
2. If source Actions cannot start, run a **source-free** admission canary
   in a writable **private** alternative organization, and require
   real successful job steps before copying private source.
3. Mirror the complete required Git tree (including file modes and
   submodules where relevant) via GitHub connector-created tree objects.
   The destination's `GITHUB_TOKEN` checks out ONLY the local mirror
   and never needs cross-organization source-repo access. Do not embed
   credentials, GitHub tokens or private source in public carriers.
4. Prove source↔mirror path/mode/blob parity with the existing
   `scripts/exact_source_gate.py`, and assert triggering HEAD.
   A **partial source slice** can prove only that slice's integrity,
   not complete guest compiler conformance.
5. Execute the actual backend compiler and guest fixtures. Collect
   real run, attempt, job, runner, step and case output records.
   Failed/queued/zero-step jobs and skipped fixtures are NOT_EXECUTED.
6. Run `scripts/verify-alloc-parity-v1.mjs --evidence <file>` to
   check record consistency, or append `--require-all` for the
   eleven-backend release gate. This script is an **offline format and
   consistency validator**, NOT a GitHub attestation. Fetch and verify
   GitHub job logs/steps independently before trusting submitted JSON.
7. Require independent code review and backend-specific runtime/AOT
   qualification before advancing draft PRs.

## Run the source-free self-tests

```sh
node scripts/verify-alloc-parity-v1.mjs --validate-contract
node --test tests/alloc-ownership-parity-v1.test.mjs
```

The test suite uses deliberately **synthetic** evidence records to prove
the validator fails closed on stale SHAs, zero steps, missing runners,
skipped cases, mismatched outcomes and missing backends. No synthetic
record may be used as a production parity certificate.

## Baseline at 2026-11-22

Java allocation scopes are being developed on draft PR #1775.
LLVM and other compilers have separate draft allocator/library PRs.
The latest Java private mirror had 13/13 Git *blob* identity matches,
but its Actions job failed with **zero executed steps**. This is not
guest compilation, AOT or cross-backend parity evidence.
