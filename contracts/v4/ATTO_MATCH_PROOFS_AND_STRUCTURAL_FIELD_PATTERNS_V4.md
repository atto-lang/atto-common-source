# AttoLang v4 — match proof modes and bounded structural record-field patterns

**Status: draft, normative proposal, no five-backend certification.**
Parent contracts: [v1](../v1/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V1.md), [v2](../v2/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V2.md), [v3](../v3/ATTO_TILDE_TYPED_EMPTY_AGGREGATES_V3.md).

## 1. Ordered versus proof-checked matching

- `match subject over … end` and `do match subject over … end` are **proof-checked**: explicit arms must be pairwise disjoint (or the backend must reject the overlap as unproved), and the collection must be exhaustive. A final unguarded `default` satisfies exhaustiveness but **never** excuses overlapping explicit arms. A guarded arm does not automatically prove disjointness.
- `match first subject over … end` and `do match first subject over … end` intentionally use **source-order priority**, with unreachable later arms still diagnosed. A guard is evaluated only after its pattern matches. `on _` and `default` are terminal unconditional fallbacks.
- The scrutinee is evaluated exactly once. Matching a field is a read, not an implicit `rt take`.
- An implementation that cannot prove disjointness for a new pattern must fail closed; it must not silently reinterpret ordinary `match` as `match first`.
- Existing legacy syntax remains a separately tested compatibility surface. This contract does not authorize source-level behavior changes without executable regression tests.

## 2. Readonly static field patterns — first executable subset

```atto
const record = ~record(status: 200, ready: true);
const result = match<int> record over
    on ~(status: 200, ready: true) -> 42;
    default -> 0;
end;
```

The `~(field: pattern, ...)` record pattern is a distinct AST node, never a Map literal, record constructor, or dynamic reflection request. In the initial executable subset each nested field pattern is a scalar literal or `_`; keys are static and unique, a field is projected at most once, and no field bindings or nested destructuring are enabled. Fields not listed in a pattern are unconstrained. Empty patterns, spreads, `=>`, computed field names, duplicate fields, and post-pattern field references are rejected until separate typing/ownership proofs exist.

- **Without `structural`**: subject must have a statically known readonly record shape. No implicit shape widening from mutable classes, Maps, host dictionaries, or actor references.
- **With `structural`**: `on structural ~(public_field: literal)` is allowed only for a statically proven record or ordinary non-actor nominal class with a visible public field of compatible type. The field is inspected under readonly projection. Protected/private fields, sealed actor state, uninitialized fields, external host objects and unknown/generic shapes are rejected. This marker never grants mutation authority.
- Literal tests and wildcard tests do not bind, move, copy or expose borrowed field values. General variable binding is future work and requires scope-lifetime, alias, non-escape, `await` and actor Send evidence.
- Runtime must not infer field visibility from host reflection or allow `Map<K,V>` to masquerade as a record.

## 3. Required implementation evidence

1. Parser and formatter round-trip a dedicated AST shape without confusing `~record(...)`, `~map<K,V>(...)`, unary `~`, or pattern `~(...)`.
2. Type and ownership passes independently reject invalid sources; runtime repeats the no-actor/no-host-capability guard.
3. For ordinary `match`, overlapping explicit structural patterns reject even when `default` exists. For `match first`, priority is intentional but unreachable later patterns reject.
4. Real guest tests must exercise field equality, missing fields, Symbol identity, negative compile paths, and actor/private-field projection denial.
5. LLVM, Wasm, Forge and .NET must each report exact source SHA plus runnable implementation or an explicit fail-closed feature gate. A parser rejection alone is NOT a parity pass.

## 4. Promotion gate

Keep the contract and implementation PRs **DRAFT** until full compiler/ownership, actor isolation, CTest/Java suite, Native Image and five-backend executable evidence exist. Selected-file exact-blob private carriers may prove only the subset they execute; do not claim a full tree or release gate.
