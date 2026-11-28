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

**Belongs here:** Backend-neutral compiler interfaces, IR/ABI schemas, shared semantic fixtures and portable reference `.atto` sources and fixtures. Production core, alloc and std implementations are independently maintained in each `atto-source.*` backend; compatible public semantics do not require byte-identical implementations.

**Belongs elsewhere:** Backend-specific codegen and host runtime shims belong in the respective atto-source.* repositories; changing language rules requires atto-spec.
- [Critical / suspends / actor-turn v1](contracts/v1/CRITICAL_SUSPENDS_ACTOR_TURN_V1.md) — **review-pending** separation of nonblocking critical guards, suspending effects and nonreentrant logical actor turns; [36 target vectors](contracts/v1/critical-suspends-actor-turn-v1.json), no guest execution claimed.

**Security and portability boundary:** Explicitly pinned shared fixtures and versioned artifacts must retain their declared identities; never silently let platform code redefine portable ownership, imports or concurrency.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.
- [Top-12 AOT-first language features and formal admission gates](docs/TOP12_FEATURE_ADMISSION_AOT_V1.md) — proposed source-contract matrix for all 12 opportunities; backend execution unverified.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

For the audited 68-repository routing index and distinctions between compiler backends, platform adapters and demos, see [Repository ownership map](docs/REPOSITORY_MAP.md). Keep this private catalog out of public organization metadata.

## Organization boundary and migration safeguards

`atto-lang` owns language semantics, compiler backends, conformance and portable libraries. Hosted product infrastructure, deployment, identity and billing belong to separately governed product repositories. This repository is already maintained in `atto-lang`; historical migration proposals are not instructions to transfer, rename or overwrite it. Preserve explicit legacy `.ores` compatibility profiles and existing exported identifiers until a separately validated migration.

Any future repository transfer requires explicit authorization, verified repository identity and exact tree, consumer and workflow inventory, access/ruleset review, rollback planning and post-transfer verification. A mirror must be separately authorized; exact-tree identity alone does not confer permission to copy confidential source. A zero-step job is `NOT_EXECUTED`, not a pass.

## AOT and zero-GC controlled dynamism

See the [shared HIR/MIR review checklist](docs/AOT_ZERO_GC_CONTROLLED_DYNAMISM_V1.md) for proposed sealed-AOT admission, finite proxy/dispatch metadata, ownership/reclamation and executable per-backend evidence. This is a target, not proof of compiler support.

## Actor fault classes (target only)

The [v1 failure taxonomy](contracts/v1/actor-fatal-fault-classes-v1.json) distinguishes recoverable guest failures from fatal host failures, with all seven backend profiles explicitly pending. See [AttoSpec chapter 07](https://github.com/atto-lang/atto-spec/blob/main/spec/07-errors-and-failure.md) and [chapter 18](https://github.com/atto-lang/atto-spec/blob/main/spec/18-runtime-guarantees.md). The external-process evidence rule applies only to an optional stronger containment claim; it does not change the standard shared-process TenantVM profile or promise survival of a host-fatal event. `node --test tests/actor-fatal-fault-classes-v1.test.mjs` validates classifications only, not isolation.

## Freestanding library reference guard

The [core / alloc / std audit](docs/FREESTANDING_LIBRARY_LAYERS.md) and [versioned reference-source manifest](contracts/library-layers-v1.json) enforce a conservative, **host-only structural** dependency boundary over seven portable reference `.atto` sources. These fixtures are not production library implementations; each compiler owns its production core/alloc/std implementation. Run `node --test tests/library-layers.test.mjs && node src/library-layers.mjs .`. Exact-byte checks apply only to explicitly pinned reference artifacts, not independent backend implementations. No compiled guest or backend parity claim is made.
