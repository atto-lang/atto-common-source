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

## Actor-local reference provenance (draft)

- [Ref32 origin and generation audit](docs/REF32_ORIGIN_PROVENANCE_V1.md) describes why equal four-byte tokens from separate actor heaps cannot authorize cross-actor access, and requires typed HIR/MIR origin proofs before compiled guest use. Its [12-case registry](contracts/ref32-origin-provenance-v1.json) is target-only, with Java/LLVM guest status **NOT_EXECUTED**.

## First compiled ObjectStorage M1 experiment (draft)

- [Bounded typed Point/Particle source and memory plan](docs/OBJECT_STORAGE_M1.md)
- [Typed 16-byte struct / 24-byte class contract](contracts/object-storage-m1-v1.json)
- [Exact Java JVM, LLVM native and GraalVM Native Image execution receipt](contracts/object-storage-m1-evidence-20261118.json)

This standalone experimental compiler slice is **not** canonical frontend parity and does not promote the full 30+12 target-only conformance cases.
