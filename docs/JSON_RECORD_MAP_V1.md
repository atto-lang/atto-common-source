# JSON, typed records/structs/classes, and dynamic Map — contract v1

**Status: normative design contract; implementation is staged behind typed Map and allocator/library-layer work.**

## Layer decision

JSON is **OS-independent but allocation-dependent**. Therefore the public JSON API belongs in `alloc/json`, not `core` and not a hosted-only `std/*` adapter.

- `core` remains allocator-free. It may define general compile-time traits/markers that do not depend on JSON values, heap buffers, maps, owned strings, files, clocks, threads, or host reflection.
- `alloc/json` owns `JsonValue`, parsing, encoding, object/array builders, typed generated codecs, and bounded scratch/storage using an explicit allocator provider.
- hosted `std/io`, `std/fs`, `std/net`, HTTP, etc. may feed bytes to or consume bytes from `alloc/json`, but JSON itself must not depend on those capabilities.
- `freestanding-alloc` targets may therefore use JSON when they provide an allocator and sufficient quotas.

A small **allocation-free contract surface may live in `core`**, but it must stay representation-neutral. Examples are token-kind enums, borrowed-input cursor interfaces, caller-provided encode sinks/writers, and static codec marker traits. Those contracts may be used by a fixed-buffer/freestanding parser or encoder, but they must not own `String`, `Vector`, `Map`, a JSON DOM/tree, growable scratch space, or an ambient allocator. The moment an API returns an owned `JsonValue` tree or dynamically sized decoded value, it is an `alloc/json` API.

This split keeps JSON usable on bare metal in two forms:

1. **`core` streaming/fixed-buffer mode**: caller owns storage; JSON machinery only borrows input and emits into caller-provided sinks.
2. **`alloc/json` owned mode**: explicit allocator enables `JsonValue`, dynamic objects/arrays, generated typed decode scratch space, and convenient parse/stringify APIs.


The implementation must not introduce a second host-language Map or reflection-based object model. Dynamic JSON objects use the canonical typed Oreslang Map runtime.

## Dynamic JSON value model

Conceptually:

```ores
JsonValue =
    JsonNull
  | JsonBool(bool)
  | JsonNumber(JsonNumber)
  | JsonString(String)
  | JsonArray(Vector<JsonValue>)
  | JsonObject(Map<String, JsonValue>)
```

JSON object keys are **String only**. Oreslang `Symbol` is not silently coerced to String. A caller wanting `#ready -> "ready"` must request that conversion explicitly.

`JsonNumber` must preserve exact JSON numeric information without a mandatory IEEE-754 round trip. Dynamic parsing therefore keeps an exact integer/decimal representation (or an equivalent validated exact numeric lexeme) rather than eagerly converting every token to `float`. In particular, integers larger than 2^53 must not silently lose precision, exponent overflow must not become infinity, and a decimal must not be rounded unless the caller explicitly decodes it into a finite-width floating type. NaN and infinities are not JSON numbers.

Numeric conversion is target-directed:
- decoding into an integer type requires a mathematically integral JSON number in range; lexical decimal/exponent spellings such as `1.0`, `1e0`, and `100e-2` are valid when their exact value is integral;
- decoding into a decimal/big-number type preserves exact value;
- decoding into `float`/`f32`/`f64` may round according to that target's documented IEEE semantics, but overflow/non-finite results are errors by default;
- encoding a non-finite guest float is an error, never `null` or an implementation-specific token.

Dynamic object mutation uses the ordinary Map surface:

```ores
val Map<String, JsonValue> obj = new Map<String, JsonValue>();
obj["name"] = "Ada";
obj[key] = value;
```

Indexed assignment is insert-or-replace on an owned mutable Map. A named `put(key, value)` API may expose the previous value as `Option<V>`; it must use the same ownership, key-domain, quota, and atomicity rules as `m[key] = value`.

