# Draft: Native Oreslang numeric and Math contract

Status: PROPOSED and non-normative; not runtime-verified. Applies to Java/GraalVM, LLVM, WASM, .NET NativeAOT, Forge. No backend may claim parity from this document alone.

## Numeric families
Canonical Oreslang source spellings are lowercase `bigint`, `decimal`, `float`/`f64`, and `f32`. Host names such as Java `BigInteger`/`BigDecimal`, .NET `BigInteger`/`decimal`, JavaScript `BigInt`, or C++ multiprecision types are implementation/oracle names only and are never source-language aliases.
- Fixed signed integers `i8/i16/i32/i64` and unsigned `u8/u16/u32/u64` (subject to actual language type spelling): exact within range, default arithmetic checked for overflow in all optimization levels. Never rely on C/C++ signed-overflow undefined behavior, implicit Java wrap, or JS Number coercion.
- `bigint`: arbitrary-precision signed integer with exact addition, subtraction, multiplication, comparison, division, and remainder. Resource-limited, not truly infinite; exceeding allocation/operation budgets reports a typed resource error, never silent truncation.
- Binary floats: existing source `float` is IEEE 754 binary64; `f64` is the explicit spelling/alias target and `f32` is binary32 when admitted. Rounding, NaN, signed zero, infinity, subnormal behavior and platform constraints are observable; these types are inherently approximate.
- `decimal`: Oreslang-owned base-10 coefficient + signed scale, with explicit `DecimalContext` for operations requiring rounding. `decimal` values are exact unless a selected operation requests rounding; no implicit conversion through `float`/`f64`. Numeric equality ignores representational trailing-zero scale, while APIs that need quantization/scale inspect it explicitly. Decimal zero has no negative-zero identity.
- `Rational` and fixed-point `Fixed<scale>` are future extensions, not required for this milestone.

## Math.abs / Math.neg
- These names are part of the core/prelude numeric surface. Their semantics are Oreslang-owned. A backend may lower them as compiler intrinsics for safety/performance, but must not inherit host-library edge cases as the language contract. The pure-Oreslang stdlib definition is the semantic reference where the required type is expressible.
- Numeric dispatch is compiler/type-system dispatch, not ordinary user overload-by-host-type. This avoids making the language's scalar-overload policy depend on Java/.NET/C++ host type families.
- For signed fixed-width integers, `Math.abs(x)` and `Math.neg(x)` return the same type. At the minimum representable value (`MIN`), both raise a typed ArithmeticOverflow error under checked mode. Never emit unchecked `-MIN` or `abs(MIN)`.
- `Math.neg(x)` means arithmetic negation, not an optimizer-dependent multiplication by -1. `Math.neg(0)` returns 0; for floating point, `Math.neg(+0.0)` is -0.0 and `Math.neg(-0.0)` is +0.0.
- For unsigned values, `Math.neg` is a type error unless the user explicitly widens or converts to signed/bigint. `Math.abs(uN)` is identity with no overflow.
- `Math.abs(bigint)` and `Math.neg(bigint)` are exact, limited only by configured operation/memory quotas.
- For floats, use sign-bit aware IEEE operations: `abs(-0.0)` gives +0.0, `neg(NaN)` remains NaN (payload preservation is not promised across all backends), `abs(+/-infinity)` gives +infinity. No integer overflow semantics apply.
- For decimal, both are exact, context-free sign operations, and scale is preserved.
- Offer `Math.abs_checked`/`Math.neg_checked` returning Result and `Math.abs_wrapping`/`Math.neg_wrapping` only for fixed-width signed integers, with explicit documentation. Do not accidentally change default checked behavior to saturating.
- Compiler constant folding, interpreter, JIT, AOT, and intrinsic paths must agree; no optimization-mode exceptions.

## bigint correctness and security
- Canonical serialization: signed magnitude rules and byte order MUST be specified before wire compatibility is asserted; decimal text form is normalized ASCII base-10 with optional leading '-' and zero spelled '0'. No leading '+' or redundant leading zero in canonical output.
- Division semantics: quotient truncates toward zero, remainder has dividend's sign; `a == (a / b) * b + (a % b)` and `abs(r) < abs(b)` for nonzero divisor. Division by zero is a typed error.
- Cross-type comparisons must be exact; never convert bigint to float to compare. Explicit lossless conversion gates and checked narrowing. bigint -> float requires explicit conversion/rounding acknowledgement.
- Define quotas for bits, operands, output size and CPU work; enforce before catastrophic allocation. Power, shifts, parsing, format and serialization must be bounded and cancellation/cooperation-aware. Constant-time guarantees are NOT implied.
- Hard-real-time regions may use bigint only when a statically/provably bounded maximum bit width and operation budget are attached to the value/profile. Unbounded bigint is rejected from hard-RT certification rather than pretending arbitrary-precision latency is bounded.
- Limb storage is an implementation detail; observable behavior must not depend on Java biginteger, .NET biginteger, GMP/Boost, JavaScript bigint, or another host library. Those libraries may serve as independent test oracles, not as the normative specification.
- Each mutable internal limb buffer has clear actor ownership/arena lifetime and never aliases across isolates; passing bigint between actors uses immutable/copy/take/share rules. Validate resource-lifetime behavior on LLVM and near-zero-GC arena paths in Java.

