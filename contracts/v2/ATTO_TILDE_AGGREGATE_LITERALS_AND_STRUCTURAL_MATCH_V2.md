# AttoLang tilde aggregate literals and structural matching — optional extensions v2

**Status: DRAFT PROPOSAL / SOURCE-CONTRACT ONLY / NOT_EXECUTED / NOT_CERTIFIED.**
**Parent:** [v1 contract](../v1/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V1.md). V2 is a proposed, independently gated extension. Nothing here silently changes the v1 accepted language, existing compiler release, or required backend support.

## Additions

1. **Explicit map generic arguments**: `~map<K,V>(entries...)` and `~map<K,V>()` set exact key/value domains, especially for empty maps. Type arguments are resolved by the compiler; no reified host reflection or unchecked casts. `~map()` remains legal only when expected `Map<K,V>` is known. Bare `~()` remains forbidden, even when an expected type exists.
2. **Map spread** in the explicit form `~map(...source, key => value)`: source must be a typed, currently accessible Map with compatible `K,V`. Spread is evaluated once and enumerates the source's admitted snapshot in canonical insertion order. `~(...source)` remains forbidden because no `:` or `=>` discriminates the kind. No implicit Map-to-record or record-to-Map conversion. This is a *target* contract, not currently enabled by v1.
3. **Constant-key map patterns**: `on ~map(const_key => pattern, ...)` can inspect a typed Map by presence and value without extracting mutable authority. `const_key` must be a compile-time-known scalar/symbol key expression (v2 first slice: integer, literal String, `#symbol`, or their statically proved constant aliases); computed calls, mutation and potentially unstable keys reject. Maps are not records, so `structural` is neither necessary nor accepted before `~map`. A pattern is a **partial mapping view**: unmentioned keys may exist. An empty map pattern is forbidden; use `default`.
4. **Nested products/patterns**: readonly records may contain records, tuples, Option/Result or maps when every component has an admitted type and ownership proof. `on structural ~(meta: ~(ready: true))` recursively projects only statically visible, readonly fields; no implicit map/record shape equivalence. A nested `~map(...)` pattern follows the separate key/presence rules.
5. **Explicit bounded iteration/view rules**: map pattern matching observes one coherent, immutable borrowed snapshot or a backend-proven version-fenced read. It must not call guest equality/hash functions while container locks are held. Invalid/hot-reloaded key domains fail before comparison and a concurrent map mutation cannot create a torn match.
6. **Predictable constructor/formatter behavior**: `~record(foo: v)` and `~(foo: v)` both construct closed readonly records; `~map(k => v)`, `~(k => v)`, and `~map<K,V>(k => v)` construct typed maps. Formatter preserves explicitly typed `~map<K,V>` and explicit `~map`/`~record` spelling, does not turn legacy `record{...}` into `~record(...)` without opt-in, and round-trips nested patterns.

## Examples (normative target programs, NOT proof they compile)

~~~atto
const Map<String,int> empty = ~map<String,int>();
const counts = ~map<String,int>("a" => 1, "b" => 2);
const more = ~map<String,int>(...counts, "c" => 3);
const nested = ~record(
    identity: ~(id: 42, active: true),
    options: ~map<String,bool>("verbose" => true)
);

const int result = match<int> nested over
    on structural ~(identity: ~(id: 42, active: true)) -> 42
    default -> 0
end;

const int flag = match first counts over
    on ~map("a" => 1, "b" => n) when n > 1 -> n
    on ~map("a" => 1) -> 1
    default -> 0
end;
~~~

Ordinary `match ... over` keeps proof-checked disjointness and exhaustiveness; `match first ... over` permits ordered overlapping arms. Each explicit arm begins with `on`, fallback is `default ->` alone, last and unguarded. The first matching arm may borrow projected values for the scope of the arm, never silently move owned map values through a read.

## Grammar sketch (contextual, no global operator changes)

