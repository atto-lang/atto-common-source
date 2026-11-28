# OTP parity: pg and ETS contract v1

Status: normative behavioral contract. This does not claim source-level backend parity yet.

## Goal

Oreslang targets Erlang/OTP capability parity where the model is strong, while
rejecting legacy ambiguity and ambient global state. `pg` and ETS are part of
the public OTP inventory, but their semantics are expressed through Oreslang
actors, typed values, ownership domains, bounded resources and explicit
distributed-consistency choices.

## pg

`otp/pg` is a named/scoped facade over the existing ActorGroup cooperation
primitive. It must not introduce an independent membership engine.

Required properties:

- membership identity is `(runtime, actor id, generation, scope, group name)`;
- duplicate join of the same membership is idempotent and consumes no second
  quota slot;
- join/leave/actor retirement/group close reclaim bounded membership capacity;
- membership never grants lifecycle ownership, stop/cancel authority or access
  to another actor's private memory;
- local join/leave/close/member snapshots are linearizable with the local
  ActorGroup admission boundary;
- a distributed scope may provide strong eventual membership convergence, but
  it must advertise that explicitly and must not masquerade as consensus;
- message fanout remains typed ActorRef/mailbox delivery. A membership snapshot
  is discovery, not an acknowledgement, durable delivery guarantee or lock;
- stale membership capabilities and actor-generation reuse are rejected.

The default API should therefore expose a typed `ProcessGroup<Message>`, a
scoped membership handle, `members()` / `local_members()`, and explicit
leave/close. Distributed scopes must name their consistency policy.

## ETS

`otp/ets` is a runtime-owned shared table domain. It is not an actor heap and
must never expose raw mutable references into actor-private arenas.

Required properties:

- tables are generic over key/value types and retain concrete types under AOT;
- table capacity is explicit and bounded for freestanding/real-time profiles;
- `get`, insert/replace, insert-if-absent, remove, compare-and-swap/update and
  counter-style operations are atomic at their documented operation boundary;
- iteration/query snapshots have documented consistency and may not silently
  become unbounded copies;
- access policy is explicit: private, protected (owner writes / runtime peers
  read) or public (runtime peers read/write), with host/supervisor authority
  separately defined;
- owner-linked tables close on owner retirement unless transferred through an
  explicit ownership/capability operation;
- table storage is charged to a runtime/table memory domain, not an actor's
  private allocation domain;
- values crossing an isolation boundary obey ordinary Sendable/freeze/copy
  rules; storing a capability does not smuggle mutable actor memory;
- no untyped tuple-position keying or Erlang match-spec mini-language is
  required. Oreslang patterns/typed predicates should lower to bounded query
  plans where supported.

Initial table kinds are set/map, ordered set/map, bag and duplicate bag. A
backend may start with set/map only, but must reject unsupported kinds rather
than silently changing semantics.

## Explicit non-goals

- `pg` is not a distributed lock, leader election service or exactly-once bus.
- ETS is not durable storage and is not Mnesia.
- Neither facility creates hidden OS threads, ambient allocators or network
  dependencies in freestanding OTP.
- Neither facility weakens ActorGroup's existing separation between cooperation
  membership and lifecycle ownership.

## Conformance gates

1. Manifest/import closure admits both modules without host effects.
2. Java/Graal runtime tests prove bounded/idempotent pg membership, lifecycle
   separation, stale-generation rejection and local snapshot semantics.
3. Java/Graal ETS tests prove capacity enforcement, access policy, atomic
   insert-if-absent/CAS/update, owner retirement cleanup and runtime shutdown.
4. LLVM implements equivalent native substrates and differential tests.
5. Only after source `.ores` modules compile and execute on both backends may
   the manifest mark their source status implemented.
