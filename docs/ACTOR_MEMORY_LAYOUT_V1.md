# Actor-local memory and data-oriented layouts v1

**Evidence boundary:** This is a source-free executable *reference oracle*. It is not an Oreslang parser/compiler, production runtime, shared-domain arena, OS sandbox, or proof that any of the five backends executes the cases. Source-free CI must not promote reference-model passes to guest/compiler parity.

## Files

- Normative cases: [actor-memory-layout-v1.json](../contracts/v1/actor-memory-layout-v1.json)
- Model: [actor-memory-layout-v1.mjs](../scripts/actor-memory-layout-v1.mjs)
- Baseline tests: [actor-memory-layout-v1.test.mjs](../tests/actor-memory-layout-v1.test.mjs)
- Adversarial tests: [actor-memory-layout-hardening.test.mjs](../tests/actor-memory-layout-hardening.test.mjs)
- Run locally on Node 22.16.0: **node --test tests/actor-memory-layout-v1.test.mjs tests/actor-memory-layout-hardening.test.mjs tests/actor-memory-message-lifetimes.test.mjs**

**ActorArenaOracle** models bounded persistent and turn-scoped scratch allocations, issued opaque capability identity, actor incarnation, read-only loans, deterministic scrub/free, and physical retirement gated on active loans, tasks, and external callback pins. An ActorRef is NOT memory authority. Every actor kind, including SHARED, owns its ordinary mutable memory. Explicit shared arenas have their own semantics; see [SHARED_DOMAIN_ARENAS_V1](../contracts/v1/SHARED_DOMAIN_ARENAS_V1.md).

**DenseRegionOracle** models F64 dense regions, one authoritative mutable layout per epoch, transactional copy-on-conversion with checked budgets, stable opaque entity identity, and swap-delete. The model does not secretly maintain four simultaneously mutable layouts.

## Physical indexing

For row r, field f, total field count F, and tile width T:

- AoS: row-major, index = r * F + f
- SoA: field-major, columns[f][r]
- AoSoA: tile/field/lane, index = floor(r/T)*(T*F) + f*T + (r%T)
- SoAoS (serialized identifier soaos): tile/field-group/row/small-struct-field. Fixed field-group width G=2 for this F64 reference. Let first=2*floor(f/2), width=min(2,F-first). Index = floor(r/T)*(T*F) + first*T + (r%T)*width + (f-first).

SoAoS and AoSoA are not aliases. Unlike the earlier tile/row/field formula (which accidentally reproduced AoS), SoAoS now groups pairs of fields before laying out small row structs. For a schema with three or more fields, all three modes produce distinct physical index permutations. With a single two-field group, SoAoS and AoS may coincide, which is permitted. Both tiled layouts account for padded capacity, but padding is never exposed as logical guest rows. The reference restricts values to finite F64 fields; it does not establish full numeric semantics, generic type layouts, real cache locality, SIMD, GPU execution, or native allocation patterns. Incoming row values are detached using own data property descriptors, and sparse/accessor-backed or reentrant input is denied before state mutation. A borrowed backing rejects re-layout before any temporary allocation. Each of the four classes of live authority (allocations, read loans, lifetime pins, tasks) is bounded to 4096. Payload bytes are charged to actor memory, but JS Map/handle metadata is **not** counted toward the byte quota; this is a source-free reference, not a production allocation-accounting proof.

## Five-backend implementation gates

