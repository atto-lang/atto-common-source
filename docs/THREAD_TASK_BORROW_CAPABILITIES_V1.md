# Thread- and Task-aware borrowing: execution capabilities v1

Status (2026-10-18): **proposed cross-backend semantic contract only**, not implemented guest language functionality. Java/Graal and LLVM retain independent ownership checkers. Nothing in this change makes a source program admissible or proves data-race freedom.

## Decision: pass authority, not a thread

A physical carrier thread, OS thread ID, cloneable handle, actor ID, Task ID or code pointer is not proof of exclusive access to data. Executable code can be shared among carriers. Borrow checking instead tracks typed **places**, mutable and immutable **loans**, unique owners, allocation/trust domains, and authenticated execution/scope capabilities. Function parameters transfer or reborrow those permissions, and call summaries account for hidden effects/captures.

A capability must be minted by the compiler or trusted runtime, unforgeable by guest code, non-duplicable when exclusive, bound to a specific resource and lifetime, and non-escapable. A mutable loan of a ThreadToken alone does not prove a separate CollisionData argument is unaliased: that argument needs its own exclusive loan or a checked proof linking token and resource.

The useful abstraction is **Access<Region, Mode, Scope>** in the internal type/effect system. It need not be a public source type or heap object. Modes are READ (coexisting, deeply read-only) and WRITE (exclusive against READ and WRITE for intersecting places). Each loan also records provenance and a trusted loan generation. Carriers can migrate while these logical proofs survive; explicit ThreadBound<T> is a separate, deliberately pinned affinity API and cannot migrate.

## Code ownership is a separate lifetime problem

Many Tasks or threads may execute the same immutable compiled function body simultaneously. There is no reason to move or copy the instruction bytes to the thread. Passing a callable across a Task boundary instead requires: (a) verified transfer/shareability of its *captured environment* and borrowed data, (b) a typed callable effect and ownership signature, and (c) a **CodeVersionLease** or equivalent runtime-issued pin for the compiled module generation. The code lease prevents JIT eviction, dynamic-library unloading, hot-reload retirement or stale function-pointer use while any executing/suspended Task, callback, FFI trampoline or destructor may return into that code generation. This lease is not write permission to user data.

Oreslang hot reload should publish the new module generation atomically, allow existing Tasks to finish under their pinned old generation (or cancel and physically drain them), and reclaim old code only when all code leases and continuation/FFI references have retired. An actor incarnation or code-generation ID is not an ownership token for mutable data. The two resources—code lifetime and data access—must be tracked independently.

## Compilation rules

1. **Move across a Task boundary.** A captured non-Copy value moved using existing rt take becomes inaccessible to its former owner immediately after successful admission. Failed scheduling/admission must restore ownership transactionally. Concurrent sibling Tasks cannot both receive a unique owner. The transfer must stay within an approved allocation/trust domain or use a checked RegionTransfer/transport boundary.
2. **Shared borrowing across a Task boundary.** Multiple rt borrow READ loans are permitted only when the referent is transitively read-only throughout all borrowers, and its type is safe to access concurrently. Sharing a shallow const wrapper around interior mutability or a host/FFI pointer is not sufficient. The compiler may encode an internal thread-shareability predicate; it must not equate actor-mailbox Sendable or Serializable with shared-memory thread safety.
3. **Exclusive borrowing across a Task boundary.** Exactly one WRITE loan of an overlapping place may be active in the scope. Distinct fields/columns or checked nonoverlapping partitions can be borrowed in parallel. The owner cannot read, write, move, free, reallocate or structurally mutate a borrowed place until the Task quiescence barrier.
4. **Structured TaskScope.** A proposed TaskScope API guarantees that all child work has *physically quiesced* and all destructors/FFI/device pins and loan-retirement hooks are complete before the parent exits, including exception, panic, STOP or cancellation paths. Cancelling a token or dropping a Task<T> handle is not by itself a join. The existing nb { } / do nb { } / await vocabulary remains; scoped and detached captures have different obligations.
5. **Detached Task.** do nb { } may not capture a stack/actor/local mutable borrow whose lifetime cannot be proven. It can capture transferred owned data or an expressly approved independently-lifetimed immutable shared handle.
6. **Function calls.** Infer and verify exact read/write projections transitively through arguments, receiver, higher-order closure captures, generic instantiations, dynamic dispatch and FFI summaries. Where a target cannot prove sound disjointness, serialize or reject. An annotation is a checked upper-bound declaration, never a grant.
7. **Suspension.** Existing ordinary borrows and actor state loans remain prohibited across await, yield, blocking channel/select, or deferred registration unless there is a separately proven scoped continuation-owned, pinned-lifetime protocol with scheduler exclusion and cancellation cleanup. A worker migration must not revoke or duplicate logical permissions. A cooperative safepoint does not prove quiescence.
8. **Actor boundary.** An actor-state Access token is valid only for its admitted turn/critical gate, incarnation, specific region and authorized continuation. It cannot become a process-global capability by passing into a Task, function, ActorRef or mailbox. With multi-carrier actors, read/write admission must be real synchronization and not just a thread-ID comparison.
9. **Storage independence.** A field/column borrow is zero *payload copies*, not necessarily zero synchronization/atomic cost. Scoped immutable Arc<T> sharing may incur atomic reference-count traffic. Tasks still require dispatch, wakeup and join synchronization. Mutable Arc<T> does not become safe by reference counting.
10. **Freestanding.** The place/loan/move checker and static capability validation belong to core semantics; an allocator, threads, atomics, clock, hosted async executor and actor runtime are not mandatory. Actual TaskScope/Arc/OS thread execution is profile-gated.

