# Canonical AttoLang core and stdlib source v1

**Status:** source-byte fidelity only. No source in this PR is claimed to be compiled by LLVM, Java Native Image, Wasm, Forge or .NET.

## Scope

`library/atto-library-source-v1.json` pins eight AttoLang-language guest sources with exact Git blob SHA-1 identities. These are unmodified, byte-for-byte copies of the existing `.ores` language-source modules in `ores-truffle-oreslang/oreslang-source.java`, not translations of Java runtime classes.

- Freestanding: `library/ores.core/numeric.atto`.
- Hosted: `library/ores.std/{core,assert,compute,trace,db_pool,http_wire,actor_persistence}.atto`.
- Existing `library/ores.core/numeric.ores` remains available for explicit legacy compatibility, with equality checked.

Java/JVM source loaders, Truffle ASTs, schedulers, memory and security boundaries, native LLVM/C++ libraries, low-level I/O and platform primitives stay backend-specific. Portable algorithms should be kept in this single canonical source ledger and copied into consumers with identical blobs and stable import identity.

## Verification gates

Run:

```sh
python3 scripts/verify_atto_library_sources.py
python3 -m unittest discover -s tests -p 'test_atto_library_source_integrity.py' -v
```

The verifier is *source-only*: rejects changed blob hashes, missing and duplicated entries, unexpected `.atto` or `.java` files in the canonical guest directories, missing files, symlinked source, oversize/invalid-UTF-8 source and mismatching numeric legacy aliases. Its success marker explicitly says `GUEST_COMPILATION=NOT_EXECUTED`.

All backends must separately prove compiler-owned import resolution, no filesystem shadowing, import alias identity, real compile/link/run and artifact/receipt identity. For LLVM use actual `oreslang-llvmc`, production no-GC IR audit and Clang O0/O2; for Java use real linked guest tests, JIT and Graal Native Image. Unsupported hosted functions must fail closed, not silently defer to Java or native host algorithms.

## Active stacked migrations / integration holds

Java [#2542](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2542) adds bounds/text; [#2543](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2543) was merged into parent #2542 for numeric/core/assert (not main); [#2544](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2544) carries the other five and remains stacked. LLVM [#1425](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1425) extracts exact numeric source, [#1390](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1390) expands compiler-owned core/alloc imports, and [#1379](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1379) addresses a partial scalar test library. Do not double-count these drafts as merged or compiler-tested.

Do not migrate `testing.ores` until native TestKit work and source ownership are reconciled. `data_pool.ores` retains a removed percent operator, so semantic repair must precede canonicalization. Current LLVM main lacks parity for the seven hosted `.atto` modules. This shared source ledger does not authorize exporting private source to an alternate CI organization.