1. **Java/Graal:** actual guest object, actor state, lexical and continuation allocations routed to native arenas, then Truffle JIT and Native Image tests. Extend [java #1822](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1822).
2. **LLVM:** real source-compiled actors with owned native heaps and typed SoA columns; execute compiler/native sanitizer tests. Extend [llvm #657](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/657).
3. **.NET:** per-actor **unmanaged** arenas with issued checked handles and Native AOT source execution. CLR managed GC remains for runtime objects; Server GC heaps are not actor-private. Reconcile [net #63](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/63) / [net #90](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/90).
4. **Wasm:** actor-owned private linear memories or verified disjoint bounded regions; source actor lowering and host lifecycle tests. Extend [wasm #34](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/34).
5. **JS:** source actors executing in Web Workers with ownership-aware transferable buffers; workers alone are not an OS hostile-code sandbox.

Each backend must also prove the single state schema and verified critical state loans, capability-checked messaging, and stable layout/ECS semantics using **executed guest source**.

## Evidence and security

A backend result requires exact source/tree/compiler/toolchain/fixture/artifact identities, nonzero executed CI steps, actual compiled guest runtime behavior, and independent provenance review. A job with zero executed steps is NOT_EXECUTED, not compiler success or failure. Unsupported is UNSUPPORTED, not passed. The source-free reference tests alone must never promote any backend.

Private source transfer to another GitHub organization requires explicit reviewed destination authorization, verified repository identity, and protected provenance gates. No code in this PR performs private-source transfer.

## Non-goals

This first slice does not implement a frontend, actor schedule, a true actor-private OS process, native guest GC elimination, SIMD, NUMA, affinity, or GPU kernels. It gives those implementations a deterministic semantic reference and adversarial test contract.

## Multiple in-flight message lifetimes (2026-10-24 hardening)

The original actor-global `nextTurn()` reset is retained only for a **strictly serial** legacy reference caller. It is **not** valid for actors with multiple outstanding messages. A suspended handler may resume on another carrier after newer messages have run, and its scoped temporary data must still exist.

The reference now issues opaque message-lifetime tokens using `startMessage()`, `suspendMessage(token)`, `resumeMessage(token)`, and `completeMessage(token)`. This is **reference-model API, not claimed Oreslang source syntax**. At most one message token owns the actor's physical execution lane at a time. New messages can begin while previous messages are suspended, but scratch allocations are attributed to the exact message, cannot be accessed from another message's lane, and are scrubbed at that message's completion. Persistent actor-owned data remains until independently freed or actor retirement.

Suspension rejects outstanding read loans from the executing message. A legacy global scratch allocation or an outstanding legacy read loan must first drain before entering the multi-message mode. On retirement the actor seals new operations immediately, then waits for outstanding messages **and** tasks/pins/loans before physically reclaiming. A late scheduler completion can free a suspended message after seal without resuming guest execution.

**Proof level:** source-free JavaScript oracle; tests in `tests/actor-memory-message-lifetimes.test.mjs`. Do not count this as GraalVM, LLVM, Native AOT .NET, Web Workers or Wasm guest execution, and do not use a host reference pass to certify source actor lowering.

Additional hardening: external lifetime pins and descendant tasks issued while a message owns the execution lane are **bound to that message**, not just to the actor. Message completion cannot scrub its scratch while such pins/tasks are still outstanding; it must wait for their release, including late off-carrier callbacks. An unrelated newer message can finish and scrub its own scratch independently. This is a conservative reference constraint, not an extension of lifetime pins into byte read/write capabilities.

Serial-compatibility safety follow-up (2026-10-24): `nextTurn()` now fails closed when a legacy scratch allocation exists alongside any active external pin or descendant task. A callback or task might still retain that temporary lifetime after the actor transitions turns. Persistent allocations continue across turns with ordinary actor ownership checks. These host-oracle checks are not executable guest proof.

### Quiescent physical lane during overlapping messages (2026-10-24)

The initial message-lifetime hardening prevented access to *scratch* owned by a suspended message, but the source-free oracle could still mutate *persistent* actor state, issue a new external pin, or start a child task after every message had suspended and the physical actor lane was empty. This breaks actor lane exclusion and allows the next executing message to observe an unauthenticated mutation.

While one or more message lifetimes are outstanding, only an executing message may allocate, read, write, borrow, or free persistent state, or issue new external pins/child tasks. Existing callback pins and child tasks may be **released off-carrier**, and a suspended message can be completed after the retirement seal once its dependencies drain. The legacy direct reference mode remains available only when no message lifetime is outstanding.

This is a fail-closed model admission contract; it does not grant general user access to actor state. Actual Oreslang actor `state { ... }` access still requires the compiler-verified critical state loan and real runtime authority tests.

### Dense storage lane authority (2026-10-24)

Each of AoS, SoA, AoSoA and SoAoS uses actor-owned persistent backing. Read, write, insert, erase, change-of-layout and close require the actor memory authority of an executing message if any message lifetime remains in flight. Failed off-lane operations leave row identities, physical layout and actor quota unchanged. A later admitted message may perform legitimate updates; an earlier suspended message reads that shared actor-owned persistent state when resuming. This is a reference-model result, not compiled Oreslang source actor parity.
