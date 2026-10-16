# Recovery audit: 50 unfinished Oreslang tasks (October 6–15, 2026)

**Method:** open GitHub issues updated within October 6–15, 2026, cross-checked against ongoing Oreslang work. These are unfinished candidates, not 50 independently diagnosed defects or evidence of abandonment. Existing tickets are reused rather than cloned.

**Security:** Never export private source to public or unapproved test organizations. Passing tests is not permission to transfer code; use protected-main, security-reviewed allowlists and confirmed private destinations.

**Validation:** Jobs that fail before runner allocation with zero executed steps provide no test evidence. Require exact-head executable tests and independent review before non-draft promotion or merges.

**CLI:** Use `github.com/flags-2-env` for all command-line argument and permission parsing; no parallel bespoke flags parser.


## Security / provenance

- [ ] **Contain public private-source exposure** — [oreslang-platform-conformance#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22). Next: Verify visibility, artifacts, refs and Support purge.
- [ ] **Contain Java code in public CI history** — [oreslang-source.java#832](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/832). Next: Inventory exposed commits and publish containment evidence.
- [ ] **Purge historical public CI mirrors** — [oreslang-source.java#654](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/654). Next: Audit refs, caches and sensitive-data removal.
- [ ] **Audit public mirror policy violation** — [oreslang-source.java#921](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/921). Next: Reconcile exposure and authorization.
- [ ] **Remove residual Map/Symbol snapshots** — [oreslang-source.java#912](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/912). Next: Verify history and artifact retention.
- [ ] **Protect Java main and require CODEOWNERS** — [oreslang-source.java#994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994). Next: Enable independently enforced branch rules.
- [ ] **Require reviews and exact-SHA tests** — [oreslang-source.java#904](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/904). Next: Prove merge gates cannot be bypassed.
- [ ] **Bind private publisher to provenance and repo IDs** — [oreslang-source.java#962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962). Next: Exercise deny-by-default negative cases.
- [ ] **Reconcile unauthorized CI carrier use** — [oreslang-source.java#991](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/991). Next: Record independent security disposition.
- [ ] **Resolve private conformance carrier policy exception** — [oreslang-platform-conformance#28](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/28). Next: Approve reviewed destination or revoke access.

## CI / executable evidence

- [ ] **Restore exact-head Java/LLVM CI** — [oreslang-source.java#589](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/589). Next: Execute full Maven and CMake/CTest privately.
- [ ] **Fix zero-step Java Actions** — [oreslang-source.java#963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963). Next: Restore allocated runners with logs.
- [ ] **Fix zero-step native Actions** — [oreslang-source.llvm#159](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/159). Next: Run full CTest on exact SHA.
- [ ] **Fix zero-step common-source Actions** — [oreslang-common-source#27](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/27). Next: Execute verifier and contracts.
- [ ] **Restore Symbols CI** — [oreslang-source.java#898](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/898). Next: Prove compiler tests executed.
- [ ] **Verify ownership and critical integration** — [oreslang-source.java#763](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/763). Next: Run exact-tree compiler/runtime suites.
- [ ] **Restore match/select source CI** — [oreslang-source.java#845](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/845). Next: Execute current-head semantic suite.
- [ ] **Restore browser/Wasm release gate** — [oreslang-platform-conformance#16](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/16). Next: Run source CI and secure approvals.
- [ ] **Verify merged Wasm main/AOT** — [oreslang-source.wasm#5](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/5). Next: Restore Wasmtime execution.
- [ ] **Fix 39 product-type Maven failures** — [oreslang-source.java#960](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/960). Next: Reproduce and resolve full suite.

## Actors / runtime concurrency

- [ ] **Prevent pooled HTTP context-close race** — [oreslang-source.java#973](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/973). Next: Prove carrier shutdown quiescence.
- [ ] **Make cancellation unwind once** — [oreslang-source.java#883](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/883). Next: Prove defer/finally and iterator cleanup.
- [ ] **Remove lifecycle hooks from lifecycleLock** — [oreslang-source.java#717](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/717). Next: Test reentrancy and deadlock races.
- [ ] **Lower supervisor actor semantics** — [oreslang-source.java#641](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/641). Next: Verify generations, exceptions and proxy.
- [ ] **Fence RW ticket to owning guest turn** — [oreslang-source.java#800](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/800). Next: Reject cross-turn release.
- [ ] **Reserve CONTROL and bound USER mailboxes** — [oreslang-source.java#828](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/828). Next: Prove liveness and backpressure.
- [ ] **Bound malicious infinite-loop preemption** — [oreslang-source.java#795](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/795). Next: Prove cooperation watchdog behavior.
- [ ] **Move SharedMutex deadline processing off blocking callbacks** — [oreslang-source.java#783](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/783). Next: Test deadlines and cancellation.
- [ ] **Enforce GuardFuture actor authority** — [oreslang-source.java#769](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/769). Next: Reject stale/late guard callbacks.
- [ ] **Self-host actor runtime in Oreslang** — [oreslang-source.java#918](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/918). Next: Gate on source-language stability.

## Language / types / native

- [ ] **Return values from typed select** — [oreslang-source.java#407](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/407). Next: Verify Future-after-arm and nb select.
- [ ] **Complete tagged sums and recursive ADTs** — [oreslang-source.java#813](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/813). Next: Execute exhaustive patterns.
- [ ] **Lower native tagged payload patterns** — [oreslang-source.llvm#316](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/316). Next: Prove closed match exhaustiveness.
- [ ] **Lower Array<int> linked queue** — [oreslang-source.llvm#265](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/265). Next: Build and run guest source tests.
- [ ] **Implement typed floating-point division** — [oreslang-source.llvm#302](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/302). Next: Verify Java/native numeric parity.
- [ ] **Fix int / int type/runtime disagreement** — [oreslang-source.java#798](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/798). Next: Prove checked division result.
- [ ] **Harden switch numeric equality** — [oreslang-source.java#895](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/895). Next: Test large ints and float collisions.
- [ ] **Fix mutable structural variance** — [oreslang-source.java#853](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/853). Next: Prove assignment soundness.
- [ ] **Complete nominal enum overloads** — [oreslang-source.java#843](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/843). Next: Reject ambiguous method dispatch.
- [ ] **Support Result<void,E> and must-use** — [oreslang-source.java#874](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/874). Next: Prove backend zero-payload parity.

## CLI / contracts / orphan work

- [ ] **Use flags-2-env as sole CLI parser** — [oreslang-cli#8](https://github.com/ores-truffle-oreslang/oreslang-cli/issues/8). Next: Retire Clap and recheck policy authority.
- [ ] **Enforce Deno permissions on executable** — [oreslang-platform-conformance#32](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/32). Next: Run compiler/runtime parity cases.
- [ ] **Implement callable throws/raises/panics** — [oreslang-source.java#1010](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1010). Next: Propagate typed effects.
- [ ] **Lint exceptional-effect declarations** — [oreslang-format#62](https://github.com/ores-truffle-oreslang/oreslang-format/issues/62). Next: Build callable graph and fixes.
- [ ] **Format sealed/non-sealed/final permits** — [oreslang-format#60](https://github.com/ores-truffle-oreslang/oreslang-format/issues/60). Next: Prove formatter idempotence.
- [ ] **Admit sealed hierarchy natively** — [oreslang-source.llvm#411](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/411). Next: Start fail-closed and add parity.
- [ ] **Admit source sealed hierarchies** — [oreslang-source.java#1008](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1008). Next: Verify permits/exhaustiveness rules.
- [ ] **Revalidate formerly orphaned defer fixtures** — [oreslang-source.java#831](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/831). Next: Manifest fixed; prove real execution.
- [ ] **Lower constructor record projections** — [oreslang-source.java#889](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/889). Next: Test positive and negative matching.
- [ ] **Avoid import-time constant execution** — [oreslang-common-source#23](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/23). Next: Define and enforce metadata-only imports.

## Work completed during triage

- Audited Java `contracts/v1/semantics/cases.json` on `main`: blob `d0b0a0337bcdef78e56725a151cc7e13b2fb9687` registers all three formerly orphaned native defer/finally fixtures with `graal=required` and `llvm=pending`. Posted reconciliation evidence on Java #831. Real compiler execution has not been proved.
- Examined Java #1027 and #1030 draft PRs: zero-step CI prevents verified runtime/compiler validation.
- Flagged private-source disclosure / unapproved carrier policy as P0, ahead of additional cross-org mirroring.

## Next execution sequence

1. Contain and review any source exposure; restore approved runner capacity.
2. Execute existing source tests and record per-head proofs, not checkmark-only CI.
3. Fix correctness/safety defects, integrate parent PR stacks, and obtain independent reviews.
4. Close tasks only with compiler/runtime/test evidence, preserving explicit pending backend gaps.


## Session execution log — 2026-10-15

- **Formatter hardening:** [oreslang-format#66](https://github.com/ores-truffle-oreslang/oreslang-format/pull/66) now caps fixture input at 8 MiB, adds two rejection tests and documents the bound. Latest commit: 08fe720cfe93f859bbea1d5bbe5a2a072e7839e6. No executed test confirmation.
- **Static manifest verification:** Audit comments on Java [#831](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/831) and [#825](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/825) confirm 15/15 manifest-to-fixture matches. Full compiler conformance remains unexecuted.
- **Exact-head CI evidence:** Formatter PR #66 [run 38809570106](https://github.com/ores-truffle-oreslang/oreslang-format/actions/runs/38809570106) shows failed test and msrv jobs with zero executed steps. This recovery PR [run 38809465483](https://github.com/ores-truffle-oreslang/oreslang-common-source/actions/runs/38809465483) also shows zero test steps. These do not prove program/test failure.


## Fresh issue-state verification — 2026-10-15

Authenticated reads of **all 50 canonical GitHub issue URLs above** returned
**50 open, 0 closed, 0 fetch errors**. Every one of the 50 had a last-updated
timestamp from **2026-10-13 through 2026-10-15**. These are active unresolved
tasks, not 50 independently proven defects. No checkboxes were closed.

Breakdown (all open): provenance/security **10/10**; CI/evidence **10/10**;
actor/runtime **10/10**; language/native **10/10**; CLI/contracts **10/10**.

Offline integrity gate: run
- python3 scripts/validate_recovery_register.py
- python3 -m unittest discover -s tests -p test_validate_recovery_register.py

The gate rejects duplicate IDs, missing/malformed links, checked-off rows,
missing concrete next actions, incorrect section order/count and an
out-of-window heading. It **does not** query GitHub, run guest code, or establish
executable CI success. Recheck authenticated issue states before closing tasks.

### Evidence-first continuation order

1. **P0 private-source containment**: [conformance #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22),
   [Java #832](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/832),
   [Java #654](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/654),
   [Java #994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994).
   Do not mirror private code into public or unapproved repositories; identical
   Git trees are not a substitute for reviewed publication authorization.
2. **P0 executable CI**: [Java #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963),
   [LLVM #159](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/159),
   [common-source #27](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/27).
   Record runner identity, executed test steps, actual output and exact source SHA.
3. **P1 actor/runtime**: cancellation/unwind
   [Java #883](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/883),
   quiescent HTTP shutdown [#973](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/973),
   CONTROL mailbox isolation [#828](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/828).
   Preserve stacked dependencies and require executable Java/LLVM proofs.
4. **P1 language/ABI**: [Java #798](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/798) /
   [LLVM #302](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/302)
   division, overload binding
   [Java #843](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/843),
   native tagged patterns
   [LLVM #316](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/316).
5. **P1 CLI/release**: flags-2-env as the sole flags/permissions parser
   [oreslang-cli #8](https://github.com/ores-truffle-oreslang/oreslang-cli/issues/8),
   deny-by-default executable permissions
   [conformance #32](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/32).

### Nearby active draft implementations (not closure evidence)

- [Java #1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034):
  privileged host I/O default-deny; executable and flags-2-env integration pending.
- [Java #1033](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1033):
  IEEE-754 fixes; high-precision types, matrix math and native parity pending.
- [Java #1035](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1035):
  sealed actor-state retirement authority; stacked and unverified.
- [LLVM #420](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/420):
  overload signature validation; native guest execution still pending.
- [serialization #13](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/13):
  network/actor codec declarations, not runtime integration.
- [formatter #68](https://github.com/ores-truffle-oreslang/oreslang-format/pull/68):
  atomic writes; ACL/xattr confinement and Rust CI pending.
- [formatter #66](https://github.com/ores-truffle-oreslang/oreslang-format/pull/66):
  bounded parity harness; compiled source parity still pending.

**Session scope:** recovered, deduplicated, confirmed and instrumented 50
open issues. No claims that any of the 50 were fixed, merged, security-approved
or successfully verified by executable CI.


### Offline execution receipt (2026-10-15)

- Committed checker Git blob SHA: 3c44ae31618f8486274c4bca1b366f3efa945d73.
  Committed regression-suite blob SHA: f5b9e8b77edeb3ab6995c0d5636e69a49781d554.
- Files reconstructed and verified against both exact Git blob hashes were
  executed locally: **10/10 Python unit tests passed**, covering duplicate
  and case-aliased GitHub IDs, missing/checked tasks, malformed links, empty
  documents, missing next actions and invalid headings.
- An independent read of the committed register yielded five sections of
  10 open tasks each, **50 unique well-formed issue links**, zero errors.
- This is offline inventory validation ONLY. Java/LLVM source compilation,
  native-image, CTest, and GitHub Actions runner execution remain unverified.


### Follow-up recovery work

- **Java structural-record soundness:** [draft Java #1039](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1039) implements writable-record invariance and readonly structural views, adding 9 test methods / 64 type-pair matrix assertions, plus safe readonly structural pattern admission (head `b70cac9f6fbbb3b3ac1a45b9d91af8495caeacb8`). Fast-CI run [38811276315](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38811276315) failed with no executed steps. Reconcile with Java #853 and other structural type usages; do not mark tested.
- **Numeric stale-work audit:** Java `main` already contains `int/int -> FLOAT` checker rule and `DivisionTypeSoundnessTest` (4 cases, including actual guest output). Filed source evidence on #798, leaving native parity and executed tests open.
- **P0 confidentiality still active:** GitHub metadata still identifies `zed-pkg-test/java-app` as PUBLIC (repository ID 1323575966); posted verified visibility to platform-conformance #22. Existing GitHub connection cannot change repository visibility. No cross-organization private-source transfer performed.
- **CI:** Added new zero-step runner evidence and missing job logs to Java #963. No current-head Java tests were actually run.


### Connected code hardening on a recovered task

- [conformance #32](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/32):
  [Java PR #1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034)
  now rejects empty comma-separated allow/deny scopes, including trailing
  commas, and stages normalized values before committing a permission grant or
  denial. Added CLI usage-error regressions and builder transactional tests
  for malformed paths. Exact Java PR head: f70953cd72f4debf9e39740ae9bf1125777145ce.
  **No Java/JDK25/Graal/native test pass is claimed**; the recovered issue
  remains open pending full executable evidence and flags-2-env integration.


### Next-phase implementation receipt — 2026-10-15

- The permissions hardening branch [Java #1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034)
  now combines network endpoint / wildcard port-denial checks from [Java #1027](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1027)
  with default-deny launcher behavior and transactionally staged permission CSV normalization.
  A dedicated 14-case network regression suite was copied and extended; existing launcher
  JUnit tests remain. Current exact head: 92f1b44b30531f3a892da42f74e3884a01949cdd.
- **CI is still non-executable:** exact-head [fast-ci 38812966393](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38812966393)
  and [ci 38812966327](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38812966327)
  report zero executed steps for the checked jobs. This provides no source compilation
  or JUnit/native-image evidence. PR #1034 remains draft.
- [Java #994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994):
  protected-main check is false; repository ruleset API returned GitHub 403 indicating
  the private-repository plan does not permit the requested ruleset feature.
  Source owners must enable an eligible private branch protection/review mechanism.
  **Do not make the source repository public to work around billing/protection.**
- [Java #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963)
  contains the exact-head zero-step runner evidence. No unapproved source transfer.
- Next merge gate: independently confirm source confidentiality and reviewer controls,
  execute targeted and full Java/Graal tests (and LLVM parity where required), then
  carefully reconcile PRs #938/#1027/#1034. No work-item closure from these static commits.


### Cross-repository permission gate update — 2026-10-15

- [oreslang-cli PR #9](https://github.com/ores-truffle-oreslang/oreslang-cli/pull/9)
  removes 19 ambient `ORESLANG_ALLOW_*`/`DENY_*` and other permission
  environment bindings from Clap. Adds Rust parser-metadata regression
  verifying 57 Check/Run/Lsp bindings have no implicit environment grants.
  Branch head at creation: 29639ad5b8b009ff88545841d12e5286ea108465.
  This is interim host-I/O containment; the required flags-2-env sole-parser
  migration remains [oreslang-cli #8](https://github.com/ores-truffle-oreslang/oreslang-cli/issues/8).
- Java [#1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034)
  reconciled new network policy guards from #1027: invalid control bytes /
  surrogate resource spellings and duplicated serialized authority entries,
  while retaining stage-before-commit CSV rules. Latest integrated head:
  8feb0ffc030797c0e12c7621784b634156e4b3f3 with 18 network-focused
  JUnit methods and linked launcher tests. The exact-head Java GitHub CI
  again failed with **zero executed steps** (fast-ci 38813465513,
  main CI 38813465458): no Java tests or native-image proof are claimed.
- Scope remains open: no permission issue marked done, no cross-org private
  source copied, no compiler/backend parity test proved, no unsafe main merge.


### Verified Rust CLI execution — 2026-10-15

- [oreslang-cli #9](https://github.com/ores-truffle-oreslang/oreslang-cli/pull/9)
  is **ready for independent review** (not merged): ambient
  `ORESLANG_ALLOW_*` permission bindings removed from direct Clap CLI.
  Exact tested commit: `29639ad5b8b009ff88545841d12e5286ea108465`.
- [Executed GitHub Actions run 38813792970](https://github.com/ores-truffle-oreslang/oreslang-cli/actions/runs/38813792970)
  completed **success**: Rust formatting passed; `cargo test --workspace --locked`
  produced **22 passing tests**, including the 57-option metadata gate;
  public CLI smoke tests passed. The job had an allocated runner and real
  executed steps.
- This actual Rust CLI pass is **not** Java/Graal/LLVM proof. Exact-head
  Java [#1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034)
  remains draft with zero-step source CI, and source-main protection remains
  unresolved. Keep the original 50 task issue states unchanged until each
  applicable backend and policy is validated.


### Exact-head permission and CI validation — 2026-10-15

- [Java #1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034):
  added fail-closed validation for serialized scoped `--ores-permission-*`
  rules missing the `--ores-permission-explicit=true` protocol marker.
  Preserved explicitly documented legacy no-policy-args embedding support;
  marker is a format invariant, not cryptographic authorization.
  Regression `serializedScopedRulesRequireExplicitPolicyMarker`
  extends the network/runtime JUnit suite to 19 methods. Commit
  `fe23e414baed72628304285dd76bd94a62374e1d` had 12/12
  static source-inspection invariants verified. These are **not executed
  JUnit tests**. Java source-org [fast-ci 38822505679](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38822505679)
  and [ci 38822505677](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38822505677)
  again failed with **zero test steps**. PR remains draft and requires
  actual JDK25/GraalVM execution and independent review.
- [oreslang-cli PR #9](https://github.com/ores-truffle-oreslang/oreslang-cli/pull/9):
  added two actual CLI process regressions testing forged inherited permission
  variables and explicit-argv-only forwarding with an unprivileged fake backend.
  [Exact-head Actions 38822807118](https://github.com/ores-truffle-oreslang/oreslang-cli/actions/runs/38822807118)
  on `50a5dab187443acd86bb0d24f0d4b605d606e6cb` executed
  `cargo fmt --all --check`, `cargo test --workspace --locked`
  (**24 passed, zero failed**), and public CLI smoke; all succeeded.
  **This verifies only the Rust CLI boundary**, not private Java/LLVM runtime.
- CI carrier assessment: private
  `ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra`
  repository ID `1412142815` has successful Actions runs. It is
  proposed in unmerged [Java PR #1031](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1031);
  the source main's destination allowlist remains empty and `main`
  currently reports `protected: false`. Capacity is **not authorization**.
  No private source transferred, no cross-org branch created and no
  unverified Java test success claimed.


### Host-interop hardening and review handoff — October 15

- [Java #1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034):
  committed additional class-level host-interop confinement for Java desktop,
  print/audio services and unmanaged Timer threads. Added 9 dangerous-class
  negative assertions to `ScopedPermissionInteropTest`, with the existing
  safe `ArrayList` interop positive control retained. Exact commit
  `15fd3afca1c66964b1d5ce2b46dafd96ced950a4`;
  8/8 structural checks passed but **no executed JUnit evidence**.
  [fast-ci 38824341539](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38824341539)
  and [ci 38824341533](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38824341533)
  again failed with **zero steps and no runner**. Keep draft.
- [Rust CLI #9](https://github.com/ores-truffle-oreslang/oreslang-cli/pull/9):
  requested **ORESoftware** as independent reviewer for the existing
  `50a5dab187443acd86bb0d24f0d4b605d606e6cb` commit. It remains
  review-ready with 24 passing executed Rust tests, not merged; no review
  had been submitted when checked.
- Private-source CI authorization remains blocked: `main` unprotected,
  destination allowlist empty, and no permitted cross-organization export.
  The source-local ephemeral runner workflow [Java #1014](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1014)
  is review-pending and not yet usable; destination review [Java #1031](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1031)
  likewise remains unmerged. No private source transfer performed.


### Verified Rust backend-argument enforcement and mirror gate — 2026-10-15

- [Rust CLI PR #9](https://github.com/ores-truffle-oreslang/oreslang-cli/pull/9):
  denied an alternate permission authority channel through generic `--compiler-arg`.
  Clap now rejects permission/isolation `--allow*`, `--deny*`, `--ores-*`,
  `--permission-check*`, `--no-prompt*`, end-of-options and response-file
  arguments before backend dispatch. Added process-level matrix exercising 9
  unsafe options and run/check/lsp, plus a benign-argument positive control.
  Exact commit `a47f60855ee3e7329490bda0c95d79e32527ca7f`:
  [CI run 38826019046](https://github.com/ores-truffle-oreslang/oreslang-cli/actions/runs/38826019046)
  **success**, `cargo fmt --all --check`, `cargo test --workspace --locked`
  (**26/26 passing**), and public CLI smoke tests all executed and passed.
  This is not proof of Java/Graal/LLVM sandboxing or safety of arbitrary
  user-chosen `--compiler` executables.
- [Java CI approval PR #1031](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1031):
  confirmed proposed private carrier ID `1412142815` is missing from both
  reviewed exporter pins in [#1018](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1018);
  the Bash and Python publisher currently pin *only* `chapter-publishing-test/zed-pkg-integration-e2e`
  ID `1344442382`. Security review blocker recorded on #1031: reconcile
  immutable destination IDs, reviewed protected-main policy, and tests
  **before** any transfer. Current main has no active approval and is unprotected.
- [Java CI hardening PR #1018](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1018):
  added exact-source-evidence review blocker: the current exporter validates
  each uploaded blob's bytes but does not prove the destination Git tree is
  identical to the reviewed source commit/tree (a collected working directory
  may differ). Require reviewed source commit/tree binding and post-copy
  subtree comparison before claiming exact-tree validation. No private
  source transfer performed.
- Pending: independent review of #9; #1034 Java JDK25 Maven/GraalVM tests
  still unexecuted because source Actions jobs fail before runner allocation.


### Java exact-head retry — October 15

- Retried the original Java [fast-ci #38824341539](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38824341539)
  for immutable PR #1034 head `15fd3afca1c66964b1d5ce2b46dafd96ced950a4`
  using GitHub's exact-job rerun action. **Attempt 2** was accepted,
  assigned job ID `116734093682`, and then **failed with zero steps
  and no runner**. This is an infrastructure scheduling failure, *not*
  Maven/JDK25/JUnit failure or passing evidence. Keep Java #1034 draft.

### Source-local pre-merge exact-candidate runner — 2026-10-15

- [Java PR #1014](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1014)
  now includes `.github/workflows/private-exact-candidate-validation.yml`,
  explicitly separating the reviewed main workflow code from a single
  administrator-approved **unmerged candidate**. No untrusted PR event runs
  its own workflow. The immutable repository ID is pinned to `1400792274`;
  admission requires private source identity, `main` workflow SHA, exact
  candidate SHA/tree, and repository-scoped single-use runner flag. The
  pinned same-repository checkout verifies Git commit/tree and a clean
  checkout **before** GraalVM or guest execution. No cross-org source
  transfer or shared-runner fallback is permitted.
- Extended `PrivateExactMainValidationWorkflowSecurityTest` with negative
  candidate admission and provenance tests, full expected `if`/deny
  conditions and mutation guard; added CODEOWNERS review and runbook.
  Candidate workflow commit at audit:
  `0ba8406eebbfcab2144f9bc06944a41373b7d68e`;
  tree `1ec48705a54a2c2ca7aba74114461f7e4f04ce98`.
  Earlier 21/21 source structural checks passed (these are **not**
  executed JUnit tests). Java branch
  [fast-ci #38838764684](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38838764684)
  failed with **zero test steps and no runner**.
- Intended exact Java permissions candidate:
  [#1034](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1034)
  `c7583a1d8488661096a3c2d43bb70c5a56b31cee`, Git tree
  `afa3d6a4a1a760c240e7e2a2df87a78af9daac2b`.
  Candidate contains `DenoCliDefaultPermissionsTest` (11 methods),
  `RuntimePermissionsNetworkAuditTest` (20 methods), and
  `ScopedPermissionInteropTest` (8 methods): 39 targeted JUnit
  methods **present, not run**. Its
  [fast-ci #38837903429](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38837903429)
  likewise failed before any executed step. Do not substitute static
  assertions for Maven/GraalVM proof.
- Remaining indispensable gates: independent security-owner review of #1014;
  protect source main with code-owner enforcement; merge the reviewed
  workflow; provision isolated single-use repository runner; pin main
  workflow commit and explicitly reviewed candidate/tree through
  administrator-set repository variables; dispatch the workflow on
  `main`; record actual JDK25/native test logs. No runner was
  provisioned, no candidate workflow was dispatched, and no private
  source was copied to another repository in this work.


### Exact private CI Git-tree transport proof — 2026-10-15

- Hardened [Java private CI PR #1018](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1018) at source commit `9d5230c345cb938498ea1e2f23d916e7edfce1a3`. Publisher/wrapper now require explicit `--source-commit` and `--source-tree` pins and reject files differing from the exact committed Git snapshot (path, executable mode, blob content, untracked/missing, special entries). It rejects destination subtree SHA mismatch before commit/ref creation. Git metadata exclusion is restricted to the trusted checkout root. Transfer log records source commit/tree and destination commit.
- Updated offline test module to **46 declared unittest methods** with actual temporary Git checkout/dirty-file and mocked GitHub API negative fixtures; tests are **committed but have not executed on source CI**. Inspected source performed **24/24 structural assertions**; local private-free disposable Git command fixture passed its narrow SHA/manifest comparison (not the complete publisher suite).
- [Destination policy self-test run 38840638626](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38840638626) failed with **zero executed steps** and no runner. Cross-org private transfer still prohibited: source `main` remains unprotected and the destination allowlist has no authorized entries. Source-repository runner [#1014](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1014) and independent security review remain the validation path. No private source exported during this audit.

### Real local CI-publisher executable proof — 2026-10-15

- [Private source publisher #1018](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1018) now denies regular `.git` pointer files at the trusted checkout root, not merely symlinks. A disposable working-tree reproduction proved that a `.git` file containing `gitdir: <external path>` previously caused Git's commit/tree queries to resolve metadata outside the trusted root, while the snapshot validator still accepted matching bytes. Patched collector to accept only a real trusted-root Git metadata **directory** and added `test_regular_git_pointer_to_external_metadata_is_rejected`. This rejects linked worktrees by design.
- **Actual local tests:** 11/11 temporary-Git snapshot/collector tests passed (including exact commit/tree, modifications, untracked/missing files, mode changes, symlinks, nested Git and external metadata pointers); **15/15** Bash destination approval-guard scenarios passed with a disposable policy and mocked `gh api`. Total **26/26 targeted executable local tests**, not structural checks.
- These tests were run against extracted implementation code, **not** the entire private Java repository or the full 47-test Python publisher suite. [Policy test CI run #38842181129](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/38842181129), attempt 2, again failed **before starting any runner or test step**. Do not claim Java/GraalVM verification or full publisher CI.
- Security review blocker remains: the source Git tree is compared to a *local* reviewed commit SHA, but existence/identity of that commit in the authenticated original private GitHub repository is not independently checked by the current publisher. Explicit review comment is recorded on PR #1018. No private source export, cross-org mirror, or merge was performed. ORESoftware approval and branch protection still pending.
