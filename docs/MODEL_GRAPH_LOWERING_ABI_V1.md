# ModelGraph lowering, operator provenance and run identity — v1

**Status: PROPOSED / cross-backend contract.** This document refines the general-purpose model RFC. It defines the minimum semantic boundary Java/Graal and LLVM must share before `define model` can be considered implemented. It is not evidence that either compiler currently supports the feature.

## 1. Operation authoring and provenance

A model operation is not limited to ML layers. The compiler/linker may populate the resolved operation table from:

1. statically verified pure Oreslang declarations whose input/output/effect/ownership information is derived by the compiler; or
2. explicitly trusted native/accelerated manifests whose ABI, effects, target support, resource bounds and implementation digest are authenticated by the package/toolchain trust policy.

A source program may select a nominal operation and provide compile-time configuration, but it may **not** self-assert that an operation is pure, differentiable, allocation-free, hard-real-time-safe, cheap, or ABI-compatible. Those facts come from verified compiler analysis or an admitted trusted manifest.

The long-term public authoring surface should reuse ordinary typed pure callables where possible. A library should not need a new compiler keyword for every domain. A compiler-visible `core::model::Op<I,O>`/annotation-style contract may expose model eligibility, but annotations are requests to verify, never authority by themselves.

Native/FFI operators require a stronger trust tier than pure Oreslang operators. Unknown or unverifiable cost/effect information is legal only in execution profiles that explicitly permit it; freestanding, bounded-memory and hard-real-time profiles fail closed.

## 2. Canonical lowering boundary

A parameterized declaration is a blueprint until every model formal used by an operation has been resolved from an explicit construction argument or validated default. `GraphDigest` is emitted only for the concrete resolved graph. Unresolved formals never enter the portable hash as source text.

The frontend lowers a model declaration to an immutable compiler-owned graph descriptor. Guest-controlled HIR contains structural references only. Resolved semantic metadata is attached by the compiler/linker.

Each resolved node binds at least:

- nominal operation identity;
- exact typed input/output ports;
- effect set;
- target/feature availability;
- operation ABI version;
- exact implementation/content digest;
- static configuration values after canonical constant evaluation;
- scratch/output upper bounds for profiles that require bounded memory;
- optional differentiation rule identity for requested gradient paths.

The implementation/content digest is distinct from the ABI version. Two operators can have the same ABI and different semantics; caches and graph identity must not treat them as interchangeable.

No compiler pass may replace an operation with another implementation unless the selected optimization profile proves the required equivalence contract.

## 3. Identities are deliberately separate

Do not collapse these concepts into one integer or pointer:

- **model type identity** — nominal declaration/package identity;
- **graph digest** — content digest over canonical typed graph, resolved operation identities, implementation digests, ABI versions and static configuration;
- **graph generation** — publication/hot-reload epoch for a live deployment;
- **instance identity** — identity of independently owned mutable model state;
- **parameter version** — monotonically advancing version of mutable parameters/state snapshots;
- **execution profile digest** — binds target, numeric/reproducibility policy, compiler/runtime semantic profile and admitted backend capabilities;
- **run identity** — one execution/training/simulation request.

A raw pointer, actor ID, object hash, memory address or process-local symbol is never a serialized graph/instance identity.

## 4. Run stamp

Every stateful execution that can outlive one call frame carries an immutable run stamp:

```text
ModelRunStamp {
    run_id,
    model_type_id,
    graph_digest,
    graph_generation,
    instance_id,
    parameter_version | none,
    execution_profile_digest
}
```

The stamp is checked before using saved activations, delayed continuations, actor messages, asynchronous tasks, cached compiled plans, optimizer commits or hot-reload handoff state.

A mismatch fails before mutation/publication. Never silently relabel a stale activation or continuation with the newest generation/version.

Stateless models use `parameter_version = none`. A parameter commit against a stateless instance is invalid.

## 5. Compiled-plan cache key

A compiled plan/cache key must bind at least:

```text
(graph_digest, execution_profile_digest)
```

The execution profile digest is derived exactly by `MODEL_EXECUTION_PROFILE_DIGEST_V1.md` and already binds backend/compiler semantic versions, target/data layout, numeric mode/features, allocation policy, freestanding selection and optional device ABI. Backend caches may additionally bind build/toolchain provenance, but must never omit either digest.

It must **not** use mutable instance ID or parameter version as code identity unless specialization explicitly embeds those values. If parameters are constant-folded, their content/version becomes part of the specialization key.

Cache hits must re-check target capabilities and trust provenance. ABI equality alone is insufficient.

## 6. Versioning and hot reload

A new graph implementation/configuration produces a new graph digest. Publishing it produces a new graph generation. Existing runs may finish against their pinned immutable graph/parameter snapshots if the runtime retains those resources; they may not cross into the new generation.

Parameter publication increments parameter version without changing graph digest when graph semantics and shapes are unchanged. Shape/layout/op changes require a new graph digest/generation and explicit migration.

Version counters are checked for overflow and are never allowed to wrap. Distributed or persistent systems should additionally bind durable monotonically ordered publication identity rather than relying only on a process-local counter.

## 7. Cross-backend conformance

Java/Graal and LLVM must emit equivalent canonical semantic descriptors for the same admitted source:

- same nominal model type identity inputs;
- same node order/topology and port types;
- same diagnostic class on rejection;
- same resolved op ABI + implementation digest set;
- same checked resource bounds for the selected profile;
- same graph digest algorithm/version.

Backend-specific machine code and layout details are not part of the portable graph digest unless the model explicitly selects a backend-specific operation. Backend plan caches add their backend/target profile separately.

## 8. Required negative cases

Both compilers must reject or fence:

- guest-forged effect/VJP/cost/ABI/implementation metadata;
- unknown or ambiguous operation resolution;
- same ABI with mismatched implementation digest where exact semantics are required;
- stale graph generation;
- wrong instance identity;
- stale parameter version;
- wrong execution profile;
- continuation/activation replay into another run;
- parameter-version overflow;
- hot reload that attempts implicit shape/state migration;
- cache reuse across incompatible targets or semantic profiles.

The source-free reference oracle in this PR checks only the identity/fencing rules. Production implementations must use compiler-owned immutable descriptors and must not expose arbitrary host-language objects/proxies at this boundary.
