# Repository ownership governance checks

The canonical private inventory is governance/repositories.json. Its 68 repository names, scopes, categories and visibility classifications are deliberately kept inside this **private** AttoLang repository, not in the public organization profile or marketing site. The human-readable view is docs/REPOSITORY_MAP.md.

## Mode A: offline (enabled in CI)

Run:

    python3 governance/validate_ownership.py --offline
    python3 -m unittest discover -s tests -p 'test_repository_ownership.py' -v

These checks reject malformed manifests, duplicate/missing repositories, forged links, mismatched ownership descriptions, incorrect private/public classifications, category drift and missing trust warnings. CI checks out the immutable PR head with a pinned checkout action and verifies a clean tracked tree and no tracked symlinks. This is a source-free governance contract, not an AttoLang guest-language test.

## Mode B: authenticated remote (manual, not yet a required status check)

Provide a *read-only, scoped installation token* with access to **all 68 repositories**, including private repositories. Never put it in logs or commit it:

    ATTO_AUDIT_TOKEN=<scoped-read-token> python3 governance/validate_ownership.py --remote --receipt /tmp/atto-ownership-receipt.json

Remote mode reads repository metadata, a pinned default-branch SHA and README, then verifies the branch has not moved during inspection. It refuses missing/unauthorized credentials and absent ownership/readiness text rather than skipping repositories. Its receipt records SHA-specific pass evidence, not compiler or actor execution. Do not use a broad personal token or publish the receipt publicly.

**Enforcement status:** Offline CI covers the manifest *in this repository only*. Remote cross-repository enforcement is **not enabled**, because a standard repository-scoped GitHub Actions token cannot safely read every private sibling repository. To enforce all 68 default branches, configure a narrowly scoped GitHub App with metadata/contents read across this organization; run the remote audit under separate governed CI and register its check where protections/rulesets permit. Do not claim organization-wide live enforcement until that check executes on a pinned head with nonzero steps and required status is configured.

## PR stacking and owner review

This implementation branch is intentionally based on documentation PR #7. Review/merge #7 independently, then retarget or rebase the governance PR onto main, preserving provenance and unrelated changes. Changes to manifest scope or visibility require independent review.

The public .github organization repository owns default community health and review policy, **not** the private 68-repository roster. Normative language semantics remain in atto-spec; backend implementations remain in their respective atto-source.* repositories.
