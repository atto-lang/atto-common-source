# AttoLang tilde map/record literals and explicit structural matching v1

**Status: DRAFT LANGUAGE PROPOSAL — NOT EXECUTABLE, NOT CERTIFIED.**
**Scope: additive frontend syntax, canonical formatting and semantic conformance targets; not an implemented runtime or an authorization to merge.**

This contract specifies a compact literal family for typed dynamic maps and closed readonly structural records, together with matching that retains the canonical `match ... over`, `on`, and `default` spellings. It builds on [JSON/record/map](../../docs/JSON_RECORD_MAP_V1.md), [structural/infer/spread interop](STRUCTURAL_INFER_AGGREGATE_INTEROP_V1.md) and [immutable aggregate spread](IMMUTABLE_AGGREGATE_SPREAD_V1.md). Their type, ownership, field visibility and allocation protections remain authoritative.

## Surface and canonical examples

~~~atto
// Inferred, readonly, statically named structural record:
const user = ~(name: "Ada", age: 37, active: true);

// Typed dynamically keyed map:
const flags = ~("ready" => true, "done" => false);

// Explicit unambiguous versions, including empty aggregates:
const row = ~record(id: 42, active: true);
const by_symbol = ~map(#ready => true, #done => false);
const empty_row = ~record();
const Map<String, int> empty_map = ~map();

// Structs, tuples and Entry<K,V> are NOT aliases of either literal:
const point = infer struct{x: 1, y: 2};
const pair = ("request", 42);
const entry = Entry.of("request", 42);
~~~

**Recommended canonical output:** preserve short nonempty `~(...)` forms; use `~map(...)` and `~record(...)` when explicitly authored, required for clarity, or empty. Keep explicit kind spellings available; neither `~` nor inferred syntax introduces runtime reflection or nominal type identity.

## Parsing and static kind selection

~~~ebnf
tilde_literal  ::= "~" "(" nonempty_aggregate_elements ")"
                 | "~map" "(" map_elements? ")"
                 | "~record" "(" record_elements? ")"
record_element ::= static_field ":" expression | "..." expression
map_element    ::= expression "=>" expression
record_elements ::= record_element ("," record_element)* ","?
map_elements    ::= map_element ("," map_element)* ","?
nonempty_aggregate_elements ::= record_elements | map_elements

match_expression ::= "match" ("first")? ("<" type ">")? expression "over"
                     on_arm* default_arm? "end"
on_arm           ::= "on" ("structural")? pattern ("when" guard)? "->" body
default_arm      ::= "default" "->" body
record_pattern   ::= "~(" static_field ":" field_pattern ("," ...)* ")"
                   | "~record(" static_field ":" field_pattern ("," ...)* ")"
~~~

The punctuation `:` between static field names and expressions selects a **record**; `=>` between evaluated key expressions and value expressions selects a **Map<K,V>**. These are distinct typed AST forms. Neither is inferred from the other by runtime inspection.

- An unquoted identifier to the left of `=>` is **an evaluated variable expression**. For instance, with `key = "hello"`, `~(key => 1)` maps the string value "hello" to 1, while `~(key: 1)` creates a record field literally named `key`.
- `#ready => true` uses an AttoLang `Symbol` key; it does not create a String key or confer JSON object-key status. Key-domain inference and admission remain typed; `Map<Symbol, V>` is distinct from `Map<String,V>`.
- Static record fields use only the existing admissible identifier or quoted static string field names and their existing encoding/length checks. Runtime-computed record field names are forbidden.
- No mixed `:`/`=>` entries in one literal, even with explicit `~map` or `~record`; diagnose before typing/IR.
- Bare `~()` is reserved and rejected **even with expected type context** in v1; `~map()` requires an expected or explicit key/value type when inference has no entries, while `~record()` denotes the empty closed record.
- A map literal is allocator-backed when its representation requires storage; it is **not** an inline record or nominal struct. The typed canonical Map runtime must be used, not a second host-language Map.
- The `=>` token retains its preexisting *type-level* function signature meaning outside this tilde-map-element context. Executable match arms keep `->`. Tilde literal recognition must not hijack unary operators, interpolated strings or other lexemes; lexers must prove ambiguity-free tokenization.
- Existing `record{...}`, `infer record{...}`, `infer struct{...}`, explicit `struct{...}{...}`, `new Map<K,V>()` and other approved constructors stay source-compatible. Formatter may canonicalize new tilde forms without rewriting older accepted source unless a separately approved migration opts in.
- In record tilde literals, `...` statically spreads fields under the already-approved aggregate-spread rules: source-order effects, last-spread-wins, duplicate explicitly written field rejection, and complete ownership/authority proofs. **Map spreads are not admitted in v1**; define their atomic collision/ownership behavior in a separate version.
- `~map(K => V)` infers one compatible K and one compatible V under the type checker; no silent Any/Unknown key/value fallback, numeric narrowing, or implicit String↔Symbol conversion. For heterogeneous values, require an explicitly valid union or target type.
- Map keys must satisfy the existing stable equality/hash eligibility rules; mutable state which can invalidate a key's hash/equality is not admitted. Repeated compile-time-known equal keys must be diagnosed. For computed equal keys, this proposal chooses fail-before-publication duplicate rejection, not silent last-wins, subject to runtime implementation review. Successful construction evaluates each key and value once in source order and publishes the map only after all admissions succeed.

## Canonical match syntax and structural semantics

~~~atto
return match<int> response over
    on ~(status: 200, body: body) -> body.size()
    on ~(status: 404) -> 0
    default -> -1
end;

// When matching a nominal struct/class by visible field shape, say structural:
match first response over
    on structural ~(status: 200, body: body) -> {
        handle_success(body);
    }
    on structural ~(status: 404) -> {
        handle_missing();
    }
    default -> {
        handle_other();
    }
end

define interface HasId
    id: int;
end
fnc read_id(structural HasId item): int {
    return item.id;
}
~~~

**`on ~(name: pattern)`** is a record-field pattern, and is not implicit permission to retype a nominal struct/class as a record. **`on structural ~(name: pattern)`** requests an explicit readonly, scoped structural projection: the scrutinee must have type-checker-proven visible fields with compatible types. The marker clarifies intent; it is not a constructor or a conversion and may not be erased from the AST.

- `structural` is optional for a known record scrutinee; it is **required** for intentional cross-nominal public-field matching, including where a nominal receiver has a similar visible shape.
- Match projection grants no private, protected, hidden, sealed-actor-state or dynamic reflection access. An actor's state must still use the sealed critical-read/critical-write access protocol. No structural authority escalation through casts, generics or imported aliases.
- Captured fields are scoped readonly borrows/ownership aliases unless the compiler explicitly proves an authorized move from an owned scrutinee. No implicit field copy of move-only values, no escaping loans, actor sends, suspension or returning a borrowed structural view.
- `match value over` retains proof-checked, disjoint/exhaustive matching. `match first value over` retains ordered priority matching; a guarded arm must obey the existing purity, effect and static-proof policy. Pattern bindings evaluate the scrutinee once.
- Every explicit arm starts with `on`. Only the optional, final, unguarded fallback starts with `default ->`, without `on`. At most one `default`, always last. Existing legacy `on _` / `else` fallback forms may be accepted under compatibility policy and normalized only when semantically equivalent; `on default` and a missing `over` are not canonical.
- `on ~map(...)` remains **reserved, NOT IMPLEMENTED in v1**: dynamic key presence, collisions, effects, borrows, and membership semantics require their own proof and fixture contract. Do not mistake `on ~(key => value)` for record matching or accept it as a map pattern by accident.
- Overlapping explicit record field patterns with a default are still overlapping; the default does not waive proof obligations. Use `match first` for intentional priority.

## Representation and ownership invariant

Static record field order is not record type identity. The canonical sorted field/descriptor order is independent of source-ordered evaluation and must not expose private fields. Records remain readonly structural values and can use inline or compiler-selected layouts; structs remain exact concrete shapes / nominal where declared; tuples are positional; `Entry<K,V>` remains an independent nominal two-slot product; Maps remain typed dynamic key/value collections.

Do not materialize record literals as generic host dictionaries, or flatten Map/Entry/structural borrowed views into forged primitive handles. Move-only fields and Map inserts require all admission checks and cleanup before publication. Failures, cancellation, panic/raise/throw and quota/allocator exhaustion must not double-drop, leak references, resurrect moved values or publish partially initialized aggregates. Map literal construction must honor existing Map ownership and graph-stability contracts, not silently broaden the special JsonValue commit/recovery proof to arbitrary values. Actor heaps, isolation and Sendable/Serializable authorization remain independent of apparent aggregate syntax.

## Normative fixture and promotion contract

Machine-readable source expectations live in [fixtures/tilde-aggregate-match-v1/manifest.json](../../fixtures/tilde-aggregate-match-v1/manifest.json).

Required gates, independently for **Java/GraalVM, LLVM, Wasm32, Forge, and .NET NativeAOT**:

1. Lexer/parser positive and malformed-token negative fixtures, including function-type `=>` and match `->` coexistence, tuple parentheses, unary `~` collisions where applicable, empty/mixed literal rejections and compatibility syntax.
2. Typechecker checks for literal selection, field/key typing, readonly versus nominal identity, `structural` visibility, exact record shape, overlapping/exhaustive match arms, guards and unambiguous bindings.
3. Full ownership checker: disjoint/projection borrows, partial moves, unhashable mutable map keys, transactional cleanup under duplicate/OOM/throw and actor-domain escapes. Negative compilation must produce nonzero diagnostics **without** codegen or executable artifact.
4. Formatter parse-print-parse stable AST equivalence; preserve old forms unless migration explicitly enabled. Optimization/AOT and nested copy/move cases must retain source-order evaluation.
5. Actual compiled, executed guest tests and exact-head evidence with compiler source SHA, fixture bytes, run/job IDs, executed step counts, expected outputs/exit statuses, and ABI/lifetime/serde checks. Source-free/model/parser evidence is NOT_EXECUTED or NOT_CERTIFIED for positive runtime claims.

All evidence is **NOT_EXECUTED / NOT_CERTIFIED** until separately run and verified. No changes to production compiler/runtime, no claimed five-backend acceptance, and no private-source mirror or security-policy relaxation are authorized by this proposal.

## Decisions to revisit in review

- Whether duplicate runtime-equal computed keys reject (recommended) or use another explicitly specified transactional policy.
- Whether expected-type empty `~()` deserves a future unambiguous extension; rejected in v1.
- Whether maps need a separate, typed and proof-checked `on ~map(...)` pattern syntax in v2.
- Whether formatter should preserve explicitly authored `~map` / `~record` always or prefer short nonempty forms only on opt-in.

The proposed syntax is additive and reviewable; implementing it should begin with a shared AST/grammar contract, not ad-hoc backend desugaring.
