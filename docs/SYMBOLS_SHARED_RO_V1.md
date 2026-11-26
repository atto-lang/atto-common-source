# AttoLang Symbols and shared read-only regions — v1 candidate

**Status: proposed contract and reference-only model, not an implemented guest feature.** This adds no backend capability by itself. The existing [Symbols v1 contract](SYMBOLS.md) remains authoritative for value identity, syntax, canonical Unicode and tenant-scoped admission. The public name is AttoLang; legacy repo paths and .ores compatibility remain unchanged.

## Decision

1. A Symbol is a **small immutable nominal value** denoting (kind, canonical UTF-8 name). It is not a reference, actor handle, memory address, atom-table index, trusted permission or object-capability.
2. Symbol equality and hashing **must never depend on interning or physical storage**. A compiler may use a fast local index only after proving it denotes the same canonical (kind, key), with a correct fallback for different arenas, isolates or generations.
3. Predeclared literal names may be stored once per **immutable image/region** and referenced read-only by many actors in the same admitted isolation domain. This is an optional allocation optimization, not a language-visible promise of pointer identity.
4. Dynamic names and decoded remote names must never be permanently interned by default. Parsing or receiving attacker-controlled data cannot allocate an unbounded process-lifetime atom table.
5. Sharing a Symbol is not the same operation as sharing a deep-frozen object graph. Introduce a separately proven Frozen<T> contract for the latter; a const binding, ordinary readonly loan, or an opaque actor reference does not suffice.

## A. Declaration and expression syntax

Preserve the existing v1 forms. The literal introducer is #, **not** a colon, @, JavaScript Symbol() call, or a preprocessor directive.

| Form | Meaning | Compatibility |
| --- | --- | --- |
| #ready | PROCESS Symbol with canonical name ready | Existing v1 literal contract; Java first-stage |
| #"ready foo" | PROCESS Symbol with quoted name | Existing v1 contract |
| #'ready foo' | Equivalent quoted spelling, formatter normalizes to double quotes | Existing v1 contract |
| #class, #true | PROCESS Symbols whose names happen to be keywords | Existing v1 contract |
| Symbol.process("ready") | Trusted dynamic PROCESS constructor, subject to quotas and admission | Existing v1 Java runtime |
| Symbol.stable("550e8400-e29b-41d4-a716-446655440000") | Distinct STABLE UUID-backed kind | Existing v1 Java runtime |
| const Symbol READY = #ready; | Immutable named binding, with no new Symbol identity kind | **Candidate** spelling pending compiler/immutable-local grammar proof |
| pub const Symbol READY = #ready; | Exported compile-time binding with inert import | **Candidate** spelling pending exports/const proof |

