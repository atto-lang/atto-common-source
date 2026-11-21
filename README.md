# atto-common-source

Shared compiler definitions, language contracts, and source infrastructure across AttoLang backends.

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

## Freestanding library layer guard (stacked proposal)

The [core / alloc / std audit](docs/FREESTANDING_LIBRARY_LAYERS.md) and [versioned source manifest](contracts/library-layers-v1.json) enforce a conservative, **host-only structural** dependency boundary for canonical `.atto` library source. It builds on the first `.atto` identity source in PR #6; it does **not** claim executable bare-metal compilation, allocator integration or backend parity. Run `node --test tests/library-layers.test.mjs && node src/library-layers.mjs .` after the stacked source is present.
