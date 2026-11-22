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
- [Critical / suspends / actor-turn v1](contracts/v1/CRITICAL_SUSPENDS_ACTOR_TURN_V1.md) — **review-pending** separation of nonblocking critical guards, suspending effects and nonreentrant logical actor turns; [36 target vectors](contracts/v1/critical-suspends-actor-turn-v1.json), no guest execution claimed.

**Security and portability boundary:** Shared files must be versioned and byte-identical where required across backends; never silently let platform code redefine portable ownership, imports or concurrency.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

For the audited 68-repository routing index and distinctions between compiler backends, platform adapters and demos, see [Repository ownership map](docs/REPOSITORY_MAP.md). Keep this private catalog out of public organization metadata.
