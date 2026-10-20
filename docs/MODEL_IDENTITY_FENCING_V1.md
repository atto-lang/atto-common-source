# Model identity, cache identity and run fencing — v1

**Status: PROPOSED / compiler-runtime contract.** This document refines the general-purpose `define model` work in PR #93. It does not make models executable and does not replace backend ownership, numerical, sanitizer or guest-execution evidence.

## Why this exists

A model has several different identities that must never be collapsed into one pointer, hash, actor ID or version counter. Conflating them can reuse code for changed semantics, mix activations with new weights, accept stale hot-reload work, or publish a mutation produced by the wrong execution profile.

V1 therefore defines the following independent identities.

| Identity | Meaning | Changes when |
| --- | --- | --- |
| `ModelTypeId` | nominal source-level model declaration identity | package/module/declaration ABI identity changes |
| `GraphDigest` | portable semantic fingerprint of one lowered immutable graph | topology, typed ports, static config, op ABI/implementation/provenance or semantic profile changes |
| `GraphGeneration` | local publication generation for hot reload/replacement | a process/session publishes another graph generation |
| `InstanceId` | one owned model instance/storage identity | a new independently owned instance is constructed |
| `ParameterVersion` | version of mutable/frozen parameters for an instance | parameters are atomically published |
| `RunId` | identity of one execution/training/simulation run | every admitted run |
| `ExecutionProfileDigest` | exact backend/target/numeric/allocation execution contract | backend, target, compiler semantic version or execution semantics change |

None is interchangeable with another.

## Canonical graph descriptor\n\nThe sole normative v1 graph encoding and digest is `MODEL_GRAPH_DIGEST_V1.md` and its vectors in `contracts/v1/model-graph/digest-v1-vectors.json`. Java/Graal and LLVM must independently reproduce that binary byte stream and SHA-256 result; backend-private or second textual graph hashes are not conformance identities.\n\nThe portable graph digest binds nominal model identity, topology, typed static constants, operation ABI, trusted implementation digest/provenance, exact ports, effects/VJP capability, scratch bounds and the portable operation profile. Temporary HIR node labels are excluded after canonical ordinal mapping. Graph generation, instance identity, parameter version, run identity and execution-profile digest remain separate fences.\n\n## Graph generation

`GraphGeneration` is not a substitute for `GraphDigest`. It is a checked monotonically increasing publication counter scoped to an owning runtime/session.

- Reloading/replacing a graph increments generation.
- Counter overflow fails closed; it must not wrap.
- Old work retains its old generation.
- A reload must never relabel old activations, continuations, leases or parameter snapshots as the new generation.
- Migration is an explicit validated operation producing a new instance or generation; shape-compatible coincidence is not permission to reuse state.

Portable serialization stores semantic graph identity, not a process-local generation as if it were globally meaningful.

## Instance and parameter identity

A stateful/trainable `ModelInstance` owns its mutable parameter/session storage. Distinct construction never silently aliases mutable storage.

`InstanceId` identifies that owned storage lineage. `ParameterVersion` is scoped to an instance and changes only on atomic parameter publication.

A parameter update follows prepare/validate/commit semantics:

1. read/pin the expected instance + parameter version;
2. compute into unpublished owned storage;
3. validate finite/type/shape/ownership invariants;
4. atomically publish exactly once if the expected version is still current;
5. increment `ParameterVersion` with checked overflow;
6. otherwise reject as stale and publish nothing.

Rollback publishes no partial state. Frozen snapshots may be shareable only after normal ownership/immutability proof.

## Run stamp

Every stateful, asynchronous, cached, actor, accelerator or training execution carries a checked stamp:

```text
RunStamp {
    runId,
    modelTypeId,
    graphDigest,
    graphGeneration,
    instanceId,
    parameterVersion,
    executionProfileDigest
}
```

Before any state mutation or externally visible publication, all required stamp components are checked against the owning execution/session. A mismatch is a deterministic failure, not a warning.

At minimum reject:

- wrong or replayed `RunId`;
- wrong nominal model type;
- stale/wrong graph digest or generation;
- wrong instance;
- stale/wrong parameter version;
- wrong execution profile;
- overflowed version counters;
- duplicate commit/publication.

Saved activations, backward envelopes, optimizer work, staged actor messages, accelerator events and resumable continuations bind the same relevant stamp. A value-only equality check is insufficient provenance.

## Execution profile and compiled-plan cache

The sole normative v1 derivation is `MODEL_EXECUTION_PROFILE_DIGEST_V1.md` and its golden vectors. Backends must derive this digest from validated execution semantics; callers do not supply an arbitrary cache identity.

`ExecutionProfileDigest` binds semantics that can alter code/results/safety, including:

- backend semantic version;
- compiler semantic version;
- target triple / data layout;
- enabled numeric features and rounding/fast-math policy;
- deterministic/reference mode;
- allocation/preallocation contract;
- device/kernel ABI where relevant;
- freestanding/hosted capability selection.

A compiled-plan cache key is at least:

`(GraphDigest, ExecutionProfileDigest)`

Backend-local implementation caches may add target/compiler/toolchain keys. They must not remove either component.

A portable reference-evaluation profile should remain available for cross-backend conformance. Optimizations such as fusion/CSE/reordering require equivalence under the selected numeric profile.

## Serialization and transport

Serialized model metadata is inert data. It may contain versioned graph identity and public parameter values, but never raw pointers, borrows, code addresses, closures, mutable leases, actor authority, registry objects or executable operator code.

On load/receive:

- resolve operation identity against a trusted local registry;
- verify ABI, implementation digest/provenance policy and resource/profile support;
- recompute/verify canonical graph identity;
- allocate/own new local instance state explicitly;
- reject unknown versions, oversized descriptors and semantic drift.

Remote actor/GPU/distributed placement does not weaken these rules. Transport identity is additional metadata, not a replacement for model/run identity.

## Backend acceptance gates

Java/Graal and LLVM must execute shared tests proving:

1. static argument/default changes alter graph identity;
2. same ABI + different implementation digest alters graph identity;
3. descriptor canonicalization is byte-for-byte identical for the same source/registry inputs;
4. graph generation does not change merely because parameter version changes;
5. stale graph/parameter/profile/run stamps reject before mutation;
6. duplicate commit/replay rejects;
7. counter overflow fails closed;
8. hot reload cannot consume old activations without explicit migration;
9. compiled-plan cache keys include graph + execution profile identity.

Host/schema tests are useful reference evidence only. Promotion requires executed compiler/backend tests on exact source heads.
