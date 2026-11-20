# AttoLang structural / infer / aggregate spread interop v1

Status: **proposed semantics; not four-backend executable parity** (2026-11-01).
This document clarifies the already-merged
[immutable aggregate spread contract](IMMUTABLE_AGGREGATE_SPREAD_V1.md).
Its fixture matrix is a target, not a claim that an existing compiler passes.

## Orthogonal keywords

- **`infer`** requests compile-time creation/capture of an exact, closed inline
  struct or readonly record type. `infer struct{...}` is the canonical anonymous
  struct constructor; `infer record{...}` explicitly documents inference for
  a record. The existing `record{...}` shorthand remains valid and infers its
  record shape; do not silently break existing programs.
- **`structural`** means explicit readonly structural matching for a parameter,
  match pattern or callable contract. It is **not** a constructor, an ownership
  qualifier, or implicit conversion from a nominal declaration. Unmarked
  parameters stay nominal. A structural view cannot be stored, sent, mutated,
  returned as an escaped borrow, or held across suspension.
- **`...`** inside an aggregate initializer is a field spread, not tuple
  argument expansion. The operand's complete, accessible, closed schema must
  be known statically, even if its runtime representation is not an object.

```ores
define interface HasId
    id: int;
end

fnc read_id(structural HasId item): int {
    return item.id;
}

pub fnc main(): int {
    const first = infer struct{id: 40};
    const next = infer struct{...first, extra: 2};
    const row = infer record{...next, id: 42};
    return read_id(row);
}
```

## Result type inference

For each named field `k: expression`, infer the checked expression type. For
each spread operand, merge its statically admitted visible fields. Process
elements left-to-right; the **last assignment wins**, even when its type differs.
A new exact row type is computed from the final map, not from the base type.
Explicitly named duplicate fields in a single initializer are invalid (two
different spreads containing the same key are permitted). The original source
is unchanged. Constructor side effects occur once in lexical order even when
subsequent writes override a value; no partial result is published on failure.

- An inferred **struct** is an exact concrete shape; no implicit width-erasure.
  A nominal named struct retains its declared identity. Explicit declared
  shapes must match exactly and preserve specified field types.
- A **record** is a readonly, structurally compared value. Field order does not
  change shape equality. `infer<T>` and short lexical aliases may bind a
  generated shape only under existing name-resolution and scope rules.
- A `structural Shape` parameter can project *public* matching fields of an
  inferred value as a scoped readonly loan, if a backend proves visibility,
  field-type compatibility, and lifetime safety. A view whose known schema is
  narrower than its runtime carrier may spread only the statically exposed
  fields; runtime host-field enumeration is prohibited.

## Ownership and allocation: Box / Arc / dyn

**None is needed for ordinary scalar inline fields or scalar Copy-safe spreads.**
`infer` is a static type operation, not a heap-allocation request.

- `Box<T>`: explicit owned heap indirection when the value must be boxed, e.g.
  recursive or long-lived shapes. It never authorizes an implicit clone or an
  actor-heap escape. A spread of non-Copy boxed fields needs an explicit,
  checked copy, share or ownership transfer.
- `Arc<T>`: explicit shared immutable ownership when multiple live owners
  require it; any underlying allocation and reference count must live in a
  domain safe for all owners. An actor's private arena cannot be kept alive
  merely by fabricating an Arc. Destruction, cycles, atomicity and actor-send
  checks belong to the ownership/runtime contracts.
- `dyn` / dynamic open rows: **not** a substitute for `infer`. A `dyn` value
  with an unknown schema must fail aggregate-spread admission. An explicit
  statically checked shape projection may be added in a future version; no
  runtime reflection, dictionary lookup, or unsafe type erasure is permitted
  by this contract.

For non-Copy fields, use existing `rt copy`, `rt share`, `rt take` rules only
when checker proofs allow them. Transactional cleanup must release acquired
fields exactly once on throw, raise, panic, cancel and allocation failure.
Do not implicitly use tracing GC, dynamically boxed host objects, or a global
shared arena. All actor-domain, `Sendable` and zero-GC limits still apply.

## Shared implementation / proof interface

1. Parse `infer`, `structural`, object literal kind and each spread as separate
   AST data; never use a sentinel field, magic string or host Map.
2. Type check the complete unit, compute a closed shape, mark lexical aliases,
   and reject unknown/invalid fields, nominal mismatches or wrong borrow modes.
3. Ownership check all fields and effects, then bind admission to the complete
   compilation unit and exact AST identity. Do not reuse approval after
   tree-shaking or parsing the same bytes into another program.
4. Lower source-ordered one-shot evaluations and deterministic final slots.
   Field layout order is unsigned UTF-8/Unicode scalar lexicographic order,
   independent of source evaluation order. Validate exact final field count
   and types before publishing a result.
5. Verify real guest acceptance *and* negative rejection at exact commit/tree
   across Java/Graal, LLVM, .NET Native AOT, and Wasm32. Compiler refusal alone
   is valid negative evidence, **never positive implementation parity**.
   A no-step Actions run, static manifest test, host mock, or unreviewed private
   cross-org mirror cannot promote the status.

Existing integration staging: Java draft #1880/#1882 (scalar Copy-safe spread),
LLVM aggregate-kind draft #1114 and current native fail-closed test,
Wasm compiler bridge rejection, and .NET scalar/structured admission rejection.
Build a versioned, typed row descriptor and checked construction plan before
promoting generic, nested, dynamically sized or non-Copy spread.