## Execution examples (proposed API, NOT current executable syntax)

~~~ores
// Execution context is a scope, not a physical thread.
fnc update_positions(borrow mut PositionColumn positions,
                     borrow VelocityColumn velocities): void {
  // A WRITE loan of positions, a READ loan of velocities.
}

// Exactly disjoint mutable partitions; no lock per element.
let (left, right) = positions.split_at_mut(middle);
TaskScope.run(scope => {
  scope.spawn(nb { integrate(rt borrow mut left); });
  scope.spawn(nb { integrate(rt borrow mut right); });
});
// Both children fully drained; reborrow positions allowed again.
~~~

A split is sound only if the original unique owner is frozen while both halves live, the offsets are bounds-checked without overflow, the two views have disjoint backing memory, and structural operations cannot invalidate either view. A half-split does not imply separate owning allocations.

~~~ores
// Invalid: the second worker attempts overlapping WRITE authority.
TaskScope.run(scope => {
  scope.spawn(nb { update(rt borrow mut positions); });
  scope.spawn(nb { adjust(rt borrow mut positions); }); // ownership error
});
~~~

~~~ores
// Passing an opaque copyable thread ID doesn't authorize write access.
fnc update(ThreadId id, borrow mut PhysicsState state): void {
  state.step(); // safe *because of borrow mut state*, not id
}
~~~

## ECS / SoA / inverted-class consequences

A field-sensitive place key includes allocation provenance, stable world/region identity, component or inverted-class column, row partition or checked index range, and a layout generation. For dynamic ECS queries, the compiler verifies declared component effects and the runtime scheduler checks actual live resource footprints at schedule build/admission. READ/READ runs together; READ/WRITE and WRITE/WRITE of intersecting footprints conflict. Conflicts cause a dependency/serialization or an explicit admission failure, not arbitrary unsafe parallelism. Conflict serialization does not require reusing the same OS thread. Unknown dynamic aliases and unverified interior mutability require conservative whole-region conflicts.

Structural ECS mutations, layout migration, reallocation, entity destruction, actor-domain revocation, GPU transfer and hot reload require barriers covering all outstanding scoped loans, pins, dispatches and destructor actions. Scheduler-side synchronization for dynamic work is not a substitute for static source-level safety.

## Proposed implementation pipeline

- Frontend: place-sensitive loan sets, affine captures, interprocedural read/write/effect summaries, escape and suspension diagnostics; sound Send/Sync-like **internal** predicates distinct from actor Sendable.
- HIR: resource identity, projection path, access mode, lifetime/scope, provenance, capture kind, effect summary, target feature requirements.
- MIR: loan acquire/reborrow/split/end, Task spawn-admission, completion/quiescence barrier, exceptional cleanup, rejoin, and drop sequencing; verifier rejects overlapping live WRITE loans and dangling destinations.
- Runtime: scheduler-minted generation-fenced scope/loan IDs, atomic publication as required for cross-carrier handoff, cancellation/drain, exception-safe retirement, and optional dynamic ECS conflict scheduler. Runtime may validate a static proof, not substitute a host thread ID.
- Backends: both independent compilers reject unsupported cases without generating runnable unsafe code; only remove pending markers after exact-head guest compilation and execution.

## Adversarial release gates

Positive: unique move to Task, sibling READ/READ, field-separated WRITE/WRITE, checked nonoverlap split, scoped reborrow after drain, nested function authority forwarding, carrier migration preserving logical identity.

Negative: same-place WRITE/WRITE, READ/WRITE, copied token, forged token, moving owner during child borrow, detached borrowed capture, scoped lifetime escape, borrow across unproved await/select, cancellation-before-physical-drain, FFI hidden alias, closure capture escape, dynamic ECS alias/layout change, stale scope generation/ABA, actor-private pointer crossing trust boundary.

Test success requires actual guest source compilation/execution on each claimed backend; static manifest validation and host-only mocks are labeled contract-only.

## Existing anchors

- Java proposed shared-storage/ECS Task design: oreslang-source.java PR #1423, docs/SHARED_STORAGE_ECS_TASKS_V1.md.
- Java Task cancellation stage-1: PR #1402 (host primitive only).
- Java multi-carrier and actor-state RW audit: docs/MUTEX_PARALLEL_ACTOR_AUDIT_20261018.md and issue #1349.
- Common ownership syntax/boundaries: docs/OWNERSHIP_SYNTAX.md and docs/OWNERSHIP_BOUNDARY_AUDIT.md.
- Native and Java compiler feature parity must be demonstrated independently.

