# Atto guest Ref32 origin provenance — security audit and implementation gate

**Status:** candidate target, no general compiled `.atto` Java/LLVM guest support asserted.
Companion: [Atto storage proposal #91](https://github.com/atto-lang/atto-spec/pull/91), this repository's actor-memory draft #13, LLVM compact heap #21 and child Ref32 host adapter #27, Java FFM host adapter #26.

## Finding: 4-byte generations do not carry actor identity

The candidate guest token uses 20 low slot bits (1..1,048,575) plus 12 generation bits (1..4,095), with zero invalid. **Both actors A and B may allocate slot 1, generation 1, and produce the identical numeric Ref32**. Looking up A's bare token in B's heap *as though it originated in B* may silently access B's object. Checking the *current* actor owner and the token generation is insufficient unless a trusted source-domain proof is maintained. Raw Offset32 is even weaker, because reuse can revive a stale address.

No four-byte self-contained token can guarantee unforgeable actor/domain identity, generation exhaustion safety and arbitrary dynamic graph identity across unlimited actors. A full process-wide capability needs a larger token or trusted out-of-band metadata. A one-word token is safe only under a proven **actor-local namespace** discipline.

## Mandatory typed IR admission

1. Every guest reference is a distinct typed `GuestRef32<T, domain>` in internal HIR/MIR (this is **not new public Atto syntax**). `domain` identifies a statically checked allocation owner/actor incarnation, plus lifetime/loan provenance. Do not erase it to a raw scalar `int` or cast it into an `ActorRef<T>`.
2. Compilation resolves `place`, `owner_domain`, `lifetime`, `type_id`, `mutability` and `effect` for each read, write, borrow, move, destructor, return and call. Only code proven to be executing in the matching actor domain may resolve the four-byte token. A raw actor message cannot carry a guest reference (even if source & destination numeric values happen to coincide).
3. Runtime sidecars check slot bounds, nonzero generation, live allocation, non-retired generation, type ID, payload offset/length/alignment, and current owner/incarnation. A trusted *host-only* wrapper may carry `origin` independently; untrusted guest code cannot submit an arbitrary origin witness.
4. Borrowed references do not escape their owner, are not upgraded into owned/droppable handles, and cannot survive suspension without a proven pinned frame. A `take!` to a different actor domain requires actual transfer/rebasing in a brokered region or an independent serialization/copy; the Ref32 numeric token alone is never portable.
5. Free increments generation **without wrapping**; generation 4,095 retires the slot permanently for that actor incarnation. STOP quiesces users, scrubs storage and retires every token; restarting the same actor slot must not revive old tokens.
6. Distinguish compact guest ref from both `HeapOffset32` (raw byte offset under a compiler proof) and native C/Java host pointers (`uintptr_t`, `MemorySegment`). ABI v4 raw Offset32 must not be reclassified as a secure generational object reference without an explicit version bump and compatible callers.
7. LLVM actor-slab host tests and Java FFM host tests may prove their own host adapter behavior but not the typed frontend, static provenance HIR/MIR, actual compiled `.atto` guest, isolation from arbitrary native instructions, or process-wide GC properties.

## Conformance acceptance

The 12-case target registry in `contracts/ref32-origin-provenance-v1.json` must be implemented by the canonical frontend and each backend. For a case to be `PASS`, record exact source HEAD/tree SHA, exact fixture blob SHA, compiler artifact SHA, executed positive guest or required compile-time rejection before guest emission, and native sanitizer evidence where applicable.

Critical adversarial case: two actors allocate slot #1 at generation #1, yielding the **same 32-bit word**. Passing A's token into B's checked data path must be rejected for origin mismatch, not silently interpreted as B's valid object. A host-side origin witness cannot replace the compiler/guest boundary proof.

**Security limit:** actor-private allocations and Java shared arenas are not arbitrary native-code sandboxes. A malicious tenant needs a separate enforced execution boundary. This document does not approve general guest loading or claim hard real-time allocation latency.
