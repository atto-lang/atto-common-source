# Oreslang — 15-thread execution matrix (2026-10-15)

This tracks the **15 conversations in the supplied ChatGPT sidebar export**. Their
titles/URLs are inventory anchors, not proof that each full conversation was
re-reviewed. PRs are live GitHub references at the time of this audit, not
claims of completion. The [50-item recovery register](UNFINISHED_WORK_RECOVERY_2026-10-15.md)
remains separate; this matrix avoids duplicating its issue inventory.

| Thread | Current engineering anchor | Next executable gate |
| --- | --- | --- |
| [List Recovered Tasks](https://chatgpt.com/c/6ad1a59f-4738-83e9-b9ba-cf454f5b629f) | [oreslang-common-source/pull/43](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/43) | Validate 50 existing issue references against live GitHub state; close or revise stale tasks. |
| [Audit Sendable Serializable](https://chatgpt.com/c/6ad18d16-a688-83e8-af73-781de0a8f4f7) | [oreslang-source.java/pull/1060](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1060) | Execute scalar mailbox admission, ownership rollback, codec and CONTROL rejection tests. |
| [Recover Orphaned Tasks](https://chatgpt.com/c/6ad19040-e1a4-83e9-a764-669ba31fe561) | [oreslang-common-source/pull/43](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/43) | Deduplicate orphan work and attach owner, blocking test and exact PR head. |
| [Audit Sendable Serializable Traits](https://chatgpt.com/c/6ad18cec-b058-83e9-a67c-4d984023a524) | [oreslang-source.java/pull/1026](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1026) | Run actual actor/network boundary tests with source-level Sendable versus format-specific Serializable. |
| [Implement ORES_PATHS Imports](https://chatgpt.com/c/6ad16b34-40bc-83ea-a456-d3d88ad00ed7) | [oreslang-source.java/pull/1050](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1050) | Verify safe canonical path resolution and alias behavior; retain fail-closed other backend admission. |
| [Harden Precision Math](https://chatgpt.com/c/6ad13f8f-9f00-83e9-9dc9-96514d127395) | [oreslang-source.java/pull/1033](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1033) | Execute i64, IEEE-754, exact decimal and matrix vectors across supported architectures. |
| [Audit DOP Hardening](https://chatgpt.com/c/6ad19111-a4ac-83e8-affa-cc98d2b1a83d) | [oreslang-source.java/pull/1066](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1066) | Verify dependency-level order, ownership alias protection, and CPU/GPU refusal on unproven paths. |
| [Audit Permission Boundary](https://chatgpt.com/c/6ad14df0-a314-83e9-bc91-b195769f8ed2) | [oreslang-source.java/pull/1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034) | Exercise default deny, wildcard network denial, nested capability and revocation cases. |
| [GitHub Failure Audit](https://chatgpt.com/c/6ad14e03-0824-83ea-96aa-1dc2febc2d4d) | [oreslang-source.java/pull/1014](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1014) | Obtain a permitted runner with exact-tree provenance and job-step evidence without exporting private source to an unapproved destination. |
| [Design ChildProcManager Actors](https://chatgpt.com/c/6ad15f70-4e88-83ea-9d4e-b8dc6ecc7a2a) | [oreslang-source.java/pull/1047](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1047) | Run real subprocess lifecycle tests, permission boundaries, process teardown and stdio cancellation; check stacked PR #1054. |
| [Repository architecture audit](https://chatgpt.com/c/6ad1951c-74c0-83e9-8598-b601bc0bded8) | [oreslang-common-source/pull/43](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/43) | Find ten organization-level .github repos and propose schema with category, trust_domain, source_authority, release_unit, deployment_targets, database_scope and lifecycle; never infer values. |
| [Audit Cortex M Hardening](https://chatgpt.com/c/6ad19ce4-8474-83e9-b189-4486f49de802) | [oreslang-platform.embedded/pull/15](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded/pull/15) | Run linker orphan-log unit suite and actual Cortex-M QEMU/ELF layout validations; block on zero-step CI. |
| [Verification progress update](https://chatgpt.com/c/6ad0f2a7-7f10-83ea-9669-08f0cc942042) | [oreslang-platform-conformance/pull/35](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/35) | Require five real compiler command proofs, SHA-bound inputs, no skipped compiler fixtures, and positive execution. |
| [Real Time Guarantees](https://chatgpt.com/c/6ad18bda-4b28-83e9-ab92-90483a9aa011) | [oreslang-source.llvm/pull/444](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/444) | Verify advisory soft contract; hard real-time remains rejected until WCET/schedulability/hardware proofs exist. |
| [Actors In Game Development](https://chatgpt.com/c/6acab678-eaa0-83e8-9d5f-d82d45f043bb) | [oreslang-source.java/pull/1059](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1059) | Execute actor routing/ownership and zero-GC/arena pressure tests; avoid claiming latency parity without a workload. |

## Evidence observed during this pass

- Conformance PR #35: reproduced a **false VERIFIED** result for an invalid/null
  subprocess exit status, then committed a fail-closed check and regression
  tests. Local focused test run: **6/6 pass**, including three persistent
  regression tests. This is harness validation, **not** compiler parity.
- DOP Java PR #1066: compiled host-side `DopRegionSchedule` in an isolated
  JDK 21 workspace and passed **400,000 seeded cell-oracle checks** plus
  **2,000 randomized 12-task dependency-graph trials**. Added JUnit tests;
  Maven/Actions execution remains unverified. This is not native/GPU parity.
- Embedded Cortex-M PR #15: reproduced the linker orphan-log validator and its
  test source in an isolated local Python workspace; **12/12 passed**.
  This is not Zephyr, QEMU, final ELF layout or hardware proof.
- Conformance PR #35: hardened negative-fixture matching to require a
  case-sensitive literal identifier on the same explicit unresolved-name error
  line. New regression coverage rejects unrelated errors, source echoes,
  warning-only messages, substring matches and regex-like tokens.
  Isolated Node 22 workspace assembled from the reviewed harness, fixture and test sources: **23/23 tests passed** (15 original harness tests, five new diagnostic-integrity tests and three exit-status tests). An older positive mock was updated to emit an explicit unresolved-name diagnostic. This is not the unavailable hosted CI run or real compiler parity.
  The hosted job remains blocked, and this is **harness** evidence only.
- Java import PR #1050: preserved literal whitespace in `ORES_PATHS` entries,
  hardened `forImportedPackage` against malformed `pkg:` inputs, and added
  three JUnit regressions (including Windows-style separator normalization).
  An isolated JDK 21 path parser smoke passed; **full JDK25/Maven execution is
  not yet verified**.
- The five `contracts/v1/serde_boundary_v1.json` files in Java, LLVM,
  .NET, Wasm and Forge PR branches are exactly equal as parsed JSON; their
  `scripts/verify_serde_contract.py` content is also identical. This is
  **static contract parity, not executed transport parity**.
- Selected exact-head GitHub Actions jobs for Java, LLVM, common-source and
  conformance all failed with **zero recorded steps**. PR #35's latest job
  after the harness fix also failed with zero steps. A zero-step job cannot be
  described as a compilation or test failure.
- No cross-organization mirror was created here. Before any private-source
  transport, require authorized destination and immutable source/destination
  identity checks, least-privilege write scope and provenance verification.
- No compiler/backend production PR is declared merge-ready based on static
  contracts, local harness tests, or a zero-step GitHub Actions run.

## October 16 runner and conformance continuation

- Source-free hosted-runner capacity probes were created in three confirmed
  **private** repositories: [Akrion #27](https://github.com/akrion-sim/akrion-sim-e2e/pull/27),
  [Scintilla #16](https://github.com/scintilla-run/scintilla-run-infra/pull/16),
  and [AthletO #37](https://github.com/athlet-o/athleto-e2e/pull/37).
  Their sampled current-head Actions jobs all completed as failures with
  **no recorded executed steps**; these were runner probes, not compiler builds.
  Repo visibility/permissions do not prove spending allowance, runner
  eligibility or cross-org source-export authorization.
- **No private Oreslang source tree/blob was copied** in any of those probes.
  The previously documented public-carrier leak remains a P0 incident
  requiring administrator containment before source mirrors resume.
- Conformance PR #35 now rejects unconfigured suites with `ok: false`
  even in discovery mode. Negative-fixture evidence must identify the
  **case-sensitive literal symbol as the subject** of the unresolved-name
  diagnostic; its appearance only in a filename, source echo, or error
  concerning another identifier does not count.
- Added tests for unconfigured status (all five backends), diagnostic
  subjects and a deterministic **10,000-case** filename/context spoof
  corpus. An isolated Node 22 matcher smoke executed 18 explicit
  positive/negative cases and 10,000 spoof rejections plus 10,000
  positive controls successfully. The exact source-branch CI still
  reports zero-step failures; compiler parity remains **unverified**.
- Actions billing balances, policy violations and runner quota allocation
  are **not visible through the connected GitHub operations**; the
  zero-step symptoms alone do not identify the precise root cause.

## Unified acceptance policy

1. Bind each candidate PR to its exact source commit SHA and dependency base.
2. Run executable positive/negative cases at that SHA (Java/Graal, LLVM,
   .NET, Wasm, Forge) and retain compiler/binary hashes and logs.
3. Differentiate **unsupported (correct fail-closed)** from **implemented
   (executed behavior)**; do not equate contract-file equality with runtime
   equivalence.
4. Include sanitizer, ownership/alias, capability, cancellation, overflow and
   regression suites where relevant. Hardware real-time guarantees need
   physical WCET and schedulability proofs beyond ordinary CI.
5. Keep unverified or stacked PRs draft; require clean reviews and trustworthy
   workflow execution before merge.


## Cross-organization CI carrier audit — October 16, 2026

- The Actions API returned failed **zero-step** source-free capacity probes in
  [akrion-sim/akrion-sim-e2e run 38927627366](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38927627366),
  [athlet-o/athleto-e2e run 38928471838](https://github.com/athlet-o/athleto-e2e/actions/runs/38928471838),
  and [scintilla-run/scintilla-run-infra run 38927864632](https://github.com/scintilla-run/scintilla-run-infra/actions/runs/38927864632).
  A separate canonical-cloud workflow also failed on Windows/macOS/Linux
  with no recorded steps. These observations do **not** establish that each
  organization's Actions minutes are exhausted, nor do they prove quota
  availability; billing/policy/runner assignment require administrator checks.
- [Conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  requires protected numeric source/destination repository IDs, rejects
  identity swaps before source reads/writes, and verifies the exact nested
  source Git tree SHA before publishing a CI branch. The updated privacy and
  publisher functions passed **32/32** isolated mocked GitHub API tests.
  GitHub Actions for this draft also failed with zero recorded steps.
- No cross-organization source copy was performed in this audit. The
  [public-mirror incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
  and [private CI protected-policy issue #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962)
  remain blockers; repo privacy alone does not constitute transfer approval.
- A read-only status and remediation update was posted to
  [CI issue #589](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/589).
