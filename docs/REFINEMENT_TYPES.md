# Constrained and refinement types (proposed source contract)

**Status: language-design contract only (2026-10-17).** This document does not claim that any current Oreslang compiler parses, checks, or lowers these forms. Every backend must fail closed on unsupported constructs, not silently erase constraints.

## Decision: three syntax families, one validated constraint model

1. Java-style annotations on a type alias or annotated declaration.
2. An Oreslang `with` clause for conjunctions of recognized primitive property constraints.
3. An explicitly nominal Rust-style `newtype` with generated checked `try_from` construction.

A separate `where` clause accepts richer, **pure and deterministic** predicates. `with` deliberately does *not* accept arbitrary expressions or helper-function calls. Annotation and `with` declarations may be combined, in which case constraints are conjunctive. The formatter should preserve the author's surface family where feasible; normalized typed HIR must carry identical constraint semantics regardless of input spelling.

### 1. Java-style annotations

```ores
@Size(min=1, max=32)
type Username = string;

@Size(min=10, max=10)
type Exact10 = string;

@NotEmpty
type NonEmpty = string;

@Length(eq=10)
type ExactlyTen = string;
```

`@Size` measures string code points, sequential container element counts, or map entries according to the base type. `@Length` is string-only. `@NotEmpty` means length/size > 0, **not** nonblank. `@Size` supports nonnegative compile-time constants `min` and `max`. `@Length` supports `eq`, `min`, and `max` as named arguments; multiple arguments are conjunctive, and contradictions are rejected. Exactly one `@Size` or `@Length` annotation is enough for the corresponding aliases. Unknown annotations do not silently create type guarantees; annotation resolution is explicit and closed-world for constraint annotations.

At declaration sites, `@Size`, `@Length` and `@NotEmpty` may also constrain typed fields, parameters and returns, as if the declared type were wrapped in the equivalent refinement. The implementation must type-check the full declaration boundary, rather than treating annotations as advisory Bean Validation metadata.

### 2. Built-in comparisons with `with`

```ores
type Foo = string with length eq 10;
type Bar = string with length gt 0;
type Username = string with length ge 1 and length le 32;
type Percentage = int with value ge 0 and value le 100;
type SmallMap = Map[string, int] with size le 100;
```

The supported comparison tokens are `eq`/`==`, `ne`/`!=`, `gt`/`>`, `ge`/`>=`, `lt`/`<`, `le`/`<=`. No other textual aliases are implicit.

`with` contains **only** recognized built-in properties and pure comparisons against compile-time constants, joined with `and`. No `or`, function call, indexing, mutation, arbitrary field projection, or free variables inside `with`. `length` measures logical string code points / sequence elements; `size` measures map entries; `value` refers to the constrained numeric value. A property not supported by the base type is a type error. Invalid comparisons (e.g. an integer length against a string) are type errors.

```ores
type EmptyImpossible = string with length lt 0;             // error: unsatisfiable
type Contradiction = string with length gt 10 and length lt 5; // error
```

Static normalization intersects known intervals and equalities, rejects impossible conjunctions, and checks entailment without needing general theorem proving.

### 3. General pure predicates with `where`

```ores
type NonBlank = string where it.trim().length > 0;
type EvenPositive = int where it > 0 and it % 2 == 0;
type OneOrThree = int where it == 1 or it == 3;
```

`it` is a lexically bound immutable value of the base type, available only inside the predicate; its result must be `bool`. `where` permits Boolean composition and approved pure expressions/functions (not `await`, actor sends/spawns, I/O, mutation, nondeterministic effects, reflection, host calls, or unsafe FFI). Pure helpers must be explicitly checked and bounded at evaluation; implementations must not accept unrestricted calls and then silently skip validation. If the compiler cannot prove a runtime expression satisfies a `where` predicate, the user must take the checked conversion path.

No general implication solver is promised for arbitrary `where` predicates. A constant expression may be evaluated at compile time only when evaluation is safe and bounded; otherwise the compiler rejects implicit conversion and permits explicit `try_from`.

### 4. Rust-style nominal `newtype` and `try_from`

```ores
define newtype Username(string)
    with length ge 1 and length le 32;

define newtype NonBlank(string)
    where it.trim().length > 0;

val raw: string = get_input();
val parsed: Result<Username, ConstraintError> =
    Username.try_from(raw);
```

