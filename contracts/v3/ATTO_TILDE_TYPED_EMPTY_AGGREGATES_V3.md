# AttoLang tilde aggregate constructors: explicit kind and typed-empty selection v3

**Status: DRAFT LANGUAGE CONTRACT / SOURCE-ONLY PROPOSAL / NOT_EXECUTED / NOT_CERTIFIED.**
**Supersedes only the empty-constructor selection rule** in [v1](../v1/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V1.md) and the [v2 extension](../v2/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V2.md). All existing ownership, typing, actor isolation, AOT, map collision and runtime requirements remain in force.

## Chosen syntax and disambiguation

```atto
const empty_record = ~record();                    // closed readonly zero-field record
const empty_tuple = ~tuple();                      // zero-arity tuple
const Map<Symbol, bool> flags = ~map();             // typed empty Map, using expected type

type EmptyRow = {};
const EmptyRow row = ~<EmptyRow>();                 // type-directed empty record

type EmptyPair = [];
const EmptyPair pair = ~<EmptyPair>();             // type-directed empty tuple

const Map<string, int> scores = ~<Map<string,int>>(); // type-directed empty map

// Generic T must be statically constrained to one supported, empty-constructible
// aggregate kind; a naked unconstrained T is NOT sufficient proof.
fnc make_empty<T: EmptyAggregate>(): T {
    return ~<T>();
}
```

The above is **proposed semantics**, not evidence that any backend compiles the examples. The `EmptyAggregate` bound is a **conceptual compiler-known type constraint**, not a claim that this trait/interface currently exists in AttoLang. A future implementation may express the bound with the project's approved constraint syntax instead.

- `~()` is **always rejected**, including when an expected type exists. It has no explicit kind or type argument and cannot select a storage/ownership representation.
- `~record()` is a zero-field closed readonly record, with no dynamic object shape or hidden nominal identity.
- `~tuple()` is a distinct zero-element tuple, not a record, pair/entry, list or map.
- `~map()` is admitted only if expected `Map<K,V>` type (or an equivalent compiler-resolved canonical map type) uniquely supplies key and value domains. No fallback to `Map<Any,Any>`, Java host Map or reflection. `~map<K,V>()` remains the explicit-key/value alternative introduced in v2.
- `~<T>()` uses **exactly one** compile-time type argument. The compiler fully resolves `T`, following valid lexical aliases, imported type aliases, generics and their bounds, before choosing the aggregate's kind. It must prove one and only one of: Map, closed readonly Record, or Tuple. No runtime heuristic dispatch, tagged-object guessing, nominal class construction, or structural downcast.
- `~<T>()` requires the selected aggregate to have a legal **zero-argument constructor**. A nonempty record `{name: string}` and nonempty tuple `[int, bool]` are not zero-initializable merely because they are typed. No `null`, `undefined`, implicit default field, `Any`, or synthesized move-only value. Future explicit defaults require their own proof.
- A generic variable `T` is legal only if its resolved bound provides the unique aggregate kind **and** empty-construction capability, including all `K/V` domains for Maps. Unbounded or union/intersection `T` with multiple possible kinds, recursive aliases, unknown/incomplete imports, nominal types, or unsafe ownership constraints must fail before lowering.
- `~<T>()` with `T = Map<K,V>` constructs the same canonical typed map as `~map<K,V>()`; `T = {}` constructs a zero-field readonly record; `T = []` constructs a zero-arity tuple. Type aliases do not create new runtime aggregate kinds. The compiler retains the explicit type witness through typed HIR and ownership analysis instead of erasing it at the parser.
- For nonempty literals, retain `~(field: value)` and `~(key => value)` shorthand selected by separators, alongside `~record(...)`, `~map(...)`, and `~tuple(items...)`. `~tuple(1, 2)` is always a two-element tuple and is not interchangeable with a pair/Entry nominal type.
- The formatter preserves an explicitly authored `~<T>()` witness and explicit `~map`, `~record`, `~tuple` spelling; do not rewrite these to ambiguous `~()`. Legacy tuple or record constructors should not be changed without opt-in.

## Parser/typing contract

```ebnf
tilde_explicit_empty ::= "~record" "(" ")"
                       | "~tuple" "(" ")"
                       | "~map" map_type_args? "(" ")"
                       | "~" "<" Type ">" "(" ")"
tilde_tuple          ::= "~tuple" "(" (Expr ("," Expr)* ","?)? ")"
typed_empty          ::= "~" "<" Type ">" "(" ")"
```

The lexical head `~<` introduces an explicit typed aggregate constructor. It is not an extension of unary bitwise complement or an operator comparison; the parser must preserve that boundary. Generic closing `>` nesting, unusual type shapes, whitespace, formatting and interpolations must not create ambiguity with `->`, `=>`, `<`, `>`, or ordinary generic calls. Typed empty constructor admits **zero** runtime arguments; use the explicit aggregate kind for nonempty construction.

## Required negative and positive verification vectors

| Case | Target | Reason |
|---|---|---|
| `~()` | reject | missing kind/type witness |
| `~record()` | accept | empty record |
| `~tuple()` | accept | zero tuple |
| `~map()` without expected type | reject | missing K/V domains |
| `const Map<string,int> m = ~map()` | accept | expected typed map |
| `~map<string,int>()` | accept | explicit domains |
| `~<{}>()` | accept | empty closed readonly record type |
| `~<[]>()` | accept | empty tuple type |
| `~<Map<string,int>>()` | accept | fully typed empty map |
| `~<{id: int}>()` | reject | required field would be uninitialized |
| `~<[int]>()` | reject | required positional element |
| `~<Unknown>()` | reject | no resolved type witness |
| `~<T>()` with bound proving empty Map | accept | unique kind and key/value domains |
| `~<T>()` with unconstrained T | reject | no aggregate proof |
| `~<Map<string>>()` | reject | incomplete key/value domains |
| `~tuple(1, 2)` | accept | exact two-slot tuple |
| `~(a: 1)` | accept | nonempty record, static-field separator |
| `~("a" => 1)` | accept | nonempty map, dynamic-key separator |

All positive cases are **language acceptance targets**, not a statement of implemented syntax.

## Security, ownership and promotion

- Direct or generic type witnesses do not elevate mutable access to readonly records, bypass actor-state seals, introduce mutable aliasing, or weaken the borrow checker.
- Zero-element Maps still use the actual typed Map guest runtime and allocate only under the same policy as other Maps. Map equality/hash obligations apply at insert; all runtime bounds, quotas and permissions must remain enforced.
- Empty tuples and records are canonical values with no implicit owner creation for absent fields; no default construction of capabilities or borrowed values.
- Every backend must retain type-witness provenance through HIR/MIR, prove lifetime and layout consistency, and reject invalid constructors before code generation.
- Java/GraalVM, LLVM, Wasm32, Forge and .NET NativeAOT each require exact-head **executed guest tests**, including negative compilation, formatter parse/print/parse, type-alias and generic-bound cases, and native AOT execution as applicable.
- A parse-only implementation, source manifest, model/reference parser test or CI zero-step failure is **NOT_EXECUTED** evidence for guest semantics. Do not merge as a certified feature until all required runtime/ownership gates pass.
