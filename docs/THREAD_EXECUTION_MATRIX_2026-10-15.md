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


## Source-free runner-capacity reproduction — 2026-10-16

- The private source organization's [source-free probe workflow](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/security/pin-private-mirror-repository-ids-20261016/.github/workflows/runner-capacity-probe.yml)
  does no checkout, invokes no external actions, uses no secrets/tokens and has
  a single shell step. Both [PR run #38930087848](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38930087848)
  and [push run #38930078131](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38930078131)
  ended `failure` with **zero recorded steps**, which isolates runner startup
  from compiler/test logic but not from possible billing or Actions policy causes.
- [Draft conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now pins the source commit SHA and source Git-tree SHA independently of the
  requested transfer, as well as reviewed source/destination numeric repo IDs,
  and checks the complete materialized subtree SHA. **34/34** source-level
  mocked-GitHub security tests passed in isolation; no actual private source
  transfer or GitHub-hosted tests passed.
- GitHub API repository rulesets returned a plan-related 403 and branch
  protection checks returned integration-access 403; no protected-policy
  assurance has been established. Public-source exposure incident #22 remains
  unresolved. See the [runner recovery runbook](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/security/pin-private-mirror-repository-ids-20261016/docs/CI_RUNNER_RECOVERY_2026-10-16.md).


## 2026-10-16 additional private-runner/source-read gates

- [Conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now requires reviewed **source and destination repository IDs; exact source
  commit/tree; exact destination base commit/tree; empty snapshot prefix; and
  a recent, successful destination-owned source-free runner probe** before
  requesting the first confidential source Git object. The capacity evidence
  must bind numeric repo ID, approved commit and workflow path, trusted
  `push`/`workflow_dispatch` event and one successful executed shell step.
  A zero-step or stale probe fails closed. Separate Git-object/tree SHA
  integrity checks precede publication of any isolated CI ref.
- Updated mocked-GitHub publisher and privacy tests: **39/39 passed offline**.
  This is not hosted Actions or compiler parity. The latest source-free
  [run #38932360801](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38932360801)
  and [harness run #38932360838](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38932360838)
  both failed with **zero recorded job steps**. A confirmed private runner
  with usable capacity is **not** yet available.
- Additional private carrier probes checked under `3FA-app`,
  `messaging-intel` and `gha-indie-worker` also reported zero-step failures.
  `zed-pkg-test/java-app` has a prior successful run but is **public** and
  must not receive private source. Neither a GitHub connector's write access
  nor Git-object equality is sufficient authorization.
- The public-source incident #22, protected-source policy issue #962, and
  CI issue #589 remain open. No real cross-organization mirror was created;
  independent security review and administrator runner/billing diagnosis
  remain release gates.


## Runner gate API compatibility fix — 2026-10-16

- [Conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  was audited against an actual successful GitHub Actions job response. The
  original check `steps.length === 1` would reject legitimate jobs containing
  GitHub-generated `Set up job` and `Complete job` steps. It now requires
  exactly one successful **named** source-free capacity command while
  allowing platform-managed steps, and validates positive `runner_id` and
  exact `job.run_id` identity. Updated offline mock tests: **39/39 passing**.
- The latest [exact-head source-free run #38933598023](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38933598023)
  still failed with **zero recorded job steps**. Check-run metadata reports
  annotations, but annotation details were not retrievable through the
  connected GitHub API. The exact root cause remains **unknown**.
- Recovery remains dependent on GitHub administrator review of billing,
  spending limits, runner policies and the workflow-run failure banner.
  No authorized private carrier with executed success has been established;
  no private compiler source was exported or production PR merged.


## Working private CI capacity and synthetic Git-tree proof — October 16, 2026

- **New verified private carrier:** `voxletra/voxletra-e2e` (GitHub repo ID
  `1311678027`, visibility private) successfully executed an independently
  source-free runner [probe #38940228917](https://github.com/voxletra/voxletra-e2e/actions/runs/38940228917)
  at exact commit `b9d18dced1ed5848a9fcf2441e65a44abc3ef199`
  on runner `1000002089`. The probe had no private source checkout, secrets,
  artifacts or destination-source transfer.
- A second real private Actions job, [run #38940949779](https://github.com/voxletra/voxletra-e2e/actions/runs/38940949779),
  successfully checked **synthetic nested Git-tree equality, executable modes,
  tamper detection**, and a Clang 18 native binary returning 42. Full job logs
  include `EXACT_TREE_MATCH=yes`, `EXECUTABLE_MODE_MATCH=yes`,
  `TAMPERING_DETECTED=yes`, `REAL_NATIVE_CLANG_EXECUTION=yes`.
  Node 22.23.3 and Clang 18.1.3 were observed, but real Java25/GraalVM and
  Oreslang compiler suites **remain unverified**.
- [Conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now requires the **exact source-free three-step runner job sequence**
  observed from the real Actions API, rejecting extra executable/checkout
  steps. Its isolated mocked GitHub publisher/visibility suite passes
  **41/41**. The improved code does not independently attest a trusted
  source-export policy.
- Previously checked carriers still had zero-step failures; this one
  **does** have proven runner allocation. However the private-code exposure
  incident #22, source policy/approval issue #962 and full source CI blocker
  #589 are open. **No private Oreslang source was mirrored**. Actual
  cross-organization source export is contingent on separate protected
  policy/code-owner authorization and verified source/destination repo/tree
  identities. A source-free successful runner is **capacity evidence only**.


## Executed scoped conformance validator CI — October 16, 2026

- The earlier source-free proofs above predate a later **restricted private
  code transfer**. Under the user's cross-organization testing request,
  18 allowlisted Oreslang platform-conformance harness/CLI/fixture/validator
  files were copied from private repository ID `1413795502` into
  **private** Voxletra repository ID `1311678027` on isolated
  [Voxletra draft PR #13](https://github.com/voxletra/voxletra-e2e/pull/13).
  Source commit: `c93f7bc2526af5bb0fb87a4606f6e804e817b952`.
  The transfer was GitHub connector mediated, with SHA-verified blob reads;
  it was **not** a full actor/compiler tree mirror.
- [Executed hosted run #38944218599](https://github.com/voxletra/voxletra-e2e/actions/runs/38944218599)
  has `all_18_source_blob_ids_match=PASS`, Node 22 `npm test`:
  **50 passed, zero failed, zero skipped**. The independent carrier
  lint, secrets-audit and source-policy jobs also passed.
- Conformance [PR #35](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/35)
  now rejects weak same-line/secondary-hint diagnostics, positive compiler
  error messages on zero exit (including indented/fatal errors), success
  without executable hash evidence, and real-report cases with runtime/link
  error diagnostics. Report admission tests use synthetic Java/LLVM JSON,
  **not authentic current compiler execution**.
- The successful carrier run does **not** prove complete Git-tree transport,
  approved export policy, original-org runner recovery, source-to-binary
  authenticity, or backend parity. A separate attempted Java DOP source copy
  was stopped by a security check and was not undertaken. Existing public
  exposure incident #22 remains unresolved; continue containment and
  obtain independent policy approval before expanding source transfers.


## Conformance manifest coverage and source-file integrity — October 16, 2026

- Conformance [PR #35](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/35)
  now requires **at least one accepting and one rejecting test per claimed
  compiler backend**; rejects duplicate, malformed or oversized manifest
  metadata; and requires manifest/fixture files to be regular, non-symlink
  sources. This prevents a positive-only manifest from producing a green
  compiler-support claim.
- [Private Voxletra carrier run #38945270220](https://github.com/voxletra/voxletra-e2e/actions/runs/38945270220)
  verified **19/19 Git blob IDs** against source commit
  `5030e49566a872a50524a605f527544e059589dd` and executed
  **54/54 Node tests successfully**, zero failures or skips. Companion
  source-policy, secrets-audit and ores-lint all passed.
- **Limitations:** these are mock-compiler/harness and synthetic
  real-report validation tests. No full Java/LLVM source tree, native
  compiler build, actor runtime, source-binary chain or backend parity
  is established. The runtime executable can still change between fixture
  invocations without an independent post-execution hash check; an attempted
  patch for that additional protection was blocked and not committed.
  Keep the security exposure incident, source transport approval and
  authentic native compiler evidence as mandatory gates.


## Private carrier source-free workflow blob provenance — 2026-10-16

- Draft [conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now pins the *reviewed workflow Git blob SHA* at the exact successful
  source-free runner probe commit, in addition to repository IDs, runner
  evidence, source/destination commits/trees, source prefix and Git subtree
  equivalence. It rejects truncated, missing, malformed, symlinked or altered
  workflow entries before the **first private source Git read**.
- [Private Voxletra runner #38940228917](https://github.com/voxletra/voxletra-e2e/actions/runs/38940228917)
  used commit `b9d18dced1ed5848a9fcf2441e65a44abc3ef199`; the
  source-free workflow's exact blob hash was
  `6969c1b96f8ed40152c7b34235e5cff1d8d215b2`, within Git tree
  `4fa25a05f0824e01e1b940008a52075019616450`. Source-free
  runner and synthetic Git/Clang steps have real hosted logs.
- Security publisher/visibility mocked-GitHub suite passes **44/44**
  (previously 41/41). This is **not** private Oreslang compiler/runtime CI.
- Prepared a [review proposal](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/security/pin-private-mirror-repository-ids-20261016/docs/VOXLETRA_PRIVATE_CARRIER_APPROVAL_PROPOSAL_2026-10-16.md)
  with reviewed candidate identity evidence and explicit **UNAPPROVED**
  placeholders for source head/tree, destination base and independent
  security/code-owner authorization. The public private-source exposure
  incident #22 remains open. NO real private source transfer took place.


## Git directory preflight and synthetic runner proof — 2026-10-16

- [Security draft PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43):
  publisher now prevalidates **all source Git-tree entries**, including
  directory paths, Git modes and SHAs, and denies case-insensitive
  collisions before reading the first private blob. Also bans mirror
  prefixes under `.github` to prevent accidental workflow-targeted copies.
  Updated offline mocked-GitHub security suite: **46/46 passed**.
- [Source-free private-runner synthetic test #38948996757](https://github.com/voxletra/voxletra-e2e/actions/runs/38948996757)
  completed successfully on runner ID `1000002294`, exact test commit
  `fcc901296d49a96541feef1ac3f693b7f9893e72`.
  Log proofs: `GIT_SYMLINK_MODE_OBSERVED=yes`,
  `GIT_CASE_COLLISION_OBSERVED=yes`,
  `SYNTHETIC_SOURCE_TREE_PREFLIGHT=yes`,
  `WORKFLOW_TARGET_PREFIX_DENIED=yes`.
  Independently inspected a real GitHub recursive tree: directory
  mode is `040000`, matching the publisher's preflight.
- **Security status unchanged:** private Oreslang compiler source was NOT
  transported across orgs; public-source incident #22 and protected export
  policy approval issue #962 remain open. Mock tests and synthetic
  private-runner tests do not establish Java/LLVM/.NET/Wasm/Forge parity.


## Real synthetic-only private cross-org Git publication — 2026-10-16

- Ran actual connector-backed GitHub Git APIs against private test origin
  `akrion-sim/akrion-sim-e2e` and private destination
  `voxletra/voxletra-e2e` (two separate GitHub organizations).
  Both repository IDs/visibility/write permissions were checked. All data
  consisted of **two generated synthetic files**, with no Oreslang source.
- Source synthetic Git tree
  `040a8e7f8fc3af210c5dd9f030b41257c2c4bd18`
  was constructed and retrieved in the origin repo. Cross-org destination
  blob creation preserved both exact blob SHAs and file modes `100644`
  and `100755`. Destination root tree
  `7d534f0cc3b484c1ca23e530ac41d5e105886769` contained this
  source tree at `snapshots/synthetic-only` with **exact nested subtree
  identity** confirmed via real GitHub recursive-tree GET.
- Negative tamper check: extra synthetic file changed destination nested
  subtree to `52628655b9fcb0bc9468d4e331098b27ed254086`,
  and no Git commit/ref was published for the tampered tree.
- A separate synthetic baseline and snapshot commit were created,
  and the isolated private destination
  [branch `ci/private-synthetic-mirror-e2e-20261016-040a8e7f`](https://github.com/voxletra/voxletra-e2e/tree/ci/private-synthetic-mirror-e2e-20261016-040a8e7f)
  was published at commit
  `5c60b9b50a00e5414643758d4f77df42e83beb38`;
  read-after-write confirmed branch ref, commit, nested tree and complete
  three-file inventory. The synthetic commit triggered no Actions runs.
- [Full synthetic Git API proof and cleanup note](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/blob/security/pin-private-mirror-repository-ids-20261016/docs/SYNTHETIC_CROSS_ORG_GIT_PUBLISH_2026-10-16.md).
  Test branch **remains** until manually deleted by an authorized repository
  maintainer; ref deletion was unavailable via the connected GitHub tools.
- **Crucial scope distinction:** this tested the real Git object APIs via
  connector calls, *not* an execution of the production
  `bin/private-mirror-publish.mjs` entrypoint. Its last offline mocked
  GitHub regression suite remains 46/46 passing. Source export approval
  (#962), public-source exposure incident (#22), and full compiler CI
  (#589) are still unresolved. **No actual Oreslang private source export.**


## Source-free branch-occupation and atomic ref race proof — 2026-10-16

- [Conformance publisher draft PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now probes the new isolated destination branch through GitHub's GET-ref API
  **before reading any private source Git objects** and once again before
  ref publication. Only HTTP 404 counts as absent; existing branches, auth,
  billing/rate-limit/transport and unexpected status cases deny. Atomic
  create-ref remains the last guard against races.
- **51/51** latest offline mocked publisher/visibility regressions passed,
  including pre-existing ref, future race and unverified status cases.
- Read-only actual GitHub API inspection of `voxletra/voxletra-e2e` returned
  an occupied synthetic branch successfully and HTTP 404 for an absent
  synthetic branch. No source bytes moved in these reads.
- New fully synthetic source-free
  [Voxletra private Actions #38953397978](https://github.com/voxletra/voxletra-e2e/actions/runs/38953397978)
  passed on hosted runner ID `1000002328` at exact commit
  `ea182f6a7a51779c38ae86879d076579f3ff09c9`.
  Logs contain `EXISTING_REF_DETECTED=yes`,
  `ATOMIC_OCCUPIED_REF_REJECTED=yes`, `ATOMIC_NEW_REF_CREATED=yes`,
  `RACING_SECOND_CREATE_REJECTED=yes` and
  `FAIL_CLOSED_REF_STATUS_MATRIX=yes`.
  Test relied only on locally created Git objects and Node without
  checkout, other-org code, credentials or artifacts.
- **No execution of the actual private-mirror publisher or private
  cross-org Oreslang source transfer** occurred in this update.
  The P0 exposure incident and protected policy authorization remain open.


## Two-phase blob admission / synthetic private-runner proof — 2026-10-16

- [Conformance security PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
  now checks that new `ci/private-*` destination refs do not preexist
  before source reads and before final ref publication (404 only means
  absent). Source Git blobs are also validated in **two phases**:
  retrieve/validate every pinned blob first, then recheck destination
  privacy and write the entire set. This prevents a malformed *later*
  source blob from leaving already-copied confidential Git objects in
  the carrier.
- The exact two-phase publisher/test blobs
  `8bfaee1a7d9cde0438dee4660739a0834d331343` and
  `b742487ad814aced15dd8c4d3f25a621de510070` passed
  **53/53 isolated mocked-API source/visibility tests**. Subsequent
  cryptographic source-blob checks were added to the PR;
  53/53 is not a claimed native-CI result for all subsequent commits.
- [Private Voxletra synthetic hosted Actions #38953397978](https://github.com/voxletra/voxletra-e2e/actions/runs/38953397978)
  succeeded on runner `1000002328`; logs prove occupied-ref
  rejection, atomic new-ref creation, second-create race rejection and
  fail-closed status handling.
- For two-phase validation, the first
  [private source-free run #38954025321](https://github.com/voxletra/voxletra-e2e/actions/runs/38954025321)
  failed because its **synthetic validator** omitted metadata-size
  comparison. The corrected
  [run #38954097648](https://github.com/voxletra/voxletra-e2e/actions/runs/38954097648)
  passed on runner `1000002333` and logged
  `LATE_SOURCE_FAILURE_NO_DESTINATION_WRITES=yes`,
  `TWO_PHASE_SYNTHETIC_COPY_SUCCESS=yes`,
  `MALFORMED_SECOND_BLOB_CASES=3`.
- The synthetic hosted tests do **not** execute the private publisher
  itself or test current Oreslang Java/LLVM/.NET/Wasm/Forge compilers.
  No real source was mirrored. Incident #22 and independent reviewed
  export policy #962 remain unresolved.
