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
The test suite currently contains **35** cases: the original 20 verifier/
interpreter tests, nine additional adversarial admission and differential
conditional tests (300 deterministic cases), and six JSON Schema 2020-12
conformance tests. The arithmetic test includes 1,000 deterministic
transformations compared against an independent Python arithmetic oracle.

Run all IR tests (the schema test suite uses pinned `jsonschema==4.26.0`
as a **test-only** dependency):

```sh
python3 -m pip install jsonschema==4.26.0
python3 -m unittest discover -s tests -p 'test_ir_v1*.py' -v
```

## Validity checks and resource limits

The reference verifier rejects:
- Non-string JSON object keys, Python tuple/set/float coercions, cyclic objects,
  nested objects deeper than 64 levels and JSON integers over 256 bits.
- JSON floating-point encodings (`1.0`, `1e2`), oversized JSON integers,
  duplicate fields, malformed Unicode and nonfinite values.
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

## CI status and interpretation

GitHub Actions is currently failing before Python runner steps begin in this
private repository; see [runner diagnosis issue #27](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/27).
The test matrix being *defined* is not evidence that either Python version has
executed successfully. Keep this work in draft until a green exact-head
run provides inspectable test logs. Local tests must be reported separately.

## Exact-source Java/LLVM frontend comparison (experimental)

The first **real parser → HIR** adapters are proposed separately:

- [Java/GraalVM PR #956](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/956)
- [LLVM PR #385](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/385)

After building both compiler trees independently, compare their emissions
from the **same immutable source snapshot**:

```sh
python3 scripts/experimental_hir_v1_source_parity.py \
  --source fixtures/ir-v1/checked-safe-counter.ores \
  --java-classpath /absolute/path/to/oreslang-source.java/target/classes \
  --llvm-binary /absolute/path/to/oreslang-llvmc \
  --entry main --expected-i64 43
```

The comparator invokes the **real** Java and LLVM compiler frontends,
checks process exit status and output bounds, verifies each HIR
semantically, checks source snapshots were not modified during execution,
compares canonical HIR, then interprets verified common MIR. It fails on
timeout, tool absence, mismatch or malformed output. Its six direct harness
tests can run without compiler binaries:

```sh
python3 -m unittest discover -s tests -p 'test_experimental_hir_source_parity.py' -v
```

The harness output intentionally includes `"executed_backends": false`
and `"compiler_revision_verified": false`. Even when both frontends
emit matching HIR, this **does not** prove Java/LLVM machine-code behavior,
source-to-AOT end-to-end correctness, borrow checker parity, or toolchain
provenance. Resolve backend `int`/checked-i64 semantics before any
production compilation may trust the result. Do not convert a missing runner
into a passing comparison; CI failures must remain failures.

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

### Checked-i64 source-unit execution (new opt-in)

The experimental **host-only** checked integer mode is selected by the
exact first source line (LF terminator):

```oreslang
// oreslang:checked-i64-v1
pub fnc scale(int count): int { return count * 43; }
pub fnc main(): int { return scale(1); }
```

Marked source executes signed-64-bit addition, subtraction, multiplication
and unary negation with overflow detection. Java/GraalVM uses
`Math.*Exact`; LLVM uses `llvm.sadd/ssub/smul.with.overflow.i64`, with
checked negation lowered as zero-minus-operand. LLVM's experimental host
failure path prints `ORES_I64_OVERFLOW` and exits with status 86; the
GraalVM guest raises a failure carrying the same diagnostic marker. This
is **not yet a unified guest `Error`/supervisor ABI**.

Unmarked source units preserve ordinary runtime arithmetic, and their HIR
exporters continue to reject expressions such as `count * 43` unless a
conservative whole-domain interval proof establishes overflow freedom.
Marked source can emit the same expression as `checked-i64.v1` only because
its runtime now actually detects overflow. This opt-in does not enable
actor-wide, embedded, Wasm or GraalVM native-image AOT checked arithmetic.

The shared [experimental checked-i64 execution contract](https://github.com/ores-truffle-oreslang/oreslang-common-source/blob/feat/experimental-hir-mir-v1-20261014/docs/EXPERIMENTAL_CHECKED_I64_V1.md)
defines the precise source directive, tested boundaries and remaining
production error-policy limitations. Real compiler tests include safe
arithmetic, runtime overflow, legacy wrapping, identical frontend HIR and
reference MIR checks.
