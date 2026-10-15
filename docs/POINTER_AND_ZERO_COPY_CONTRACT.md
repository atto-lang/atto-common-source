# Oreslang Pointer, borrow, and zero-copy contract (draft v1)

**Status:** proposed shared language contract, **not** a claim of implementation or backend parity.
The Java/Graal draft [PR #443](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/443) implements a managed `Pointer<T>` with read-only `rt unref` / `rt deref`; LLVM main still rejects general pointers. Implementations must fail closed wherever a proof or lowering is missing.

## Definitions and memory model

A **value** has an inferred affine owner (no public `owned` modifier). A **place** is an addressable local/field/element with tracked provenance. A **loan** is compiler-enforced temporary access to a live owner. A **pointer handle** is not an integer address: it carries (or is statically associated with) target type, allocation domain, owner, lifetime, generation, bounds where applicable, and access mode. Representation may be optimized away if the proof remains valid. A pointer is **not** implicit actor-send, FFI, shared-memory, or heap-management authority.

`Pointer<T>` v1 is **affine and unique**. It strongly retains/owns one reference-backed `T`. It is not `Copy`, not automatically `Send`, not a raw pointer, and not constructible with `new Pointer<T>`, arithmetic, transmute, casts, or deserialization. A public raw-address escape cannot be exposed by ordinary guest code. A non-owning `borrow T` view is NOT a strong owning `Pointer<T>`.

## Operation matrix (snake_case names are canonical)

| Source operation | Value/result | Allocation/copy behavior | Required checks |
|---|---|---|---|
| `rt ref owned_place` | `Pointer<T>`, consuming a unique owned `T` | no **pointee** copy; Java PR #443 **allocates a wrapper** | live, initialized, unborrowed unique owner; named place or fresh owned construction; valid target domain and type |
| `rt deref pointer` | read-only `borrow T` | no pointee copy, no required allocation | live pointer, rooted loan, correct generation/domain/bounds; owner immovable while loan lives |
| `rt deref mut pointer` | exclusive `borrow mut T` (**future**, reject today) | no pointee copy, no required allocation | pointer held mutably, one unique writer, no other active loans, valid provenance |
| `rt unref pointer` | **currently** read-only `borrow T` only on Java PR #443 | neither release nor free | same protections as deref, until deliberate migration |
| `rt borrow value` / `rt borrow mut value` | non-owning shared / exclusive loan | no pointee copy | ordinary loan tracking; a borrow cannot be strengthened or promoted to owning pointer |
| `rt take pointer` | moved `Pointer<T>`; source invalid | no pointee copy; no required allocation | no active loan, no foreign alias; all exceptional exits have a drop plan |
| `rt copy pointer` | **reject** | a shallow pointer clone must not create another unique owner | only an explicit `T` copy protocol may produce independent storage |
| `rt share pointer` | **reject** until verified shared-pointer/frozen-value protocol | never silently manufacture a cross-actor alias | frozen immutability, Send/shareability, synchronized lifetime and domain |
| `rt unref borrowed_view` | **proposed future release of a loan**, not currently implemented | no free | consume exact live loan token, reject double release, aliases/descendants remain tracked |

**Do not silently change `rt unref` semantics on PR #443.** Its current access-alias interpretation conflicts with the natural meaning of ending a reference. Decide a versioned migration and update all compiler/runtime/example contracts atomically; until then it must remain an explicitly documented alias of read-only `rt deref`, never silently freeing/releasing memory. Explicit owner destruction should use a separately typed deterministic drop/close mechanism; it must wait for every outstanding loan, native I/O lease and continuation.

## Safe code requirements

- Loan identity follows **projected places** and alias chains, not just variable names. Reads coexist; any write conflicts with every overlapping loan. A view never upgrades to an owner through `as`, `as?`, tuples, `Option`, `Result`, closures, reflection, structural casts, method returns, or `rt ref`.
- `rt deref` returns a view, **not** a by-value `T`, even when the local variable annotation spells plain `T`. Mutable child objects and indexed elements remain transitively borrowed. Copying an individual `Copy` field is allowed.
- Moving, replacing, dropping, returning, sharing, or otherwise invalidating a pointer is illegal while a view or derived descendant is live. Reborrowed views must outlive neither parent loan nor owning pointer. Ending a nested loan cannot end an outer loan.
- Across `await`, `select`, `readch`, `*_blocking`, cancellation, callback, generator yield, deferred cleanup, exception edges, and hot reload: require explicit pinned/stable owner + lifetime proof **and** cleanup before admission, otherwise reject. A paused carrier thread is not a pinning proof.
- Actor heaps/arenas have generational identities; reject ABA/stale handles and cross-actor, cross-isolate or cross-tenant derefs. Quiescence includes active handlers, producer admissions, futures, native FFI leases, callbacks, drop glue, and all outstanding borrowed views. Never expose host `Object`/native `void*` as an unchecked guest pointer.
- Indexed/buffer views require checked bounds, alignment, initialization, provenance, and protection against reallocation or capacity-changing mutation while lent out. Zero-copy slices may carry `base + offset + length + epoch` internally; guest pointer arithmetic remains forbidden.
- Safe-source dangling pointers, null dereferences, double unref/free, racing mutable aliases, partial move violations, and stale generations **must** be rejected statically or through an authoritative typed dynamic check before access; unsupported cases must not emit executable code.
- Pointer operations that are statically verified must have no routine failure effect. Expected runtime failures at explicit unsafe/FFI boundaries should be typed `PointerError` / `Result` or declared `throws` with deterministic defer/cleanup. An invariant violation may escalate to `panic` (to the supervisor in an actor); `raise` and cancellation must never skip required drop glue.

## Zero copy != zero allocations

**Zero-copy** means no duplicate pointee/byte-buffer materialization. `rt deref` and `rt borrow` should normally compile to direct access without a guest allocation. `rt ref` of a fresh object still needs storage for that object; Java PR #443 additionally does `new OresPointer(value)` (one wrapper allocation). `rt copy` of a nontrivial `T` may allocate by definition. Capturing a loan in a heap closure, boxing a native pointer, constructing `Option`/future wrappers, or runtime bounds/provenance tokens may allocate unless eliminated or stored inline.

To build **zero-allocation steady-state loops**, allocate and size an actor-owned region or fixed-capacity buffer *before* the loop; use nonescaping borrowed slices/views, in-place mutation under exclusive loans, inline/stack handle lowering and bounded deterministic release. Guard reallocations, capacity growth, implicit clone, formatting, exception allocation, and async transport on hot paths. Cross-actor zero-copy is **not** permission for an untracked pointer to cross the boundary.

Instrumentation gates: report allocations per `rt ref`, `rt deref`, `rt borrow`, `rt take`, buffer slice, and hot-loop iteration, including JVM interpreter/Graal JIT/native image separately. Measure bytes and copy count (not just wall time); compare exact source trees, warmup and linked runtime; LLVM strict native must have no transitive tracing collector.

## Minimal illustrative source (proposed syntax; only supported subsets may compile)

```ores
define class Box as
  pub let int value = 7;
end

fnc read_value(borrow Box box): int {
  return box.value;
}

fnc use(): int {
  const Pointer<Box> pointer = rt ref new Box();
  const int observed = read_value(rt deref pointer);
  // A dereference view is loan-scoped; no pointee copy has occurred.
  const Pointer<Box> moved = rt take pointer;
  return read_value(rt deref moved);
}
```

The following must fail closed: `rt ref (rt borrow owner)`; `rt copy pointer`; `rt share pointer`; `rt take pointer` with live deref view; writing through an immutable deref; dereferencing a moved pointer; `rt deref mut` before exclusive-pointer lowering; `rt unref` used as a destructor on existing Java PR #443; pointer transport in actors/channels; opaque FFI pointer manufactured from an integer.

## Backend rollout and release gate

1. **Java/Graal**: audit the draft managed `OresPointer`, its caller/constructor authority and direct target exposure; add adversarial loan/cast/actor/reload/cancellation tests and concrete allocation measurements. It is a managed wrapper today, not a proven zero-allocation or independent-arena pointer.
2. **LLVM**: reject all `rt ref`, `rt unref`, `rt deref` and `rt deref mut` with precise diagnostics before generating IR until place provenance + ownership/drop + generation + ABI and suspension gates are complete. Then stage read-only scalar/region slice support before mutable pointer reborrows.
3. **Wasm, Forge, .NET**: refuse unsupported pointer syntax and prevent untyped wire handles from being mistaken for pointer authority. Admit only after executable per-backend conformance, fuzz/race/sanitizer testing where applicable.
4. Version shared positive/negative fixtures, run exact-tree tests in both native and Java, and prove no forbidden operation produces code. Keep relevant PRs draft until LLVM and managed implementations pass tests; a GitHub Actions job with zero executed steps is not evidence.

See [ownership syntax](OWNERSHIP_SYNTAX.md), [ownership boundary audit](OWNERSHIP_BOUNDARY_AUDIT.md), and [memory safety](MEMORY_SAFETY_AND_PERFORMANCE.md).
