# Immutable aggregate spread v1 — draft portable contract

Status: **PROPOSED / NO VERIFIED EXECUTABLE PARITY** (2026-10-22). Java parser, scalar-only type/ownership checks, interpreted lowering and a typed static construction plan are under implementation in draft PRs #1880 and #1882, but no successful exact-head JDK/Graal execution has yet been established. General ownership-safe spread, explicit-struct spread and non-Java backend parity remain unimplemented/unverified. Existing call-argument tuple spread is a different feature.

## Scope and canonical source

An aggregate initializer can contain any number of source-ordered static named fields and aggregate spread items:

    const t1 = infer struct{foo: 5};
    const t2 = infer struct{...t1, bar: "foo"};
    const t3 = infer record{...t1, bar: "foo"};
    const t4 = record{...t3, foo: 42};

This extends the existing RECORD, INFERRED_RECORD, INFERRED_STRUCT, and EXPLICIT_STRUCT initializer model; it **does not** redefine ordinary nominal named structs as structural. The struct -> record example is an **explicit construction** with a separate readonly structural value, not an implicit cast. For explicit struct{field: Type, ...}{...} construction, a spread can supply initializer fields but the result must exactly satisfy the declared concrete shape: unknown, missing or incompatible fields reject. Static shape aliases and explicit type capture should continue following existing Java rules; do not introduce a new nominal type or redefine existing/imported names merely because a binding has an uppercase annotation.

Existing record update syntax (base with { field: value, ... }) remains canonical and separately defined in contracts/v1/json-record-map-v1.json. Aggregate spread is a constructor syntax, not a replacement for with or for Map<String, JsonValue>. Both must share compatible static update semantics but keep their distinct source evaluation forms and authority checks.

## Grammar and static field identity

    aggregate_element ::= static_field ":" expression | "..." expression
    aggregate_elements ::= (aggregate_element ("," aggregate_element)*)?
    static_field ::= identifier | quoted_static_string_key

The lexer already recognizes ELLIPSIS for call-site tuple expansion; context distinguishes the two operations. Aggregate spread expressions must have a statically known, closed field schema whose public/accessible fields may be copied/moved into the constructor. A dynamic Map, unknown value, structural callable-only view, arbitrary class, actor, mutable capability, partial/uninitialized aggregate, runtime key expression, or open/dynamic row must fail closed. No reflection, runtime prototype enumeration, host-property injection, or string-based fallback.

Field-name equality uses the existing compiler key policy: preserve literal spelling, check duplicate semantic identities after decoding, reject invalid compiler field names, do not assume case folding or normalize Unicode into aliases. Symbol-key support is a separate explicitly versioned feature. Enforce existing field-count and static-name validation bounds in parser, type checker, metadata and runtime.

## Evaluation, merge, overriding

Evaluate each spread operand or named initializer **exactly once**, from left to right in lexical source order, before construction is published. A spread copies/projects the statically admitted fields of its value into the new candidate row (not user-visible mutation). Later elements override earlier spread-provided field values, including changing the inferred field type. Repeated spread keys resolve to the **rightmost** occurrence. Explicitly written duplicate named fields in the same initializer are an error even when separated by spreads. All fields still evaluate (or fail) in lexical order; an overridden, evaluated expression must not be silently skipped unless an optimization proves it pure and equivalent, including destructor/effects behavior.

For an inferred aggregate, compute a closed row by ordered override and append. An explicit struct is invariant under its declared field types; a replacement cannot change the declared type. Record shape equivalence is structural and independent of insertion order, but runtime construction order and side effects follow source order. A plain inferred struct is an exact concrete shape; an explicitly built record remains readonly. Nominal declaration names and actor identity are not erased.

## Ownership, lifetimes, cleanup, actor boundaries

Immutable is not synonymous with Copy. A source must remain valid after a non-consuming spread. For Copy fields permit a checked copy. For non-Copy fields require compiler-proven immutable sharing or explicit user-authorized copy/ownership transfer according to the canonical rt copy, rt share, rt take operations. Never implicitly move a live source field, manufacture an ownership upgrade, or copy a linear capability. Mutable/borrowed references, active guards, private inaccessible fields, suspension-unsafe loans, and non-sendable actor-local authority fail closed. Ownership transfer must be tracked for every field and all exceptional paths, including overridden values.

Allocate/validate the new aggregate transactionally before publication. On throw, raise, panic, cancellation, allocation failure, or field-construction failure, destroy each successfully acquired owned field exactly once, release all temporary loans and keep all unconsumed sources valid. Do not retain a hidden borrow of an actor arena beyond its lifetime. A cross-actor copy/share is permitted only when the normal domain, serialization, capability and lifetime checks establish it, never because the source happens to be readonly. Per-actor heap/arena boundaries remain authoritative. No implicit ambient heap allocation or background tracing GC is required by the language contract.