`newtype` creates a **distinct nominal identity**. The compiler generates a checked `Name.try_from(Base): Result<Name, ConstraintError>` and an explicit owned unwrap (`into_inner()`). No unchecked constructor or silent conversion from `Base` is exposed, including via FFI, reflection, deserialization, unsafe foreign callbacks or actor messages. An unwrapping operation must honor Oreslang's take/borrow/ownership rules. An ordinary refinement alias (`type X = ...`) is **not** a nominal newtype.

A newtype may reuse a `with` or `where` predicate, or annotations:

```ores
@Size(min=1, max=32)
define newtype Username(string);
```

All three forms use one constraint evaluator; only the nominal wrapper differs. Avoid implicitly converting `Username` to an unrelated nominal `UserId` even when both wrap the same string and share identical constraints.

## Canonical typed representation

For example, these declarations have the **same refined alias semantics**, while `newtype` adds nominal identity:

```ores
@Size(min=10, max=10)
type A = string;

type B = string with length eq 10;

type C = string where it.length == 10;

define newtype D(string) with length eq 10;
```

Conceptual typed HIR:

```text
Refinement {
  base_type: String,
  predicate: And([Compare(Length(CodePoints), Eq, Int(10))]),
  alias_name: optional,
  nominal_id: optional (present only for newtype),
  validation_mode: ProofOrCheckedConstruction,
  predicate_effects: PureDeterministic
}
```

`where` can normalize to a built-in predicate when it is syntactically and semantically equivalent; otherwise it remains a typed, purity-checked predicate. The compiler must preserve the original source locations for errors. Refined aliases follow Oreslang's alias and structural-call policy; refinement entailment is *additional* to, not a blanket replacement for, existing nominal identity checks on classes, interfaces and nominal newtypes.

## Assignability, validation and runtime invariants

- A provably valid compile-time constant can initialize a refined alias. A provably invalid one is a compile error.
- The compiler may assign an existing constrained value to a *weaker compatible refinement* when it proves implication, e.g. length eq 10 implies length gt 0. Do not treat plain `string` as `NonEmpty`.
- Unknown runtime values must pass an explicit checked conversion, e.g. `NonEmpty.try_from(raw)` returning `Result<NonEmpty, ConstraintError>`; no compiler-inserted validation at a random implicit conversion or function boundary.
- Successful checking establishes the invariant; repeated checks on immutable strings are unnecessary. Invalid values cannot be constructed by unchecked casts, incomplete decoders, or stale hot-reload generations.
- For mutable collections, a refined reference is valid only if the compiler/runtime can preserve its length/size invariant through every mutation and alias (including borrows and shared handles). Until that enforcement exists, **disallow mutating operations that may invalidate the refinement**. Never validate once and then permit an unchecked append/remove/clear.
- Validate at untrusted boundaries (serialization, deserialization, FFI, actor send/receive, imported artifacts), respecting actor ownership and isolation. Reflection or reinterpretation cannot strip a nominal newtype while preserving access as that type.
- Constraint failures carry a structured `ConstraintError` with type identity, property, expected predicate, and actual evidence when safe to expose. Do not leak secrets in default error strings.
- Public refined type predicates, code-point-length semantics, annotation normalization rules, nominal IDs and predicate signatures are part of the exported ABI and hot-reload compatibility fingerprint. Narrowing a constraint is not a silent compatible reload.
- Comparison against NaN or nonfinite numeric values needs deliberate numeric semantics; a numeric refinement must not accidentally accept NaN because bounds comparisons return false or throw inconsistently.

### String length across implementations

`string.length`, `@Size` and `with length` count **Unicode scalar values (code points)** consistently across Java, LLVM, .NET, Wasm and experimental backends, not UTF-16 code units or UTF-8 bytes. A grapheme/byte-length property may be introduced separately with a versioned definition. Normalization (NFC/NFD) is not implicitly performed. For example, `"😀"` has length 1; `"e\u0301"` has length 2.

## Parser-level sketch (not current grammar)