## Floating point versus decimal precision
- `0.1_f64 + 0.2_f64` is not required to equal `0.3_f64`; decimal exact literals `0.1_dec + 0.2_dec == 0.3_dec` when no rounding is needed.
- Binary `f32/f64` operations specify round-to-nearest ties-to-even by default when possible; avoid unsafe fast-math or reassociation if it changes observable results. State whether fused multiply-add is opt-in.
- Preserve signed-zero behavior for sign operations; NaN comparisons are unordered; `NaN != NaN`; do not use approximate equality as the default operator.
- Provide `Math.is_nan`, `Math.is_finite`, `Math.is_infinite`, `Math.signbit`, `Math.next_after`, and `Math.ulp` where supported with cross-target tests.
- Define `Math.approx_eq(a,b,abs_tol,rel_tol)` using both absolute and relative tolerance and explicit handling of NaNs and infinities; caller chooses tolerances. No universal epsilon.
- Decimal division that is non-terminating (e.g. 1/3) requires an explicit precision/rounding context or yields a typed nonterminating-expansion error. Default context and scale normalization must be specified before enabling implicit decimal division.
- `DecimalContext` includes at least precision, rounding mode, and bounded result-scale/digit policy. Hard-real-time use requires all of these bounds to be statically/profile bounded; otherwise Decimal is excluded from hard-RT certification.
- `float` is never a synonym for Decimal or arbitrary precision. `0.1 + 0.2` therefore follows binary64 behavior; exact decimal source requires an explicit Decimal literal/construction syntax once that type is admitted.
- Transcendentals (`sin`, `cos`, `log`, `exp`) require documented accuracy and backend evidence; do not promise bitwise parity from different host libm libraries.

## Required parity fixtures (shared registry)
1. abs(0), abs(-1), abs(MAX), abs(MIN); neg(0), neg(1), neg(MIN) for each signed width.
2. abs(unsigned MAX), rejected neg(unsigned), checked/wrapping variants and constant-folded MIN.
3. f32/f64 +0/-0 sign bit under abs/neg; NaN, +Inf/-Inf, subnormal, boundary rounding.
4. Exact bigint 2^64, 2^127, 2^1024; negative values and zero canonicalization; parse/print roundtrip.
5. bigint division/remainder with all sign combinations; division by zero; checked narrowing.
6. bigint->f64 explicit precision loss near 2^53; exact mixed bigint comparisons.
7. Decimal 0.1 + 0.2 = 0.3, 1/3 without context, 1/3 with explicit context, trailing zero/scale and tie-breaking.
8. Negative zero and NaN under comparisons, serialization, optimizer constant folding, AOT, JIT.
9. Property fuzz: abs(x) >= 0 when representable; neg(neg(x)) == x except MIN in checked mode; bigint a == q*b+r; decimal exact-integer agreement.
10. Limits: huge exponent/shift, parse bomb, actor cancellation, arena teardown and memory quota; ensure typed errors.
11. Cross-backend compare normalized results and error classes from compiled guest programs, not host-only models.

## Admission gates
- A shared registry with input types, exact outputs/bit patterns, expected error kinds and optimization profile.
- Real compiler checking + executable guest output on each of the five backends, with SHA-pinned compiler/source provenance.
- Debug/release, optimization on/off, host/native AOT where applicable; sanitizer coverage for native implementations.
- Explicit recorded deviations in float transcendental precision (ULP bounds) rather than claiming impossible universal bitwise equality.
- Independent review and enforced protected-branch required checks before normative adoption or release qualification; merging this proposal does not satisfy those requirements. If source Actions cannot execute, use an explicitly authorized private carrier and verify exact source Git-tree/blob provenance; NEVER transfer private source while the destination allowlist is empty.

## Open design questions
- Exact Oreslang spellings for fixed-width, decimal and the typed error class.
- Whether checked operations use `throw` or `raise` by default; `*_checked` Result methods should not throw.
- Decimal default context and whether a separate Decimal128 type is warranted.
- Required float strictness/permitted host-libm tolerance per target.