For `m[key] = value`, Oreslang preserves its general **RHS-first assignment** rule: mutation authority for a directly named Map is preflighted without running guest code, then the RHS value is evaluated once, then the target receiver and key are evaluated once. A named `m.put(key, value)` is an ordinary member call instead: receiver/authority first, then key and value arguments left-to-right. Both forms commit through the same Map storage/quota primitive; sharing that primitive does not erase their distinct language-level evaluation order.

Replacement is transactional with respect to the Map itself: key/value domains, recursive JSON-graph admission, policy and quotas must pass **before** publishing the new entry, and only after publication may the displaced value be released/dropped.

The selected move-only protocol is now explicit. The runtime owns the internal
`OresKeyedMap.attemptOwnedPut(key, value)` primitive with a **linear one-shot**
result:

- **committed**: storage has published the offered value and
  `takePrevious()` transfers the displaced mapping exactly once;
- **rejected**: storage is unchanged and `takeUncommittedValue()` transfers
  the **exact offered value by identity** exactly once.

A rejection is not exposed as ordinary data before ownership recovery.
`rethrowAfterRecovery()` may propagate the original admission failure only
after the rejected candidate has been taken back. The runtime performs every
recoverable domain/graph/quota/policy check before the publication commit
point; a failure after publication must never be translated into a rejected
result that returns candidate ownership.

That result is compiler/runtime machinery, not a guest method. Source lowering
evaluates a move-only RHS into a temporary without committing the source move,
calls the internal attempt, commits the ownership move only on the committed
branch, and restores/retains the source owner on the rejected branch before
mapping the internal rejection to the source error surface. Eagerly moving the
source and attempting to reconstruct ownership from an exception is forbidden.

The currently exposed closed Map surface remains scalar/copy-safe until the
ownership checker/evaluator model the insertion's explicit committed versus
rejected control-flow edges. In particular, the existing conservative
`try/catch` ownership rule cannot simply be bypassed: a successful insertion
followed by a later throwing operation must still leave the source moved on the
catch edge.

The indexed-write surface is available only when the expression resolves to a directly owned mutable Map reference. It is not dynamic property assignment on records, structs, classes, modules, or host objects.


The first closed typed-Map implementation permits only a narrow scalar value domain. JSON requires a later compiler-owned **recursive value descriptor** for `JsonValue`; do not bypass that gate with `java.util.Map`, `Object`, host reflection, or an untyped `any`.

## Typed decode

Canonical typed decoding is:

```ores
const User user = try Json.decode<User>(bytes);
```

The compiler generates the decoder for a statically known `T`. There is no runtime field reflection.

### Records

A record decoder constructs the exact readonly structural shape. Required fields must be present exactly once. Optional/defaulted fields follow explicit type/default rules. Unknown fields are rejected by default; an explicit codec annotation/policy may opt into ignoring or collecting them.

### Structs

A struct decoder populates only fields in the declared closed struct shape and must satisfy definite initialization before the value is published. JSON cannot add a new field to a struct.

### Classes

Class decoding must never poke private fields or bypass constructors/invariants. A class must explicitly opt in through a compiler-generated codec or an explicit factory/decoder. The generated path must call an admitted constructor/factory shape; it may not allocate an instance and mutate hidden storage behind the class API.

Decoder construction is two-phase: first parse/validate all admitted inputs into temporary decoder-owned state, then invoke the constructor/factory exactly once. No partially initialized class instance may escape on an unknown field, malformed value, quota error, constructor error, cancellation, or panic.


### Maps and arrays

`Map<String, V>`, arrays/vectors, Option/Result-like explicitly supported codecs, enums/ADTs, records and structs may compose recursively once their ownership/runtime descriptors are supported. Map key types other than String require an explicit key codec and are not valid JSON object keys by default.

### Missing fields, JSON null, and Option

Oreslang does not gain a general-purpose `null` value merely because JSON has one.

