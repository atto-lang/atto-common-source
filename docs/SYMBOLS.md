# Symbols: identity and sandbox contract (v1 proposal)

Status: **normative design proposal, NOT implemented or certified** in Java/Graal or LLVM. The Java `main` tree does not contain the historical `OresSymbol` runtime; native LLVM does not yet implement guest Symbols. This contract intentionally supersedes conflicting design assumptions in stale Java drafts #123 and #160 after review, but does **not** modify those branches.

## A. Fundamental identity

`Symbol` is an immutable, nominal guest value that denotes a *name*, not an address, capability, actor reference, heap pointer or UUID object. Oreslang equality and hash semantics use the canonical value pair `(kind, key)`, never an internal numeric handle, object identity, classloader, carrier thread, heap address, isolate ID, process random UUID, arena generation or registry slot.

Kinds:
- `process` (default): `:ready`, `Symbol.process("ready")`, and a decoded `{"$symbol":"process","name":"ready"}` compare equal regardless of actor, isolate, arena, native allocation, Java classloader, separate OS process or machine. "Process" describes **optional caching/interning lifetime**, not an equality namespace. Within one process the implementation *may* intern one object/handle; that optimization must not be exposed as a semantic guarantee of physical pointer equality.
- `stable` (optional compatibility): `Symbol.stable("550e8400-e29b-41d4-a716-446655440000")` is a separate kind, keyed by canonical UUID string. It compares equal across processes solely by `(kind, key)`, and does not equal a `process` Symbol with the same string.

There is no public `Symbol.local` kind in v1. Existing drafts that propose an actor-local `Symbol.local` conflict with the global identity invariant. If opaque fresh identity is needed, specify `UniqueToken`/actor-owned `Ref` separately, with explicit non-Sendable ownership. A Symbol is **not** an unforgeable capability.

`Symbol` is nominally distinct from `String`; Symbols are case-sensitive. Symbol values are immutable and may be copied across actor boundaries, including untrusted actors, after ordinary message-schema validation. Never share writable backing buffers or handles across isolation; cross-process/isolate transport reconstructs an owned/frozen logical value.

## B. Canonical textual identity and syntax

1. Accept only valid UTF-8 Unicode scalar sequences. Normalize keys to **NFC** in source/runtime constructors and require already-canonical NFC in wire decoders (reject non-NFC encodings); compare the resulting Unicode scalar sequence (or its canonical UTF-8 bytes) exactly. Reject malformed UTF-8, unpaired UTF-16 surrogates, NUL, C0/C1 controls and bidi formatting controls. Require nonempty key, at most **256 UTF-8 bytes after NFC**. Implementations must count bytes, not Java UTF-16 code units.
2. Ordinary literal syntax: `:<identifier>`, initially ASCII `[A-Za-z_][A-Za-z0-9_]*` and max 128 UTF-8 bytes. `:ready` is `process/ready`. A quoted `:"http.ok"` form may be added later for non-identifier names, with literal escapes decoded then NFC-normalized; **no interpolation** is allowed in a literal (dynamic construction uses an explicit API).
3. The colon introduces a Symbol only where an **expression operand is expected**. `foo: int`, `foo: 5`, named arguments, type annotations and map/struct members retain their existing grammar. Don't silently treat `{foo: 3}` as a map with Symbol key unless the map's declared key type explicitly requires that conversion; prefer `{:foo: 3}` or an unambiguous explicit map syntax after grammar review.
4. `Symbol.iterator` is a well-known protocol identifier, not automatically the same as `:iterator`. Specify its kind/name in the protocol registry, avoiding collisions with ordinary user symbols.
5. Public display/diagnostic rendering should be reversible and escaped. Never substitute toString() for a wire schema.

## C. Untrusted actors and allocation authority

**All actors, including untrusted, may hold, pattern-match, compare, hash and send permitted Symbol values.** No actor may gain a permission by merely possessing a Symbol: receivers enforce authority on *operations* and sender identity/capability, not on tag equality.

