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
A recognizable `// oreslang:checked-i64` directive with an unsupported
version, CRLF terminator, BOM, leading whitespace, extra trailing text,
duplicate occurrence or displaced line is a **hard compile/admission error**
in both Java and LLVM; it must **not** downgrade to wrapping arithmetic.
Non-canonical spacing **inside** the line-comment token is also rejected:
`//oreslang:checked-i64-v1`, `//  oreslang:checked-i64-v1` and
`//\\toreslang:checked-i64-v1` are *not* ordinary unmarked comments.
Detection is lexical, not merely line-oriented: marker-looking text inside
quoted strings or nested block comments is not a directive. A genuine
line-comment marker after source tokens or a closed block comment is
displaced and rejected.
The native host compiler and Java guest parser check this before compiling
source. Ordinary units with no recognized checked marker retain their
existing wrapping integer behavior.
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

## Typed overflow effect identity (experimental v1)

An overflow has fixed cross-backend identity:

- **Guest error type name:** `ArithmeticOverflowError` (to be derived from the
  Oreslang `Error` class when source-language error allocation is implemented).
- **Stable code and marker:** `ORES_I64_OVERFLOW`.
- **Native effect status:** `Throw` with typed payload code `0x494F0001`.
  This value is distinct from actor-supervision codes and process exit codes.
- **Operation metadata:** `add`, `subtract`, `multiply`, or `negate`.
  These map to the stable unsigned 32-bit experimental ABI tags **1, 2, 3,
  4**, respectively. Invalid tags (including 0 or 5) must not be accepted as
  a checked arithmetic failure. Neither source operands nor Java host cause
  objects can enter actor CONTROL notifications.
- **Target normalized experimental outcome:** success is a signed-i64 value
  and zero effect status; checked arithmetic overflow is a `Throw` with status
  `0x494F0001`, an operation tag above, and **no** result value. Host process
  code 86 is only an interim uncaught CLI translation. Never compare the
  process code to the native effect code or treat it as a source-visible
  catchable guest Error object.
  **Implementation status:** Java's internal typed signal carries operation
  tags. LLVM now packs each operation tag into the high 32 bits of its
  invocation-local 64-bit status; the low 32 bits hold `0x494F0001`.
  The Python reference interpreter now raises a structured `CheckedI64Overflow`
  (a subtype of `IRRuntimeError`) for MIR `add_i64`, `sub_i64`, and `mul_i64`,
  retaining the stable code, operation tag, and packed status without exposing
  operand data. MIR v1 has no native unary-negation opcode; the operation tag 4
  remains specific to Java/LLVM source evaluation. This Python exception is a
  reference-oracle signal, **not** a guest Error or proof of backend parity.
  Cross-backend executable parity remains a conformance gate for exact heads.

This identity is explicitly **not** a stable serialization of source-level
`Error`, nor does this experiment yet provide cross-backend catch/recover,
unwind cleanup, actor-heap isolation or supervisor notice delivery. The Java
runtime's internal host signal, the LLVM invocation-local error status and
the Python reference interpreter must be distinguished until those gates pass.

Failure is observable at the precise overflowing operation, even when the
enclosing expression could otherwise be folded to a constant. An overflowing
path produces no arithmetic result. Effect propagation across function calls
must preserve this status and fail closed if a target cannot provide it.

**Implementation scope:** Java currently uses a typed runtime boundary signal,
not a source-constructed guest Error. LLVM's experimental host scalar codegen
passes an invocation-owned compiler-hidden `i64*` packed status slot through
every checked function. Zero denotes success; on overflow the failing
operation writes `(uint64(operation_tag) << 32) | 0x494F0001` and returns;
nested callers preserve the first pending failure without evaluating later
arguments or operands.
Child-expression and call-argument guards prevent evaluating subsequent
operands after a pending failure. Only standalone OS `main` converts an
uncaught effect into the temporary `ORES_I64_OVERFLOW` diagnostic and
process status 86. No process-global error slot is required.

That slot carries the checked-effect **code and operation metadata**, but
is not yet a full guest `EffectStatus` value or source-constructed Error.
A C host must pass an initialized `uint64_t*` when invoking checked scalar
guest functions; passing an old `uint32_t*` would be an ABI/size violation.
It is internal to the experimental host scalar profile, not an independently
stable foreign-function ABI. No source catch/trap, actor supervision,
reusable external invocation API, Graal compiled-mode parity, native-image
AOT, or non-host target ABI is certified by these tests.
Real LLVM guest execution has been confirmed against PR #385 revision
`0980ee68d2e1eadaaa52cd68951a0b2cf82e9ac9`; subsequent
short-circuit hardening commits require fresh exact-revision verification.
Previous private-carrier execution does not approve further source transfers
or replace missing source-repository CI checks.

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