- a required non-Option field rejects both absence and JSON `null`;
- an `Option<T>` field decodes either an absent member or JSON `null` as `None`, and a present non-null value as `Some(T)`;
- code that must distinguish **missing** from **present null** uses an explicit presence wrapper/codec (or a nested optional representation once that contract is standardized), not hidden decoder state;
- defaults are applied only when an explicit field/type codec declares them; malformed present values never fall back to defaults.

### Field names and codec annotations

Field matching is exact and case-sensitive by default. The compiler may support statically resolved annotations such as a JSON field rename, ignore, default, unknown-field policy, or explicit class factory, but annotations are compile-time metadata:

- no runtime reflection lookup;
- no duplicate encoded names after renaming;
- no two source fields may decode from the same JSON member;
- ignored/private class state is never populated implicitly;
- unknown-field capture, when explicitly enabled, must target a compatible `Map<String, JsonValue>`-like field and remains subject to quotas.

## Typed encode

`Json.encode(value)` / `Json.stringify(value)` uses compiler-generated static field traversal for typed records/structs/classes. It should stream directly into a bounded writer where possible instead of first constructing `JsonValue`.

Encoding a class follows the class's explicit public codec contract; private implementation fields are not automatically serialized.

## Duplicate keys, unknown fields, and parser limits

The default parser/decoder is strict:

- reject duplicate object keys rather than choosing first-wins or last-wins;
- reject malformed UTF-8, unescaped control characters, invalid escapes, unpaired UTF-16 surrogate escapes and invalid Unicode scalar values;
- reject non-JSON numbers such as NaN/Infinity, excessively long numeric tokens and exponent forms that exceed configured limits;
- do not treat a UTF-8 BOM, comments, trailing commas, single quotes, or bare identifiers as ordinary JSON unless an explicitly named relaxed mode is selected;
- apply explicit maximum nesting depth, token count, numeric token length, string/key byte length, object entry count, array length and total decoded allocation budget;
- count skipped/unknown fields toward parse and allocation/work quotas so "ignore unknown" cannot become a resource-bypass path;
- fail atomically without publishing a partially decoded typed value or partially built dynamic object;
- never invoke guest callbacks while internal JSON/Map storage locks or mutation fences are held;
- serialize **all** JSON-object mutations through an internal graph-stability gate before the individual object monitor; edge creation additionally rejects any cycle before publication;
- because a retained alias to a nested mutable JSON object can later make an older root deeper/larger, revalidate complete-root depth/node quotas under that same graph-stability gate immediately before recursive encoding, freezing, transport, or other externalization;
- validation and recursive traversal must occur in one guarded operation (or traverse an immutable validated snapshot), so concurrent remove/clear cannot produce a torn externalization view.

Keys such as `"__proto__"` and `"constructor"` are ordinary strings because Oreslang objects do not use JavaScript prototype mutation; they must not trigger host-object property semantics.

A relaxed policy must be named and explicit. It cannot silently weaken the default typed decoder.

## Immutable record/struct update / extension

Readonly structural records and owned plain structs support a compile-time-key update expression:

```ores
const base = record { name: "Ada" };
const extended = base with {
    age: 37,
    active: true
};
```

The result type is the base row with the listed fields replaced or appended:

```text
typeof(base)     = record { String name }
typeof(extended) = record { String name, int age, bool active }
```

Rules:

1. The base must be an actual readonly structural **record** or an owned plain **struct**, not a class, structural contract view, module namespace, or Map. Record results remain readonly records; struct results remain plain structs.
2. Update field names are compile-time static and unique within the update expression.
3. Replacing an existing field may change that field's result type; adding a field widens the result row.
   Type computation is `RowOverride<Base, Patch>`: retain every base field not named by the patch, replace named base fields with the patch field type, then append newly introduced patch fields. The original binding never changes static type; the expression yields a distinct result value/type (and may consume the base under the ownership rule below).