Existing portable examples also include \`final Symbol status: #ready\` and \`let status: Symbol = #ready\`. Do **not** assert that every declaration family above compiles today; each backend must admit or reject deliberately.

### Group declarations: optional future sugar, not v1 admission

~~~atto
// Proposed only: requires explicit grammar, export, diagnostics and formatter work.
pub define symbols Lifecycle as
    Ready = #ready;
    Failed = #failed;
end
~~~

If adopted, Lifecycle.Ready resolves to the same **PROCESS** value as #ready. Groups are compile-time namespaces of constant aliases, **not** enum types, isolated kinds, runtime registries, allocated singleton objects or fresh capabilities. Reject duplicate member names, aliases that normalize to the same key in one group, nonconstant initializers, mutable members, and import-time code execution. A closed enum remains a distinct nominal enum type; it must never silently coerce to Symbol.

Do **not** introduce a second literal syntax merely to make group declarations work. A source file containing unsupported group syntax must receive an explicit unsupported-feature diagnostic before execution.

## B. Identity, normalization, and trust

- Canonical identity is (PROCESS or STABLE, NFC-normalized canonical UTF-8 name). Case-sensitive; Symbol("ready") is not String "ready". PROCESS values remain logically equal across OS processes despite the historical kind name.
- Keep the existing 1..256-byte validated canonical-name bound, ASCII bare-literal 128-byte bound, forbidden controls/format characters, and canonical lowercase UUID requirement. Bound **raw input before Unicode normalization**, including dynamic constructors and wire decoders. Pin and test a cross-backend Unicode normalization version or deny unsupported non-ASCII admission.
- Preserve canonical source/wire name bytes, not a hash-only key, pointer, numeric symbol slot, address or stringified object. Collision-safe equality must compare canonical bytes.
- The only default untrusted PUBLIC PROCESS names in the existing v1 core manifest are ready, error and Symbol.iterator. Any userland PROCESS name requires authenticated tenant + endpoint + protocol scoped export. STABLE names are always denied by v1 untrusted ingress. Source-actor and detached-snapshot checks must both enforce this.
- A Symbol never confers permission to read another actor's private data, access private fields, allocate in another tenant, invoke a method or bypass a capability gate. Do not allow guessing a literal name to become authorization.
- Preserve StringKey("status") distinct from SymbolKey(PROCESS,"status"); old serialized String fields do not become symbol members. No implicit String/Symbol coercion anywhere.

## C. Shared read-only Symbol pool

**Physical layout target (optional, backend-specific):**

~~~text
compiler-verified literal manifest
       |
       v
immutable image / sealed RO segment (ABI, Unicode version, digest, offsets)
       +-- canonical kind + length + UTF-8 bytes
       +-- collision-safe lookup metadata
       +-- bounded generation / retired-segment metadata outside RO payload
       |
       +-- SHARED actor A: validated read-only view
       +-- SHARED actor B: validated read-only view
       +-- PRIVATE actor: logical immutable copy or verified frozen view
       +-- UNTRUSTED actor: detached canonical copy after receiver-scope admission
~~~

- Only compiler-trusted static names go in the image table by default. A bounded dynamic *ephemeral* cache is optional and must support eviction without changing value equality or invalidating live references.
- The pool is a **sealed immutable payload**. Mutable allocation/eviction/reference counts, if any, live in a separate guarded runtime ledger. No ordinary actor may mutate the payload, publish into it, remap pages, observe raw pointers or synthesize a valid index.
- For native LLVM/.NET/Forge, place static bytes in read-only image storage where supported; for dynamically built native segments, fill and validate before changing page protection to read-only. No writable alias can survive publication. Page protection is defense-in-depth; the compiler/ownership gate remains mandatory.
- For Java/Graal, use immutable managed values or verified frozen backing; never mistake an unmodifiable view over a mutable collection for deep immutability. For Wasm, validate and guard linear-memory accesses explicitly; do **not** claim OS page protection for arbitrary guest linear memory.
- Same-domain SHARED actors may reuse immutable storage without copying. PRIVATE and UNTRUSTED actor boundaries require either separately proven read-only capability admission or an owned immutable copy; cross-isolate/process transport sends logical canonical bytes, never a pointer or table index.
- Domain-partition cache access for untrusted tenants. Shared physical bytes must not expose another tenant's registry membership, hidden names, content or timing-based privilege checks. A rejected name must not be automatically interned.
- Every lookup is bounds-checked against an immutable table descriptor. Internal fast handles are tagged with segment/version/generation, cannot escape the runtime ABI and must fail closed when stale. Equality remains logical even when the originating segment is retired.
- Hot load stages a new immutable segment, validates signature/digest + Unicode/ABI compatibility, then atomically publishes a generation. Existing readers pin the old generation through their turn/suspension lifetime as required. Retire/reclaim only after the last pin; cancellation and actor failure must release pins exactly once.

## D. Deep-frozen data is a separate capability

**Proposed type family**: Frozen<T> is a transitive, typed immutable graph whose sharing has been proven by the borrow/ownership checker. Exact surface grammar and module placement are deferred; examples below are *conceptual*, not accepted source.

~~~atto
// Candidate source only: no current compiler support is implied.
const Frozen<Config> config = freeze(rt take builder);
sender.send(rt share config);
~~~

- freeze consumes *exclusive* owned input or makes a checked deep copy. It may not upgrade arbitrary mutable aliases or a merely const binding into globally immutable data.
- Close the entire reachable graph: no mutable cell, actor-owned reference, file/socket, mutex, callback, closure, untrusted host object, writable slice or hidden native pointer may escape into it. A read-only borrow of mutable state is **not** Frozen<T>.
- Proven Frozen<T> may be read concurrently by authorized actors and passed across suspension only with a valid bounded lifetime/lease. It is never writable from any alias and must be Sendable by the transport's rules. No automatic sharing across trust domains.
- Freeze/deserialize enforce graph-wide node, depth, byte, cycle and quota budgets during actual traversal, not just a preflight size() check; reject logical duplicate Symbol keys after normalization.
- Reads do not mutate retained objects. An update produces a **new immutable generation**; it does not mutate old readers' view. Publication must be all-or-nothing. Allocation failure, cancellation, quota exhaustion and bad Unicode leave the preceding generation readable.
- Shared-read-only storage cannot smuggle functions or closures across channels or pub-sub. Mutable shared state still requires separate, explicitly authorized synchronization abstractions.

## E. Conformance / proof gates

All backends (Java/GraalVM, LLVM, .NET NativeAOT, Wasm, Forge/Cranelift) must independently demonstrate:

1. Parser and formatter: canonical # expressions, quoted escapes, keyword names, rejection of :ready, invalid # forms, and unsupported declaration sugar fail-closed.
2. Identity: NFC-equivalent names, stable-vs-process, String-vs-Symbol, keyword names and hash collision adversaries.
3. Ownership: no mutation of literal backing or published Frozen<T>; const binding alone is not deep frozen; no writable alias, source-owned reference or callable escapes.
4. Actor messaging: shared-domain immutable read succeeds, private/untrusted transport copies or admitted frozen-view, recursive keys **and** values authorized on detached message after copy.
5. Quotas: bounded raw normalization, decoded frame, table size, actual graph traversal, cache growth, cancellation and actor death; malformed input never increases permanent intern count.
6. Generations: publish/rollback, stale-handle rejection, old-reader pinning, exactly-once release, actor restart/hot reload and eventual safe reclamation.
7. Security: unauthorized tenant/scope, stable Symbol in untrusted actor, forged internal handle, unsafe host object and guessed private Symbol all fail closed.
8. Native evidence: exact head SHA/tree + pinned compiler/toolchain, nonzero executed test steps, real guest compile/typecheck/ownership/lowering/actor execution. Host-only reference tests and zero-step CI remain **NOT_EXECUTED** for backend parity.

The reference model in tests/test_symbol_shared_ro_model.py checks design invariants only; it does not allocate protected memory or certify a compiler, real races or physical zero-copy performance.

## F. Rollout sequence

1. Ratify this *additive* contract without replacing [SYMBOLS.md](SYMBOLS.md) or reviving stale Java Symbol branches. Use #864 mainline as reference.
2. Add canonical .atto positive and negative compiler fixtures; fail closed on unlowered grouping/Frozen<T> grammar.
3. Implement static Symbol literal table and proof of logical identity on Java/Graal, then native LLVM; inspect generated memory layout and actual actor transport.
4. Add bounded optional interning, tenant-scoped admission, and immutable generations only after negative/race tests execute.
5. Generalize to compiler-proven Frozen<T> and then align .NET, Wasm and Forge. Publish backend-specific exact-head execution receipts rather than conflating model, host and guest results.
