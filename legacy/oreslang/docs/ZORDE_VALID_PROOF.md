# Zorde opaque validated values: normative compiler contract (proposed)

**Status:** design and conformance gate only. No current backend may claim
executable \`Valid<T, SchemaId>\` support by virtue of this document. The
existing Zorde dynamic \`Result<Value, ValidationReport>\` is not an authority.
Zorde combines Rust's Serde-style compiler-derived serialization with
TypeScript Zod-style schema validation; proof, if exposed, must be stronger
than either a mutable value or a successful diagnostic report.

## Identity and API

- \`Valid<T, S>\` is a **reserved compiler intrinsic**, not an ordinary
  \`define class\`, user-implemented trait, structural record or alias.
  Neither \`T\` nor \`S\` may be erased when checking assignability, generics,
  async continuation frames or hot-code replacement.
- \`S\` denotes a **compiler-minted nominal schema identity** for one
  *admitted* contract, with version, canonical semantic digest, toolchain and
  ABI identity attached. A user-supplied digest, symbol, string, descriptor
  or matching JSON object is not authority; hashes establish equality of
  reviewed inputs, not provenance or approval.
- Generated, reflection-free validators expose a typed checked-admission
  entrypoint (illustrative only):

  ~~~ores
  // Proposed API; NOT yet accepted source syntax on any backend.
  val Result<Valid<User, UserSchemaV1>, ValidationReport> result =
      zorde.parse_owned<User, UserSchemaV1>(incoming_bytes);
  ~~~

  The compiler resolves \`UserSchemaV1\` to a trusted build artifact. It is
  not a generic schema selected by attacker-controlled runtime input.
- Only successful **compiler-owned checked construction** may mint
  \`Valid<T,S>\`. Construction follows full input decoding, structural
  resource limits, semantic validation, schema admission, and successful
  ownership transfer/freeze as one transaction; failure leaves no proof.
  Compile-time constant proofs may use a separate compiler-only path after
  the same normalized predicate is verified.
- Public constructors, subclassing, user method overloads named
  \`try_from\`, manual \`Ok(...)\`, up/down/unchecked casts, record spread,
  reflection, deserialization of \`Valid\`, foreign memory writes, direct
  runtime handles, compiler plugin APIs and crafted ABI representations
  **MUST NOT** mint an acceptable proof.

## Mutation, borrowing and suspension

1. \`Valid<T,S>\` owns a transitive immutable value graph. Validation must
   eliminate or close all live mutable aliases, including nested arrays/maps,
   actor heap handles, slices, arena-backed buffers, foreign buffers, and
   generated collections. Shallow \`val\` fields do not suffice.
2. A validator may consume an owned \`T\` or construct fresh typed storage.
   It must not validate a shared mutable \`T\` and return a proof while a
   writer alias remains live. Failure must release partial allocations
   without exposing a partially validated object.
3. \`rt borrow\` may yield a bounded read-only view, subject to existing
   lifetime and suspension rules. \`rt mut borrow\` of an authoritative
   validated graph is forbidden. To mutate, consume the proof with an
   explicit owned \`into_inner\` operation; the output is an *ordinary T*
   without proof and must be revalidated before re-admission.
4. \`rt share\` is allowed only for compiler-proven immutable, lifetime-safe
   sharing within an approved ownership/security domain. Arena closure,
   actor termination or hot reload must not leave usable stale handles.
5. Typed proof values cannot be reconstructed from raw bytes alone. Binary
   serializers write underlying \`T\` plus explicit contract metadata where
   required; decoders validate and mint a **new** destination proof.

## Boundaries and hot reload

- Actor send/receive, \`Future\`/Task suspension, FFI/ABI, network/RPC,
  persisted snapshots, WASM Workers, untrusted isolates, and hot reload must
  either preserve a separately verified *owned immutable capability transfer*
  within its admitted scope, or re-run checked admission at the destination.
  Ordinary deserialization and copying a receipt never suffice.
- Proof identity binds \`T\`, \`S\`, trusted schema registry admission,
  schema version and runtime domain/generation as required. A stale proof
  cannot silently cross a changed schema, actor generation or JIT/AOT
  boundary. A compatible migration may explicitly revalidate and remint.
- JSON/MessagePack/CBOR/etc. must enforce format-specific strict wire
  admission (duplicates, trailing data, integer precision, UTF-8, canonical
  assumptions) before constructing typed storage. Semantic equivalence
  across formats is demonstrated by differential tests, not assumed.
- Validation is bounded by input bytes, recursion/depth, nodes, collection
  sizes, execution fuel, allocations and error count. Malformed payloads
  produce stable bounded errors without retaining secret payload content.
- \`core\` stays reflection-free and freestanding by default. Parsing,
  registry loaders and allocated dynamic schemas belong in explicitly
  enabled alloc/stdlib profiles; strict full-AOT and hard-real-time builds
  must not gain runtime schema evaluation or unbounded allocation.

## Compiler/backend acceptance gates

**Negative compilation (no executable output or authoritative IR):**

1. \`new Valid<T,S>(value)\`, user-defined class/namespace shadowing or a
   structural record with matching fields.
2. Reinterpretation/unchecked cast from \`T\`, \`Value\`, bytes, forged
   \`ValidationReport\`, or a fabricated result wrapper to \`Valid<T,S>\`.
3. Mismatched or user-generated schema identity, unknown registry
   provenance, wrong nominal \`T\`, stale version/generation.
4. Mutable alias retained after validation, nested container mutation,
   mutable borrow of proof, leaking a read borrow beyond its owner/arena,
   and invalid actor or FFI transfer.
5. Unsupported schema syntax, dynamic refs or runtime reflection must
   fail closed instead of erasing constraints.

**Positive execution (not merely parser acceptance):**

1. Exact compiled static-schema validation accepts/rejects independent
   JSON/MessagePack/CBOR corpus vectors, including exact int64 and Unicode.
2. Proof can be read and moved safely; consuming \`into_inner\` removes
   proof authority. A second mutable alias never gains it.
3. Ownership-safe actor send, cancellation/teardown, cross-generation
   rejection and explicitly validated migration.
4. Differential Java/Graal and LLVM results, with .NET, WASM and JS
   targets showing either equivalent semantics or explicit compile-time
   rejection. Include fuzz, sanitizer and bounded-memory tests.
5. Exact-head, source-local compiler/test execution, independent review,
   reproducible schema provenance and protected-branch evidence.

### Release gate

Until **all necessary gates pass**, keep the guest \`Valid<T,S>\` API
**unimplemented/disabled** and expose only ordinary checked dynamic values.
Do not present a publicly constructible holder, a descriptor fingerprint,
a Boolean \`report_is_valid\`, or a source-free oracle as proof of type safety.
The source-local CI and private-source transfer restrictions continue to apply.
