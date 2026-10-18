# Oreslang contracts: two authorities, WIT projections, Zorde and proof evidence

**Status:** design/rollout contract; not evidence of a merged compiler,
successful proof, certified stdlib or executable ABI. Related backlog:
#2 (versioned HIR) and #7 (backend differential rollout).

## Authority model

For each published serializable/public contract family keep two **independently
reviewed, independently edited** declarations:

1. `contracts/<family>/main.tsp`: TypeSpec source for types, DTOs, interfaces,
   operations and named versioned behavior references.
2. `contracts/<family>/authored.schema.json`: Draft 2020-12 JSON Schema for
   JSON-valued declarations, including strict `$defs`, `required`, enum,
   nullability, numbers, depth/shape constraints, unknown-property policy.

Generate a third JSON Schema from TypeSpec **solely as a comparison witness**;
never write it back over authority (2), and never select a preferred authority
to silently resolve mismatches. Use `@oresoftware/typespec-json-schema-validator`
(`tjsv check`), version-pinned TypeSpec emitter, reviewed mapping file for
namespace/name differences and bidirectional valid/invalid payload corpora.

At the admission/check boundary parse both JSON Schema documents to memory,
normalize *semantically relevant* declarations and compare; in addition execute
both validators against checked-in and synthesized values in both directions.
Structural drift, behavioral counterexamples, unsafe/unsupported vocabularies,
invalid `$ref`, hidden exclusions and empty evidence must **stop**, not become
a warning. A byte difference need not imply semantic drift. Conversely, finite
fuzz/test agreement is **not** a proof of equivalence over every JSON instance.

Record declaration coverage, exact authored/emitted digests, mapping and policy,
toolchain versions, source tree SHA, probe seed/corpus IDs, counterexamples,
exit reason and deterministic receipt ID. Generated artifacts and receipts are
immutable evidence, never a source authority. A critical contract change may
require separate review even when structurally compatible.

## WIT: projection with its own ABI obligations

WIT defines **Component Model** worlds/interfaces/resources, ownership of
borrowed vs owned handles, method/async/stream/future contracts and stable
package versions. WIT is an *additive interface projection* of admitted TypeSpec
operations/Contract IR plus ABI/lifetime constraints; it is not JSON Schema,
does not validate arbitrary JSON instance constraints, and is not emitted by
the TypeSpec JSON Schema emitter. Core Wasm `wasm32` output is not automatically
a Component Model component.

Require a pinned WIT parser/validator + canonicalizer, source-tree digest,
normalized WIT projection, explicit Contract IR binding and compatibility
policy, released-baseline `tjsv verify-wit` receipt, and actual host/guest
component instantiation tests. Maintain rejected/unsupported mappings for
decimal bounds, pattern, `oneOf`, closed union, unknown field policy, UTF-8,
resources, async, cancellation, streaming, thread-safety and error behaviors.

External WIT tooling may live in ORESoftware/ores-wit, but that is a separate
dependency and must be pinned and available before making a WIT claim.

## Zorde and the freestanding boundary

- `core`: normalized refinement descriptors, exact arithmetic predicates,
  deterministic schema IDs and static no-OS/no-allocator interfaces. **No**
  Node/npm, TypeSpec compiler, runtime schema DOM, reflection, libc, Linux,
  time, executor, JVM or Component Model requirement.
- `alloc`: optional allocation provider and explicitly bounded buffers.
- `std/zorde`: schema-first typed builder, checked construction,
  serialization/refinement integration, validated typestate when safely frozen,
  and admission/registry adapters. This is one engine, not a duplicate engine
  per JSON, Protobuf, actor transport or backend.
- Build/startup: accept immutable, content-addressed schema pair only after
  fail-closed parity with a hash/provenance-bound receipt; compile static
  validators/metadata and atomically register versioned generations.
- Payload path: use the already-admitted bounded validator; **never**
  recompile TypeSpec or compare two schemas per request. Revalidate mutable
  untrusted values rather than treating a wrapper as immutable proof.

The canonical native Zorde facade is under development in
oreslang-serialization-and-validation draft #14; its TypeSpec/Schema/WIT pilot
is draft #16. Java and LLVM compilers remain independent until they prove
equivalent observable semantics. WIT is optional for a Component Model target;
bare-metal core must compile without it.

Required threats: denial-of-service schema depth/regex/loops; unknown refs;
numeric precision and signed int64 narrowing; Unicode scalar vs byte length;
mutating a checked Value or schema via an alias; unsafe actor sharing; opaque
typestate forgery; deserialization gaps, critical/CONTROL bypass; schema
hot-reload generation races; rollback and ABI-incompatible field additions.

## Evidence ladder (never auto-upgrade a claim)

| Level | Can be claimed after | Cannot infer |
| --- | --- | --- |
| L0 | TypeSpec+JSON Schema independent structural and differential gates execute | Complete semantic equivalence |
| L1 | WIT/ABI and API signature capabilities are validated | Runtime behavior parity |
| L2 | Exact-tree runtime cross-backend tests, property/fuzz/mutation corpora execute | Formal correctness |
| L3 | Dafny/TLA+/Apalache reference obligations verify, hash-bound to operation IDs | Verification of independently coded runtime |
| L4 | Proof/refinement of the **actual implementation** for supported subset, with binding trace | Entire compiler/runtime verified |

Formal focus, in increasing risk order:

- Schema admission is monotonic, fail-closed and hash-bound; no unchecked
  generation ever enters the trusted registry. Model state transition in TLA+
  and prove selected typed-reference operations with Dafny.
- Actor DATA vs sealed CONTROL and supervisor terminal events, exactly-once
  finalization, cancellation/timeouts and bounded mailboxes with explicit
  multi-carrier actor settings. Explore schedules with TLA+/Apalache.
- Borrow/ownership and validated typestate cannot be forged after mutation;
  verify native bounded predicate kernels where implementation language permits.
- WIT resource borrow lifetime, handle ownership, async cancellation and
  backpressure across host/component boundaries.
- Wasm atomic release/provenance and power-cut recovery refinement.
- HIR/MIR normalization preserves evaluation order, effects, exact types and
  backend-independent diagnostics without consolidating compiler frontends.

Each proof claim identifies its *specific* operation/assumptions/model scope,
formal source SHA, exact prover version, outputs and executable implementation
mapping. Missing verification executable, timeout, stale digest, skipped test,
zero-step CI job and infra billing failure all count as **not verified**, never
green. Negative models/fixtures should fail in an expected, inspectable way.

## Rollout and release policy

1. Inventory public DTOs, actor messages, configs, HIR/MIR, error/report data,
   transport boundaries and WIT worlds; classify where JSON Schema applies.
2. Land independent authority peers and positive/negative/counterexample
   corpora; run `tjsv check` with full coverage; pin dependencies/lockfiles.
3. Produce Contract IR and explicit compatibility/capability mapping; promote
   WIT as additive projection only after parser, semantics and ABI validation.
4. Build compiler-generated Zorde descriptors/validators; require deep
   ownership/alias safety before permanent `Valid<T>` claims.
5. Attach formal manifests and receipts for critical behavioral operation IDs.
6. Run real Java/LLVM/Wasm runtime conformance and release qualification at
   exact source tree hashes; maintain independent merge cadence and rollback.
7. Reject promotion for skipped/untested/hypothetical claims; preserve proof
   counterexamples as versioned regression fixtures.

First executable pilot and release-gate tasks:
oreslang-serialization-and-validation PR #16, issues #17/#18;
oreslang-platform-conformance issue #85; oreslang-wasm issue #39;
oreslang-source.java issue #1263; oreslang-source.llvm issue #588.
