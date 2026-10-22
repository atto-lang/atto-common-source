# Source-linked scalar-to-SMT prototype (pre-HIR)

**Assurance level:** experimental, narrow source importer. This is **not** the Oreslang compiler, typed HIR/MIR, a verified frontend or a semantics-preserving backend lowering pass.

`scripts/verify_scalar_subset.mjs` imports the **complete body** of only `pub fnc min_int(int,int): int` and `max_int(int,int): int` with a single `if parameter <|<=|>|>= parameter; do return parameter; else return parameter; fi`. Unsupported return expressions, statements, comparison syntax, duplicate functions, source bounds or unrecognized tokens are rejected. This is intentionally a tiny, syntax-restrictive profile. The importer does not type-check general Oreslang programs or validate module-resolution or compiler frontend behavior.

It generates a QF_BV SMT implementation function from the parsed comparison and return paths; its **separate contract** defines mathematical signed-64-bit min/max. Z3 must produce exactly one `unsat` for implementation inequivalence and one `sat` for a deliberately incorrect comparison mutant. Changing the source branch changes the SMT obligation, avoiding merely re-running a manually maintained function definition. However, bugs in this prototype parser or differences from the actual Oreslang compiler are not ruled out.

The committed `tests/fixtures/stdlib-core-reviewed.ores` is an **exact Git blob copy** of Java `stdlib/core.ores` at Git blob `d2cd9b8e0cd3e3bb3ee6a5f9cebf9ab3312c44f4`. The CI gate fails if this reviewed fixture changes. A copied private fixture is *not* an automatically synchronized dependency on Java's current source; if upstream code changes, independently review and refresh the fixture. Both repositories are private at creation; do not publish source to a public CI carrier.

## Local checks

```sh
node --test tests/verify_scalar_subset.test.mjs
node scripts/verify_scalar_subset.mjs min_int tests/fixtures/stdlib-core-reviewed.ores > /tmp/core-min.smt2
z3 -smt2 /tmp/core-min.smt2
node scripts/verify_scalar_subset.mjs --check min_int tests/fixtures/stdlib-core-reviewed.ores
node scripts/verify_scalar_subset.mjs --check max_int tests/fixtures/stdlib-core-reviewed.ores
```

CI requires checkout at the PR head SHA, reviewed source identity, tests, Z3 tool version+binary SHA256, and exact `unsat/sat` oracle results. Repository runner scheduling issues can prevent any job from executing. No simulated CI receipt is accepted.

## Next promotion gates

1. Replace the independently written subset parser with the *actual frontend's typed HIR* export in both Java/Graal and LLVM, or demonstrate a sound verified importer. Version source span, type, signed-width and effects.
2. Validate assumptions about signed-i64 `int`, exact comparison and return semantics on actual Java/Graal and LLVM guest executions, including MIN/MAX.
3. Extend to branching, checked arithmetic, contracts, error paths and eventually ownership/borrows; never silently treat unsupported effects as pure.
4. Pin reviewed Z3 build/digest and save raw proof transcript with authenticated exact-head runner evidence.
5. Add a deliberately wrong `min_int` source mutant to a *real* Z3 integration test that must fail with `sat` (the current host mutation test only checks the altered generated obligation).

The objective is the small first verified proof-generation interface, not a blanket assertion that core/std-lib or all backends are verified.