## Lowering and ABI

Frontend creates ordered AggregateElement(StaticField(name, expression) | Spread(expression)) with source spans and an immutable checked projection plan; do not encode spread as a fake field name, a sentinel string or a runtime Map. Each checked spread operand must have a statically established field/type schema and authority proof. Evaluation follows source indices while storage may use canonical field IDs, aligned AoS, SoA or AoSoA representation. An optimizer can elide proven dead copies, select borrowed immutable references, scalar-replace or fuse constructors, but must preserve effects/ownership/exception ordering. Never reinterpret a struct physical layout as a record ABI.

Portable static lowering plans consist of source-ordered steps and an explicit field-write schedule. Each write identifies its source step, statically named field, resolved target slot, primitive field type, and whether it came from a spread; rightmost overrides write the same target slot without erasing earlier side effects. To obtain deterministic projection slots from an order-independent static row type, sort keys lexicographically by **Unicode scalar value** (equivalently, unsigned UTF-8 bytes for valid Unicode). Do not substitute Java UTF-16 code-unit ordering or locale/case-sensitive collation. This is a compile-time slot ordering rule, not a change to observable source evaluation order or structural type equality.

A construction plan is type metadata, **not an ownership admission token**. A backend may lower it only after independently proving Copy/borrow/actor-domain authority and exception-path cleanup. Directly constructed, forged, incomplete or type-inconsistent plans must fail closed. Source AST rewrites must preserve metadata provenance **only when the rewrite is semantically and type-equivalent**, or trigger full type-and-ownership revalidation.

For Java's provisional scalar-only implementation, checked spread plans are bound to **both the exact compilation-unit identity and the exact aggregate AST object identity** with weak references, not structural equality. Reusing an already admitted AST expression as a child of another program must not import its approval. Each separately assembled compilation unit requires independent complete type and ownership validation. Type checking stages candidate plans privately until the **entire compilation unit passes type checking**; one later type error must never publish the earlier candidates. The complete candidate set is then recorded atomically, and it still grants no execution authority. Ownership approval is published only after the **entire compilation unit** passes ownership checking; failure in another routine must not approve an earlier valid spread. An independently successful ownership-only pass may not promote candidate plans from a previously failed type pass. The interpreter must require the two-pass approval before evaluating any spread operand. A transformed AST, separately parsed identical AST, or a prechecked host parse lease does not inherit that approval. The runtime projects **only fields listed in the admitted static plan**, validates their scalar runtime tags, and rejects absent or mismatched fields: it must never enumerate undisclosed fields of a wider runtime structural value. Before publishing the completed aggregate it must also verify that the final field set matches the checked shape exactly and that every final scalar value matches its statically checked field type. No unexpected extra fields, missing slots or runtime type drift may become observable. Suspended assembly failures re-enter the continuation error channel; this is still not proof of complete panic/raise/cancellation cleanup.

Generated codecs for new shapes must be derived at compile time, tree-shake unused metadata and obey the existing Zorde/JSON canonical schema and actor transport contracts. Physical order is not schema identity.

## Named types

The contextual short form const T2 v = infer struct{...} and const T3 w = infer record{...} may create a *lexical structural type alias* only if the existing inference rules explicitly admit that new alias (absent, uppercase, non-imported, non-generic, no name collision). In all other forms the annotated T2/T3 must already exist and conformance is checked. Neither form creates a nominal named struct identity. Do not silently promote plain struct{...} to an inferred struct expression.

## Release gates and non-goals

1. Portable manifest and exact-source compile-accept/reject tests; parser-only testing is not sufficient.
2. Java/Graal AST, parser, type, ownership, actual guest execution and formatter roundtrip; code-generated and interpreted paths must agree.
3. LLVM native executable plus ASan/UBSan, strict ownership and memory-reclamation evidence.
4. Wasm real linear-memory guest, JS Node/browser emitted code, .NET actual CIL/NativeAOT where supported.
5. Negative fixtures must fail before any guest artifact is emitted. CI must prove exact tested commit/tree.
6. Do not infer five-backend parity from host mocks, reference-oracle tests, failed/no-step Actions runs or source-free canaries.
7. Private-source cross-organization CI mirroring requires a reviewed protected allowlisted private destination; never use a public mirror as a workaround.

Deferred: dynamic spread, unconstrained generic rows, arbitrary classes, mutating fields in-place, runtime reflection, automatic actor transport, and layout inversion merely from a literal.