```ebnf
type_alias      = annotations? "type" IDENT "=" type_expr (with_clause | where_clause)? ";" ;
newtype_decl    = annotations? "define" "newtype" IDENT "(" type_expr ")" (with_clause | where_clause)? ";" ;
with_clause     = "with" property_cmp ("and" property_cmp)* ;
property_cmp    = BUILTIN_PROPERTY COMPARATOR compile_time_constant ;
where_clause    = "where" pure_boolean_expr ;
COMPARATOR      = "eq" | "ne" | "gt" | "ge" | "lt" | "le"
                | "==" | "!=" | ">" | ">=" | "<" | "<=" ;
```

For the initial release, use either `with` or `where` per declaration; annotations can be stacked and compose conjunctively. Parentheses and `or` belong to `where`, not `with`. Refinements must bind more tightly than a surrounding union/intersection unless the user explicitly parenthesizes. Definition grammar, formatter and reserved-keyword changes require parser and conformance tests before shipping.

## Required conformance cases

| Case | Expected |
| --- | --- |
| `@Size(min=10,max=10)`, `with length eq 10`, `where it.length == 10` | equivalent valid/invalid string outcomes |
| `eq 10`, `== 10`, `ge 1`, `>= 1` | operators normalize identically |
| empty string for NonEmpty | compile error if literal; `Err` for dynamic `try_from` |
| length 10 value to length > 0 alias | allowed when alias/underlying type rules permit |
| plain dynamic string to NonEmpty | static type error without `try_from` |
| two distinct constrained newtypes | never implicitly interchangeable |
| `with length gt 0 or length eq 10` | syntax error (use `where`) |
| `with length gt foo()` | syntax error |
| `where` with I/O, mutation, actor send, `await` or nondeterminism | rejected |
| contradictory interval / negative size / wrong property type | rejected at compile time |
| multi-codepoint, emoji, combining-mark examples | identical across backends |
| mutate length-constrained collection without invariant-preserving API | rejected |
| invalid deserialization/FFI/actor payload | rejection with no bypass |
| narrowed hot-reload contract | ABI invalidation / incompatibility |
| unsupported syntax in incomplete backend | explicit diagnostic; no IR or execution |

## Implementation sequence and parity evidence

1. Shared spec and golden parse/normalize/negative-source fixtures in `oreslang-common-source`; no false claims of common compiler code.
2. Java lexer/parser/formatter + typed constraint HIR + compile-time constant proof + generated dynamic `try_from` + runtime checks.
3. Java annotation desugaring, nominal newtype typing, `where` purity/effects checks, actor/serialization/hot-reload enforcement.
4. LLVM/.NET/Forge frontends independently parse and lower what they can **only after** conformance; otherwise fail closed. Wasm inherits compiler admission from LLVM and must still verify runtime boundaries.
5. Differential acceptance, rejection and runtime-failure tests (Unicode, mutation, alias/newtype distinctions, deserialization, cross-generation ABI) with linked evidence artifacts.

**No part of this document means the current Java/LLVM/.NET/Forge/Wasm backend implements refinements.** Track each implementation separately, and distinguish parser recognition, type-checker enforcement, executable runtime enforcement, and cross-backend parity.


## Zorde runtime validation bridge

The canonical runtime validation library for these constraints is **Zorde**,
implemented in oreslang-serialization-and-validation. Compiler refinements and
Zorde schemas must share one normalized predicate contract rather than drift
into separate static and runtime rule systems.

The compiler should emit a static, reflection-free validator descriptor for
every exported refinement/newtype that requires runtime construction. Zorde
uses that descriptor at explicit trust boundaries (decode, FFI, actor DATA,
HTTP/RPC, database/config input, hot-reload migration). Compile-time constants
and proven refinement-to-refinement assignments do not need runtime checks.

The first mechanical mappings are:

| Refinement IR | Zorde rule |
| --- | --- |
| string length eq N | min_length=N, max_length=N |
| string length gt N | min_length=N+1 |
| string length ge N | min_length=N |
| string length lt N | max_length=N-1 |
| string length le N | max_length=N |
| numeric lower/upper interval | inclusive/exclusive numeric range |
| sequence length bounds | min_items/max_items |

Excluded-value ne predicates, map-size predicates, arbitrary where predicates,
and cross-field predicates must have explicit runtime representations before a
backend may claim Zorde parity. Unsupported constraints fail closed.

A future zorde.schema<T>() surface is compiler-generated metadata, not runtime
reflection. Its schema fingerprint participates in public ABI and hot-reload
compatibility.
