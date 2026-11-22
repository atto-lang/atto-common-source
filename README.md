> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-common-source

Shared compiler definitions, language contracts, and source infrastructure across AttoLang backends.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-common-source](https://github.com/atto-lang/atto-common-source); use `https://github.com/atto-lang/atto-common-source.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Purpose

Maintain shared IR, contract schemas, and reusable compiler building blocks.

## Repository responsibilities

- Keep interfaces, schemas, and behavior documented in a backend-neutral form where applicable.
- Use test fixtures and reproducible evidence to distinguish proposed behavior from implemented behavior.
- Record breaking changes, migration notes, and dependencies on other AttoLang components.

## Validation

Validation should rely on checked-in tests and exact-commit CI results. When reporting parity, distinguish **passed**, **failed**, **unsupported**, and **not executed**. Avoid inferring guest-runtime support from host-only tests.

## Status and development

This README records the intended role of this repository; it is not a claim of feature completeness. Consult the source tree and workflow files for actual implementation and verified build commands. Contributions should preserve compatibility with the canonical language contract.

## Ecosystem

- [AttoLang](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Cross-platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Backend-neutral compiler interfaces, IR/ABI schemas, shared semantic fixtures and canonical portable core/std written in .atto.

**Belongs elsewhere:** Backend-specific codegen and host runtime shims belong in the respective atto-source.* repositories; changing language rules requires atto-spec.

**Security and portability boundary:** Shared files must be versioned and byte-identical where required across backends; never silently let platform code redefine portable ownership, imports or concurrency.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

For the audited 68-repository routing index and distinctions between compiler backends, platform adapters and demos, see [Repository ownership map](docs/REPOSITORY_MAP.md). Keep this private catalog out of public organization metadata.

## Repository ownership and migration (2026-11-08)

**Current repository:** `ores-truffle-oreslang/oreslang-common-source` (legacy organization). The language is publicly **AttoLang**, formerly Oreslang. Do not remove working `.ores` source support or rename old package/CLI/repository identifiers as an incidental side effect.

- **This repo should contain:** canonical portable `.atto` core/std modules and shared cross-backend contracts.
- **Exclude or route elsewhere:** host-specific Java/C#/LLVM semantics duplicates and cloud product services.
- **Boundaries:** [`atto-lang`](https://github.com/atto-lang) owns language semantics, core/std, compilers, tooling, conformance and portable libraries. [`atto-co`](https://github.com/atto-co) owns separately governed hosted infrastructure, tenant cloud runtime, deployment, identity and billing. Existing new-org `atto-*` repos are distinct Git identities until reconciled; do not overwrite them.
- **Proposed first destination:** `atto-lang/oreslang-common-source` via **reviewed transfer of this repository identity**, not a clone, rename or direct transfer to `atto-co`. Future AttoCo product carve-outs must be authorized separately.

**Owner checklist:** coordinate in [migration issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26) and review the private [transfer plan #25](https://github.com/ores-truffle-oreslang/.github/pull/25). Before any migration, document stable numeric repo ID, exact head SHA/tree, open PRs/issues, tags, consumers, packages, Pages, Actions and billing, branch/ruleset enforcement, secrets and app/webhook permissions, source/target administrators, independent security reviewer and rollback plan. No unapproved private-source mirror. After the authorized GitHub transfer, verify unchanged identity/history/tree and reinstate controls, then rerun exact-head tests. Zero executed CI steps (`steps=[]` or `null`) is `NOT_EXECUTED`; structural or host-only checks are not guest-runtime parity proof. Preserve old names and `.ores` compatibility while `.atto` source support is validated per compiler.