4. Existing-field order is retained; newly added fields append in source order. Field order is deterministic but structural assignability remains name/type based.
5. The base expression is evaluated exactly once; update values are evaluated left-to-right.
6. Failure while evaluating an update leaves the original value logically unchanged and publishes no partial result.
7. Ownership is not faked by shallow aliasing. If the base record contains move-only state, the update consumes the base unless a checked copy/share operation has explicitly made duplication legal. A backend may structurally share only values proved immutable/share-safe.
8. A runtime-computed field name cannot change a static record type. Use `Map<String, V>` / `JsonObject` for dynamic keys.
   Even `record.put("literal", value)` is not v1 row-extension syntax: method-looking APIs are reserved for ordinary values/containers. `with { field: value }` is the single canonical shape-changing record operation, which keeps shape changes explicit to the parser/type checker.
9. `r["field"] = value` remains illegal for readonly records; `with` is construction of a new value, not mutation.

No row update may reveal hidden fields from a structural class/contract projection. V1 therefore rejects `with` on structural views rather than copying a runtime object's undisclosed shape.

## JSON + record update examples

Typed, static shape:

```ores
const payload = record {
    status: "ok",
    user_id: user.id
};

const traced = payload with {
    request_id: request_id
};

return Json.stringify(traced);
```

Dynamic shape:

```ores
val Map<String, JsonValue> payload = new Map<String, JsonValue>();
payload["status"] = "ok";
payload["user_id"] = user.id;

for const entry of dynamic_fields do
    payload[entry.key] = entry.value;
end

return Json.stringify(payload);
```

## Compile-time generation and AOT/tree shaking

Typed codecs are generated or specialized at compile time. No general runtime reflection registry is required. Reachability roots are explicit codec calls/derivations and exported boundaries. Unused codecs and unused JSON features remain tree-shakeable.

Encoding must reject cyclic object graphs unless a separately named graph/reference codec is used; ordinary JSON has value-tree wire semantics even if an internal acyclic runtime graph temporarily shares subvalues. Cycle prevention is an always-on mutation invariant, while complete-root depth/node quotas are rechecked under a graph-stable boundary immediately before recursive encoding. Runtime capabilities and process-local identities (actor refs, channels, mutex/guard handles, raw native handles, closures, module namespaces, allocator handles, etc.) are not implicitly serializable merely because they occur in a reachable field.

Ordinary `Json.stringify` is deterministic for a fixed value and implementation contract but does not claim cryptographic canonical JSON. Records use their declared/source-stable field order and dynamic JSON objects use the canonical Map iteration order. A future canonical/signing mode must be a separately specified algorithm (for example an RFC-8785-compatible profile), including Unicode and numeric canonicalization.

A strict full-AOT profile may reject unresolved dynamic codec registration. User-defined adapters must be explicit and statically reachable.

## Required conformance before promotion

- parser/type tests for record/struct `with`: add, replace, type change, row/shape widening, duplicate field rejection, class/Map rejection, structural-view rejection and dynamic-key rejection;
- ownership tests proving move-only bases are consumed and no writable alias is recovered;
- evaluator/backend tests proving base-once and left-to-right evaluation and atomic failure;
- Map indexed insert/replace storage parity with named `put`, while separately pinning RHS-first assignment order versus member-call argument order;
- move-only fallible-insert tests proving a rejected recursive/quota write either leaves the source ownership uncommitted or returns the uncommitted value;
- dynamic JSON object tests using the canonical Map runtime, including String/Symbol separation;
- strict duplicate-key, UTF-8/Unicode, control-character, BOM/extension rejection, exact-number and quota adversarial vectors;
- missing-vs-null/Option fixtures, including malformed-present-value cases that must not silently default;
- generated record/struct/class decode tests, including class invariant/factory enforcement, rename collisions, and unknown/missing field policy;
- cycle/capability serialization rejection and deterministic ordinary-encoding order tests;
- Java/Graal and LLVM must either implement the same source contract or reject unsupported JSON/record-update constructs before partial lowering.

This contract does not by itself claim that `alloc/json`, recursive Map value descriptors, record `with`, or generated JSON codecs are already executable on every backend.
