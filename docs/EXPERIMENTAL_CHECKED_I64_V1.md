# Experimental checked-i64 v1 runtime contract

**Status:** source-unit opt-in, **NOT** a production-wide Oreslang integer ABI.
This experimental contract is deliberately narrower than actor, supervision,
AOT, multi-target and existing legacy `int` behavior.

## Source feature negotiation

A source unit opts into checked host arithmetic **only** with this exact
first line, followed by LF (`\n`):

```oreslang
// oreslang:checked-i64-v1
pub fnc scale(int count): int { return count * 43; }
```

The compiler must use the source text that it executes to determine the
profile. A separate HIR JSON flag without compatible runtime code generation
is **never** sufficient evidence of checked behavior.

The directive must be at offset 0 (no BOM, indentation or blank line).
Ordinary units retain their existing wrapping integer behavior.
The current opt-in applies to one source unit, not imported modules. It
does not presently negotiate non-host Wasm, freestanding Cortex-M, actor
scheduling or native-image AOT semantics.

## Arithmetic semantics

In opt-in host code, signed-i64 `+`, `-`, `*` and unary negation return
the exact mathematical value if it belongs to
`[-9223372036854775808, 9223372036854775807]`. Otherwise evaluation
terminates on that operation with an overflow failure. Neither operand
is implicitly promoted to a float or saturated. The shared HIR/MIR v1
language exposes `add`, `sub`, and `mul`; the native source-unary
negation behavior is an additional frontend/runtime requirement.

| Expression | Expected result |
| --- | --- |
| `40 + 3` | 43 |
| `1 * 43` | 43 |
| `MAX_I64 + 1` | Overflow |
| `MIN_I64 - 1` | Overflow |
| `MAX_I64 * 2` | Overflow |
| `MIN_I64 * -1` | Overflow |
| `MAX_I64 * 0` | 0 |

**Interim error representation:** Java's opt-in evaluator raises an Oreslang
guest execution failure carrying `ORES_I64_OVERFLOW` in its cause chain.
The LLVM host-native experimental backend prints `ORES_I64_OVERFLOW` and
terminates with process status 86. These are classified as one semantic
overflow outcome by the conformance harness, **not** a standardized
cross-platform exception, `Error` subclass, supervisor notification, or
stable process-status ABI. Production integration must define that ABI and
handle catch/recover/supervision rules explicitly.

The current LLVM lowering uses `llvm.sadd.with.overflow.i64`,
`llvm.ssub.with.overflow.i64`, and `llvm.smul.with.overflow.i64`;
unary minus uses checked zero-minus-operand. **Do not** replace these
intrinsics with naked `nsw` arithmetic: poison is not a safe overflow signal.
The Java host opt-in evaluator uses the corresponding `Math.*Exact`
methods. Unmarked source uses pre-existing operations.

## Migration from the conservative HIR exporter

Without the source opt-in, the exporters retain universal interval proofs
and reject potentially overflowing arithmetic such as `count * 43`.
With the source opt-in, such functions can emit `checked-i64.v1` and must
execute with checked semantics. Each HIR document must still be admitted
by the independent semantic verifier before lowering or interpretation.

Tests must distinguish:
1. Valid checked arithmetic with the expected value.
2. Runtime overflow, including paths across function calls.
3. Legacy wrapping that is unaffected by the opt-in.
4. Incorrect/missing opt-in and unsupported targets.

Useful reference fixtures:
- `fixtures/ir-v1/checked-runtime-multiply.ores`
- `fixtures/ir-v1/checked-runtime-overflow.ores`
- `fixtures/ir-v1/legacy-wrapping-overflow.ores`

**Promotion criteria:** exact-head Java/LLVM builds, guest execution for
all arithmetic boundaries, repeated cross-backend conformance,
fail-closed feature negotiation, deliberate exception ABI, and actor
isolation tests before any production compiler or backend claims this
experiment as its default runtime semantics.
