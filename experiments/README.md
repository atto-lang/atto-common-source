# Incremental query engine — executable reference experiment

This directory introduces a **standard-library Python reference model** to make the
incremental compilation contract executable before we choose an implementation
language, wire format, or a shared JVM/native ABI.

It is **not a production compiler, parser, borrow checker, persistent cache, or
permission/security verifier**. No emitted code or proof is accepted from this
experiment, and no downstream backend depends on it.

Run:

```sh
python3 -m unittest discover -s tests -p 'test_incremental_query.py' -v
```

The model illustrates:

- Cached queries with dependency fingerprints and red/green validation
- Unchanged-input and no-op build reuse
- Body edits that avoid retyping unrelated non-inlined callers
- Public signatures/effects invalidating real semantic dependents
- Inlined dependencies invalidating caller codegen, not caller types
- Negative lookup dependencies (adding an absent symbol changes resolution)
- Target-neutral analyses reused between LLVM and Wasm
- Toolchain changes invalidating target-specific objects only

## Hard limits

The input facts are supplied as trusted, canonical JSON. The model does not
lex/parse/type-check Oreslang, represent real MIR, verify control flow or
ownership, serialize caches, or prove semantic equivalence. A successful
`typed` query means only that a modeled symbol and its modeled calls are
present, **not** that the program type-checks. The `mir`, `object`, and
`link` query names are pedagogical; their values are structured fingerprints,
not executable artifacts.

Prior to production use, implement a typed versioned IR contract, trusted
provenance, exact compiler/runtime/ABI keying, robust cycle handling, bounded
queries and resource accounting, safe persisted cache publication, and clean
versus incremental compilation differential tests on real compiler binaries.

See [ARCHITECTURE](../docs/ARCHITECTURE.md) and
[IR-DESIGN](../docs/IR-DESIGN.md).
