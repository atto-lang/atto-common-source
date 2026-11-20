# Shared-domain proxy source contract v1

Status: **proposed source/lowering contract; runtime integration pending**. This contract stacks on shared-domain arena v1 and does not certify any backend guest implementation.

## Public capability model

Oreslang has two distinct sharing operations and they must not be silently conflated:

- `rt share value` obtains an approved shared-ownership capability for values whose type, lifetime, transport, synchronization/freeze and allocation-domain policy allow sharing. It is **not** an ambient mutable-memory escape hatch.
- `rt proxy value` consumes the unique move-only owner and produces `Proxy<T>`, the explicit synchronized mutable-sharing capability. The original raw owner becomes unusable.

`Proxy<T>` is the guest surface for mutable shared-domain storage. Domain IDs, generations, scheduler principals, arena handles, grants and raw pointers are never guest values. `ActorRef<T>` remains mailbox authority only and never implies proxy/shared-memory authority.

## Access lowering

Every proxy access is compiler-classified before lowering:

- immutable/scalar field or index read -> internal **critical read** lease;
- field/index mutation -> internal **critical write** lease;
- method with a proven readonly receiver/effect contract -> critical read;
- all other methods -> critical write conservatively;
- nested class/struct results are rewrapped as child `Proxy<U>` views in the **same lock/domain**, never exposed as raw mutable aliases.

The conceptual labels `critical-read` / `critical-write` in the arena contract map to source/compiler modes spelled `critical read` and `critical write` where an explicit callback form is required. Applications normally access `Proxy<T>` members directly; the compiler owns lease acquisition/release.

## Suspension boundary

A contended proxy access is a scheduler suspension point **before** its critical lease begins. Admission must not park an actor/root carrier. The runtime records a bounded continuation and resumes only through a scheduler-owned wake for the same logical actor/task and ticket.

Once a critical read/write lease has begun, the body is strictly non-suspending. It may not cross:

- `await`, `select`, channel blocking/suspension, generator yield;
- `*_blocking` implicit suspension;
- `rt cooperate`;
- arbitrary guest callbacks or reentrant cross-domain proxy calls;
- actor send/spawn paths that can invoke user work inline;
- FFI/I/O whose implementation can suspend or callback.

Queued cancellation removes the waiter. Cancellation or retirement after admission unwinds the lease exactly once. No callback producer thread may resume guest code directly.

## Ownership and escape

- `rt proxy` consumes its source owner exactly once.
- `Proxy<T>` itself is opaque and non-forgeable; no numeric address/domain conversion.
- A raw mutable value, pointer, borrow, callable, host capability, or other move-only child may not escape a proxy read.
- Cross-proxy nesting across different lock domains is rejected in v1; same-domain child proxies are allowed.
- Read-to-write upgrade while holding a read lease is rejected.
- Proxy capability serialization is rejected. Private/untrusted actor transport is rejected unless a later isolation-safe design explicitly supersedes this rule.
- Explicit disposal/revocation is monotonic and stale generations never regain authority.

## Runtime binding

Backends lower proxy admission to the shared-domain runtime substrate:

1. CONTROL/runtime creates the shared domain and membership; guest code cannot mint membership.
2. The scheduler derives the current execution principal/incarnation. Guest code does not pass actor IDs.
3. FIFO logical admission reserves a read/write ticket. A queued writer prevents later reader barging.
4. The scheduler resumes a queued access through a dedicated capability wake, not the user mailbox or supervisor CONTROL slot.
5. Only then does the runtime acquire physical shared-region byte authority.
6. Physical lease release precedes logical handoff/wake publication.
7. Continuation/FFI/I/O owners that outlive a turn use separate lifetime-only pins with no byte authority.

## Effect contract

Proxy access has two phases:

- **admission** may suspend on contention and therefore must participate in suspension/effect checking;
- the admitted **critical body** cannot suspend.

A callable proven non-suspending may use a proxy only where admission is statically/runtime-proven uncontended under a separately certified rule; v1 makes no such general proof and therefore compilers must conservatively treat potentially contended proxy access as suspension-capable.

## Backend honesty boundary

- Java/GraalVM has historical draft `rt proxy` source/runtime work, but it must be reconciled with the current shared-domain arena, lifetime-pin and scheduler contracts before support is claimed.
- LLVM has a current trusted-host shared-domain scheduler bridge candidate, but no compiled `Proxy<T>` guest lowering yet.
- .NET, Wasm and Forge guest proxy lowering are unsupported.
- `rt share` remains a separate ownership operation and must not be implemented as an unchecked cast to `Proxy<T>`.
