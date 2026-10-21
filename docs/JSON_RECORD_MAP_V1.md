# JSON, typed records/structs/classes, and dynamic Map — contract v1

**Status: normative design contract; implementation is staged behind typed Map and allocator/library-layer work.**

## Layer decision

JSON is **OS-independent but allocation-dependent**. Therefore the public JSON API belongs in `alloc/json`, not `core` and not a hosted-only `std/*` adapter.

- `core` remains allocator-free. It may define general compile-time traits/markers that do not depend on JSON values, heap buffers, maps, owned strings, files, clocks, threads, or host reflection.
- `alloc/json` owns `JsonValue`, parsing, encoding, object/array builders, typed generated codecs, and bounded scratch/storage using an explicit allocator provider.
- hosted `std/io`, `std/fs`, `std/net`, HTTP, etc. may feed bytes to or consume bytes from `alloc/json`, but JSON itself must not depend on those capabilities.
- `freestanding-alloc` targets may therefore use JSON when they provide an allocator and sufficient quotas.

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

`JsonNumber` must preserve exact JSON numeric information sufficiently to avoid a mandatory IEEE-754 round trip. In particular, decoding an integer larger than 2^53 must not silently lose precision. NaN and infinities are not JSON numbers.

Dynamic object mutation uses the ordinary Map surface:

```ores
val Map<String, JsonValue> obj = new Map<String, JsonValue>();
obj["name"] = "Ada";
obj[key] = value;
```

Indexed assignment is insert-or-replace on an owned mutable Map. A named `put(key, value)` API may expose the previous value as `Option<V>`; it must use the same ownership, key-domain, quota, and atomicity rules as `m[key] = value`.

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

### Maps and arrays

`Map<String, V>`, arrays/vectors, Option/Result-like explicitly supported codecs, enums/ADTs, records and structs may compose recursively once their ownership/runtime descriptors are supported. Map key types other than String require an explicit key codec and are not valid JSON object keys by default.

## Typed encode

`Json.encode(value)` / `Json.stringify(value)` uses compiler-generated static field traversal for typed records/structs/classes. It should stream directly into a bounded writer where possible instead of first constructing `JsonValue`.

Encoding a class follows the class's explicit public codec contract; private implementation fields are not automatically serialized.

## Duplicate keys, unknown fields, and parser limits

The default parser/decoder is strict:

- reject duplicate object keys rather than choosing first-wins or last-wins;
- reject malformed UTF-8, invalid escapes and invalid scalar values;
- reject non-JSON numbers such as NaN/Infinity;
- apply explicit maximum nesting depth, token count, string/key byte length, object entry count, array length and total decoded allocation budget;
- fail atomically without publishing a partially decoded typed value or partially built dynamic object;
- never invoke guest callbacks while internal JSON/Map storage locks or mutation fences are held.

A relaxed policy must be named and explicit. It cannot silently weaken the default typed decoder.

## Immutable record update / extension

Readonly structural records support a compile-time-key update expression:

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

1. The base must be an actual readonly structural **record**, not a struct, class, structural contract view, module namespace, or Map.
2. Update field names are compile-time static and unique within the update expression.
3. Replacing an existing field may change that field's result type; adding a field widens the result row.
4. Existing-field order is retained; newly added fields append in source order. Field order is deterministic but structural assignability remains name/type based.
5. The base expression is evaluated exactly once; update values are evaluated left-to-right.
6. Failure while evaluating an update leaves the original value logically unchanged and publishes no partial result.
7. Ownership is not faked by shallow aliasing. If the base record contains move-only state, the update consumes the base unless a checked copy/share operation has explicitly made duplication legal. A backend may structurally share only values proved immutable/share-safe.
8. A runtime-computed field name cannot change a static record type. Use `Map<String, V>` / `JsonObject` for dynamic keys.
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

A strict full-AOT profile may reject unresolved dynamic codec registration. User-defined adapters must be explicit and statically reachable.

## Required conformance before promotion

- parser/type tests for record `with`: add, replace, type change, duplicate field rejection, non-record rejection, structural-view rejection and dynamic-key rejection;
- ownership tests proving move-only bases are consumed and no writable alias is recovered;
- evaluator/backend tests proving base-once and left-to-right evaluation and atomic failure;
- Map indexed insert/replace parity with named `put` when added;
- dynamic JSON object tests using the canonical Map runtime, including String/Symbol separation;
- strict duplicate-key, UTF-8, numeric precision and quota adversarial vectors;
- generated record/struct/class decode tests, including class invariant/factory enforcement and unknown/missing field policy;
- Java/Graal and LLVM must either implement the same source contract or reject unsupported JSON/record-update constructs before partial lowering.

This contract does not by itself claim that `alloc/json`, recursive Map value descriptors, record `with`, or generated JSON codecs are already executable on every backend.
