# AttoLang canonical tuple type / value / return contract v1

Status: **proposed conformance targets; compiled guest and AOT parity NOT_EXECUTED** (2026-11-10).

Companion fixture: `fixtures/tuple-type-value-v1/manifest.json` (6 accept / 18 reject).
Reference work: [Java #2790](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2790), stacked on Java [#2734](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2734) and [#2733](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2733).
Related broader aggregate work: common-source [#254](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/254) and [#257](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/257).
This is a deliberately **tuple-only** contract, not a new collection runtime or factory registry.

## Type/value boundary

```atto
pub fnc labels(): Tuple[string, string] {
  return Tuple.of("hello", "world");
}
```

- **Canonical type annotation**: `Tuple[T1, T2, ...]` in return positions, parameters, local bindings, generic arguments and signatures.
- **Value constructor**: `Tuple.of(v1, v2, ...)`; do not reinterpret this expression as an annotation. Statically infer positional element types and retain lexical left-to-right exactly-once evaluation.
- `Tuple<T1, T2>` remains a compatibility *type* spelling, subject to existing lexical nominal `Tuple` resolution. The bracketed `Tuple[T1, T2]` must remain intrinsic even if an alias/class is also named Tuple.
- Former nominal `~tuple<T1, T2>` type aliases and their value constructors are removed, not deferred.
- `Tuple<>[]` and `~tuple<>[]` remain rejected: inferred generic markers do not silently manufacture an empty tuple shape.
- `Tuple[]` is the zero-element tuple type, paired with `Tuple.of()`. `Tuple[T]` is a singleton *tuple*, paired with `Tuple.of(v)`; `(v)` remains a grouping expression.
- Preserve `tuple(v1, v2)`, legacy bracketed context-typed literals and existing tuple returns without silently changing runtime identity.

## Typechecking and ownership

A tuple return requires exactly the declared arity and each corresponding element type. Nested tuples preserve slot types recursively. Wrong slot types, missing explicit returns, tuple-vs-array swaps and mismatched arity fail compilation. `Array.of(v1, v2)` and legacy `arr[v1, v2]` must **never** be contextually coerced into `Tuple[T1, T2]`, even for tuple-typed local bindings or union-of-tuples returns; legacy `[...]` contextual behavior is separately grandfathered and must remain explicit in compiler metadata. Tuple values cannot be mutated through indexed assignments.

Ownership of tuple elements is checked recursively. Returning or transporting a tuple must not conceal borrowed actor-private values, non-sendable closures, borrowed stack frames, stale generation handles or raw mutable supervisor state. Moving a tuple moves its owned non-Copy elements; copying is legal only when each element is Copy-safe. Evaluating `Tuple.of(...)` does not grant authority or mint an unchecked host object. Allocation and destruction must honor actor-owned arenas and supervisor quiescence.

## AOT and evidence gate

**Required targets**: Java/Graal compiled guest and Native Image, LLVM native, .NET NativeAOT, Wasm32, Forge/Cranelift. Run each manifest source as actual guest code, using a backend-specific admission adapter; inspect expected stdout/exit codes for accept cases and explicit compiler rejection with zero published native artifacts for reject cases. Preserve exact source SHA, compiler SHA/tree, fixture hash, stepful runner/job attempt, artifacts and error diagnostics. An interpreter-only pass or host-only mock is insufficient for AOT certification; source-only validation and zero-step runner admission do not prove execution.

Cross-backend tuple layout must have finite static arity, deterministically ordered typed slots and actor/FFI ownership boundaries. Do not invent a shared ABI where one is not yet established. Retain this contract as **NOT_CERTIFIED** until all target backends execute it.

## Scope exclusions

This contract does not authorize any tilde aggregate constructors or nominal tilde aliases, implicit tuple/array conversion, reflection-based tuple layouts, or dynamic tuple length.

## 2026-11-15 normative correction — no tilde constructors

The source examples above have been migrated to canonical `Tuple.of(...)` and `Array.of(...)`. `~` is shorthand for `structural`, **not** a constructor or nominal aggregate type alias. All `~tuple(...)`, `~array(...)`, `~map(...)`, typed `~kind<T>(...)` and `~<T>()` factory shortcuts must fail at parser admission. The new negative cases n13–n18 exercise this explicitly. Type-position nominal tilde aggregate aliases are likewise withdrawn. The historical terminology preserved in older source files is superseded by this section and [atto-spec #38](https://github.com/atto-lang/atto-spec/pull/38). Do not treat source-only fixture acceptance as guest/AOT proof.
