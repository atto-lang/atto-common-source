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
