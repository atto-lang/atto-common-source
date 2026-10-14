# Experimental HIR/MIR v1 — executable arithmetic contract

**Status:** experimental Python reference, not a stable public Oreslang language
or binary ABI. This repository remains separate from the Java/Graal and LLVM
compilers. No production backend consumes these artifacts, and the fixture is
**not parsed from Oreslang source**. Its declarations are authored typed HIR.

## Supported semantics

| Concept | Exact experimental rule |
| --- | --- |
| Integers | Signed **64-bit**, represented as canonical decimal strings in JSON literals, checked on arithmetic and argument admission |
| Boolean | Distinct `bool` type; never implicitly an integer |
| Arithmetic | `add`, `sub`, `mul`: overflow traps, no wrap or undefined behavior |
| Comparison | `lt`, `eq` on i64 inputs only, producing bool |
| Functions | Direct statically resolved calls, exact arity and types, no recursion |
| Locals | Lexical `let` expression, no shadowing in this first subset |
| Conditional | Boolean `if` expression with same-typed branches and left-to-right evaluation |
| MIR | SSA-like named values, acyclic CFG, explicit branch/jump/return, block parameters at merge nodes |
| Effects and ownership | **Unsupported** (no I/O, actors, suspension, generics, borrowing or runtime layouts) |

There is no implicit host-language numeric coercion. `-0`, leading zeros,
nonfinite values, unknown instructions/versions/features, mismatched calls and
malformed CFG edges are rejected. No requirement for Java's or LLVM's physical
object representation is implied.

The JSON Schema 2020-12 files are:
- [HIR](../contracts/ores-hir-v1.experimental.schema.json)
- [MIR](../contracts/ores-mir-v1.experimental.schema.json)

Schemas cover structural shape and exact op variants. The executable
**semantic verifier is mandatory**: schema validation alone does not check
integer bounds, call graphs, dominance, return types, CFG edge typing or
reachable blocks.

## Run the executable fixtures

Run from repository root with Python 3.11+ and **no external dependencies**:

```sh
python3 -m experiments.ir_v1.cli verify-hir fixtures/ir-v1/arithmetic.hir.json
python3 -m experiments.ir_v1.cli lower fixtures/ir-v1/arithmetic.hir.json
python3 -m experiments.ir_v1.cli verify-mir fixtures/ir-v1/arithmetic.mir.json
python3 -m experiments.ir_v1.cli run fixtures/ir-v1/arithmetic.mir.json --function main --args-json '[]'
python3 -m unittest discover -s tests -p 'test_ir_v1.py' -v
```

The `main` example returns `7`. See
[expected observations](../fixtures/ir-v1/results.json).
The tests include 1,000 deterministic arithmetic transformations and compare
their interpreted MIR values to an independent arithmetic oracle.

## Validity checks and resource limits

The reference verifier rejects:
- Unknown opcodes and terminators, unknown versions and feature sets.
- Duplicate/unknown symbols or SSA values, malformed or undominated uses,
  invalid call arguments, wrong edge arity/types, unreachable or cyclic CFG.
- Direct and mutual function recursion.
- Inputs exceeding 1 MiB, modules with more than 32 functions, excessive
  blocks/instructions, or more than 48 HIR expression nesting levels.
- Unknown fields in all accepted structural nodes and duplicate JSON keys.

The interpreter verifies MIR **before executing** it, bounds instructions
(default 10,000), and rejects runtime overflow. This experiment is not a
security-grade sandbox: it must never execute hostile artifacts without
external isolation, OS controls and resource limits.

## Incrementality boundary

The already-merged
[experimental red/green query model](../experiments/incremental_query.py)
can eventually consume canonical verified function summaries, but **is not
yet integrated** into this IR prototype. Fingerprints are derived from
deterministic JSON key order and an experimental schema version, not a
stable cross-language canonical wire specification.

## What remains before backend adoption

1. Confirm i64 semantics and the public syntax with actual Oreslang compiler
   implementations; this is an experimental choice, not a language-wide decision.
2. Add real parser/frontend adapters for Java/Graal and LLVM that emit the
   same envelope for **identical Oreslang source**.
3. Verify source spans, stable symbol identity, effects and ownership before
   extending the contract.
4. Compare **real executed output** against clean compiler builds, with
   exact source and compiler revisions. Interpreter agreement does not prove
   either production backend implements the shared semantics.
5. Resolve infrastructure blockers for hosted CI, then pin tested interface
   versions and add rejection rules for unsupported target profiles.
