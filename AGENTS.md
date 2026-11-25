# Repository AI agent instructions

<!-- org-merge-review-policy:begin -->
> **Agent/PR governance:** Read [atto-lang's canonical AGENTS.md](https://github.com/atto-lang/.github/blob/main/AGENTS.md). **Drafts:** at 72h of the CURRENT Draft cycle (creation if opened Draft, otherwise latest genuine Ready→Draft), automatically mark Ready if material CI passes on the exact current head and no `keep-as-draft`, `not-ready`, or legacy `keep-draft` label exists; recheck labels and CI before promotion. **The Ready review clock starts at zero upon promotion.** Ready age <72h: Codex/ChatGPT + Claude/Opus + `ORESoftware` + `the1mills` approvals. Ready age 72–240h: one verified independent approval, green CI, no conflicts, and a **mandatory competing/overlapping PR audit**; update current/competing PRs before merging when needed. Ready age ≥240h: fresh post-boundary reviews from all four. A genuine return to Draft ends/resets the Ready cycle. Respect GitHub protections, never manipulate draft state to game age, and inspect [legacy Oreslang counterpart PRs](https://github.com/ores-truffle-oreslang/.github/blob/main/governance/atto-migration-map.json) before duplicating features.
<!-- org-merge-review-policy:end -->


## AOT and zero-GC review checklist

Follow [the shared review checklist](docs/AOT_ZERO_GC_CONTROLLED_DYNAMISM_V1.md) and [current AttoSpec chapter 24](https://github.com/atto-lang/atto-spec/blob/main/spec/24-aot-zero-gc-controlled-dynamism.md). Distinguish guest from host AOT, and guest from process GC. Require exact-head positive and negative guest evidence before claiming implementation parity; a structural reference is not guest execution. Preserve the existing governance block above and backend ownership of implementations.