- `:literal` in untrusted code is admitted as bounded read-only code data or an isolate-local immutable value. Loading many untrusted sources must **not** insert permanent process-table entries. Enforce compiler/source-size, literal-count and memory quotas per tenant.
- Untrusted dynamic inputs may be validated into a *non-interned* value with a separately named constructor (proposed `Symbol.value(name)`); per-actor allocation and input limits apply. The ordinary trusted `Symbol.process(name)` API may explicitly intern, but untrusted code cannot insert into a permanent process-wide table. A pure `Symbol.lookup(name): Option<Symbol>` does not insert; its visibility must not disclose secret protocol names.
- Normal wire decoding is **non-interning**. Validate before allocation; never automatically promote attacker strings to permanent entries, including on nested JSON/MessagePack/protobuf or indirect interop conversions. Use bounded depth, total bytes and field counts. Strict protocol decoders may reject names outside a declared per-channel schema, independently of global interning.
- Any permanent trusted pre-registration is atomic per code unit: preflight canonicalized names and capacity, then commit as a batch; rejected code / failed capacity checks must not consume slots. Separate dynamic and static capacity budgets, plus per-tenant admission quotas. No unbounded growth; exhaustion fails closed with a recoverable error rather than a VM crash.
- Export allowlists, if used to constrain a message *protocol*, must be scoped to tenant, receiving endpoint and policy version; they are **not** a global mutable grant to use a Symbol and may never act as authentication tokens. Revocation must be evaluated at the message admission/use point to close TOCTOU races.
- Symbols must never smuggle a capability-bearing handle, mutable shared buffer, native pointer or heap-region reference through actor copies. Compare immutable symbolic payload only.

## D. ABI, lifetime and backend requirements

- `equals` and `hash` use `(kind, canonical_key)`; pointer equality is never observable guest semantics. Hashing may be keyed/seeded against collision attacks; hashes need not match across processes. Equality must not rely on a 32/64-bit hash or ID alone.
- An implementation may strongly intern trusted values for its process lifetime, or use weak/per-isolate caching for non-authoritative values. The name/value survives actor/arena teardown as long as referenced. Destroying a scope may not reinterpret an old stale numeric handle as a new Symbol.
- Java/Graal: JVM static maps do not prove a single shared allocation across distinct classloaders or Graal Native Image isolates. Ensure logical equality and explicit copying/bridge translation regardless.
- Native/LLVM: a process cache, if used, must be concurrency-safe, bounded and outside actor-owned arenas; use immutable owned bytes or a generation-checked handle. Native heaps need deterministic reclamation; no tracing GC assumption.
- Wire identity v1 is strictly `{"$symbol":"process","name":"ready"}` or `{"$symbol":"stable","name":"<canonical UUID>"}`; no raw pointer/address/registry index or implicit string-to-Symbol coercion. Unknown wire kinds/fields, duplicate JSON members, invalid UTF-8, invalid UUIDs, noncanonical NFC and oversized values fail closed. Decoding must not allocate in a permanent table.
- For cross-process "globally unique fresh IDs" use cryptographically generated UUID/UniqueToken (with authentication if security-relevant). A shared name like `:ready` is deliberately forgeable and equal everywhere, not an authorization secret.

## E. Completion gates (not yet met)

1. Compiler parsing, typing, pattern, field-colon ambiguity, formatter roundtrip, and explicit `String != Symbol` tests on **both** frontends.
2. Same guest-source acceptance and execution across Graal JVM, Graal Native Image (where supported), LLVM JIT and AOT; no host-only substitute for guest execution.
3. Concurrent interning/idempotent equality and hash, separate classloader/isolate tests, actor teardown & new actor reuse, repeated process restart/interop/wire roundtrip.
4. Adversarial flood of unique Symbols, concurrent tenant load, malformed text, nested decoding, quota boundaries, trust laundering and revocation races. Verify process table size is unchanged after untrusted ingress.
5. Sanitizers/Release-active assertions for LLVM, full Maven suites on exact Java head, leak and throughput measurements, then merge independently verified backend PRs.

See `fixtures/symbols.v1.json` for executable-contract *data*. Passing the fixture data self-check does not certify either compiler.