~~~ebnf
tilde_record ::= "~record" "(" record_elements? ")" | "~(" record_elements_nonempty ")"
tilde_map    ::= "~map" map_type_args? "(" map_elements? ")" | "~(" map_elements_nonempty ")"
map_type_args ::= "<" Type "," Type ">"
map_elements ::= (map_entry | map_spread) ("," (map_entry | map_spread))* ","?
map_entry ::= Expr "=>" Expr
map_spread ::= "..." Expr    // only inside explicit ~map in v2
record_elements ::= (static_field ":" Expr | "..." Expr) ("," ...)* ","?
map_pattern ::= "~map" "(" const_key "=>" Pattern ("," const_key "=>" Pattern)* ","? ")"
~~~

In a `~map` *pattern*, generic type arguments are not permitted in v2; the scrutinee supplies the map key/value types. A `~map` *constructor* with generic arguments is compile-time typed and may use spreads.

The normal function type `(K) => V`, executable match arm `->`, unary bitwise syntax if present, tuple parentheses and operator precedence stay unchanged. Scan `~map<...>(` as a dedicated contextual literal head; it is not a callable method, macro, free-text sigil, or type-erased dynamic object.

## Collision, order, ownership, and failure

- The **duplicate-key policy remains fail-closed**, including collisions between one or more spreads, computed entries and literal keys. Compare under the existing Map key stable Eq/Hash contract and reject duplicate effective keys before publication. No silent overwrite/last-wins; explicit `map.put` remains the update operation with the previously specified transactional ownership behavior.
- Each source spread and key/value expression is evaluated once, left-to-right. Map spreads preserve their source iteration order, and new entries append; this is not a promise that two distinct maps' insertion order is equal.
- Construction is **transactional**: create an unobservable candidate, validate all keys, storage, graph quotas, ownership moves, stable hash identities, duplicate keys, and domain permissions before publishing. On collision, throw, raise, panic, cancellation or OOM, leave all unconsumed source owners valid; release temporary acquisitions exactly once, never publish a half-constructed Map.
- A map spread of move-only values must explicitly be `rt copy`, `rt share`, or `rt take` under corresponding fully proven type and source ownership rules; the shorthand `...map` never manufactures extra owners. No cross-actor heap/tenant/isolate allocation escape.
- Map patterns borrow; they must not consume the source map or transfer move-only members implicitly. Keys must be well typed and stable; equality and hash operations must not call guest code under implementation locks. No hash-flood, recursion-depth, cancellation or quota bypass.
- Records retain closed structural readonly semantics, canonical field-identity metadata and static-visibility bounds. Nominal structs stay nominal. `structural` is required for deliberate cross-nominal readonly field projection, optional when the scrutinee is already a statically known record. Do not permit structural projection through private class fields or sealed actor state.
- `on ~map()`, `on structural ~map(...)`, `~map<K>()`, `~map<String,bool>(id:42)`, bare `~()`, and map-spread inference from a bare `~(...m)` are errors. Compile-time-known duplicate keys in map patterns are errors; runtime computed pattern keys are not allowed.
- JSON conversion retains its established String-key domain: `Map<Symbol,V>` is not a JSON object without an explicit key codec. This proposal introduces no implicit JSON normalization.

## Implementation gates

The authoritative machine-readable v2 extension targets live in [fixtures/tilde-aggregate-match-v2/manifest.json](../../fixtures/tilde-aggregate-match-v2/manifest.json). The adjacent `tools/tilde_literal_reference.py` parser is explicitly **a small host-side syntax reference for its own fixture sublanguage, not an AttoLang compiler, type checker, borrow checker, or guest interpreter**. Its passing tests cannot promote runtime support.

For every backend Java/GraalVM, LLVM, Wasm32, Forge and .NET Native AOT: prove lexer/parser/formatter and exact AST source preservation, typed Map constructor, exhaustive/priority pattern semantics, stable key Eq/Hash, nonescaping borrows, transactional map spread rollback, negative rejected codegen, actor ownership/security boundaries, deterministic serialization, and real AOT/guest execution with the exact checked source head and executed runner job steps. Do not interpret a host-only reference check, mirror, parser acceptance, or zero-step Actions failure as successful native compiler evidence.
