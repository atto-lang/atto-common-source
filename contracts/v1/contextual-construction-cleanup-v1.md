# Contextual allocator and construction cleanup ABI — v1 candidate

This contract specifies the compiler-to-runtime semantic boundary, not a frozen binary calling convention or a claim of production support. It complements contextual-allocation-events-v1 and the actor-memory/Ref32 contract. A backend may select its own physical representation provided it proves the same typed operations, context identity, and reclamation behavior.

## Allocator operations

- The compiler passes an opaque, live allocation-context capability through typed IR, calls, and saved task frames. Ordinary `new` uses the actor or main-loop context; an explicit allocator selection is evaluated once and checked before allocation. Never derive authority from a raw integer, a guest address, or only the carrier thread.
- The compiler supplies a statically checked layout descriptor (size, alignment, field offsets, drop descriptor), not guest-supplied unchecked metadata. Size/alignment and quota calculations are checked before reserving. A reservation returns either an opaque unique live allocation lease or a typed denial; denial does not reserve bytes, modify existing ownership, or fall back to host GC storage. Native resource failure is distinct from quota exhaustion.
- Allocation, initialization, publication and ownership transfer are different operations. Uninitialized bytes must never be exposed through a normal object reference. Initialize fields exactly once in declaration/initialization order; only a completely initialized object can be published.
- On constructor failure, return, or cancellation, invoke drops only for the successfully initialized fields in reverse initialization order, then release the exact reservation. No destructor runs for an uninitialized field. Normal destruction runs the complete reverse sequence. Runtime policy for a failing destructor requires a separate contract; no silent leak or second destruction is permitted.
- A successful move transfers the unique obligation, not an additional allocation. A move failure leaves the source obligation intact. A borrowed reference cannot publish or release an allocation. Suspended frames retain the cleanup obligation until resumed or cancelled; retirement requires no live obligations.
- Native/managed backend glue must not silently allocate on the process-managed heap. Atto-owned allocations and metadata, including drop and unwind state, are charged to the active contextual allocator. Explicit authorized host interop uses its separately measured profile.

## Bounded construction ledger

The accompanying reference checks one compiler-emitted construction trace with a declared field count (0–64), an allocator result, initialization prefix, publication, move, unwind/drop and release. It deliberately excludes actual field values, multiple objects, destructors that throw, async execution, physical allocator bytes, and authority authentication. All operations are closed records; a trusted observer supplies parsed events. It returns `certified:false`. This is a reference for compiler/drop-plan validation, not an allocator, runtime authorization, or full zero-GC evidence.

The compiler must establish the same obligations on every reachable normal and exceptional CFG edge, including partial initialization and cancellation, before using this ABI. Unsupported cases fail before executable artifact publication.

Run `node --test tools/contextual-construction-cleanup-v1.test.mjs` for executable model tests. Backend conformance must additionally execute emitted guest code and observe real memory, drops, errors, and host allocation counters.
