# Oreslang typed Pointer<T>: ownership, borrowing and zero-copy contract (draft)

**Status: proposed compiler contract, not enabled language support.** The Java/Graal compiler main and LLVM main do not currently implement source-level `Pointer<T>` or `rt ref`/`rt unref`/`rt deref`. Java draft PR #443 has a preliminary managed `OresPointer` implementation with different `unref` semantics. This draft must be reconciled there before release. Backends MUST reject unsupported programs rather than emit unchecked pointer operations.

## Capability kinds (not interchangeable)

* `T`: unique implicit owner when non-`Copy`, stored inline/stack/arena/heap according to lifetime/escape.
* `borrow T` / `borrow mut T`: non-owning shared/exclusive loan produced by `rt borrow` / `rt borrow mut`. A borrow does not own, pin, share or extend the referent lifetime.
* `Pointer<T>`: opaque, affine **owning** handle to exactly one live `T`. It owns the storage or an existing owner-domain lease. It is NOT `Copy`, `Send`, `Share`, `Serializable`, nullable, constructible with `new Pointer`, comparable by numeric address or usable as an integer. Its provenance, region, generation, actor/hot-reload identity, alignment and target lifetime are compiler/runtime facts, not user-settable fields. No public guest-accessible `target` field or raw-pointer constructor.
* `PointerView<T>` (internal compiler concept, exposed as `borrow T` where possible): a non-owning view anchored to a named live `Pointer<T>`. Cannot outlive or detach from its owner. No independent ownership or memory allocation.
* `Shared<T>`, `Weak<T>` and `RawPointer<T>` are **different future capabilities**. Strong/weak references, borrowed pointers and unsafe FFI addresses must not be given the same type or operation. No implicit conversion. `ActorRef<T>` is a mailbox capability, not a memory pointer.

`Pointer<T>` is a compiler builtin and cannot be user-defined, subclassed, forged via casts/serialization/reflection/FFI, or nested in another transportable type to evade restrictions. Generic substitutions and structural casts preserve the sealed capability bit recursively.

## Operations and effects

| Syntax | Meaning | Requirements | Result |
| --- | --- | --- | --- |
| `rt ref owned_value` | Move a uniquely owned reference-backed value into an owning typed pointer | Source owned, fully initialized, non-borrowed, no active loans, pointer-eligible layout; evaluated once | `Pointer<T>`; source is moved |
| `rt deref pointer` | Read through the owning handle **without consuming it** | Named live pointer; checked provenance, generation, alignment, bounds and actor/region identity; no conflicting exclusive loan | Scoped `borrow T`, never owned `T` |
| `rt deref mut pointer` | Mutably access the pointee | Named live mutable pointer, exclusive loan and no outstanding read/write views | Scoped `borrow mut T`; no new owner |
| `rt unref pointer` | **Consume and unwrap** a unique owning pointer | Named live pointer, no outstanding views, no aliases, valid owner domain; pointer moved once | Owned `T`; handle invalidated (not a read-only alias of `deref`) |
| `rt borrow value` / `rt borrow mut value` | Borrow an addressable place without changing owner | Shared/exclusive loan, rooted lifetime, no unsafe escape | `borrow T` / `borrow mut T` |
| `rt take value` | Move unique ownership, including a `Pointer<T>` handle | No active loan; non-`Copy` source becomes unusable | Same type, no clone |
| `rt copy value` | Copy a proven `Copy` value or explicit verified deep-copy protocol | No shallow mutable alias, size/allocation effects accounted | Independent value; `Pointer<T>` always rejected |
| `rt share value` | Obtain an approved owning shared capability | Type, lifetime, synchronization/freeze and transport policy verified | A designated shared-capability type; **never** shared access by casting `Pointer<T>` |

A pointer is dropped exactly once at scope exit if not unwrapped, including exception/raise/panic, cancellation, partial initialization, hot-reload and actor shutdown paths. Drop of a native pointer must destroy its pointee/release the owner-domain lease deterministically; no host-GC timing may determine guest resource correctness. The existing Java draft's read-only `rt unref` is explicitly **not** this proposed contract; do not implement both meanings silently.

The `rt deref mut` spelling requires parser/type/borrow-checker support before admission. The first release can support read-only `deref` and reject `deref mut` explicitly; it MUST NOT silently treat mutable access as permitted. Nested `rt ref` of a pointer and `rt ref` of an existing loan are initially rejected.

## Trusted native raw-pointer escape hatch

Safe `Pointer<T>` deliberately does **not** grow pointer arithmetic. Native and
embedded targets instead expose a distinct compiler-owned `RawPointer<T>`
capability for code that has been admitted to an unsafe native memory effect.
This separation keeps ordinary affine ownership/borrowing sound while still
allowing device drivers, allocators, intrusive data structures, FFI shims and
memory-mapped I/O to express operations that require machine addresses.

`RawPointer<T>` is non-owning address authority, not a lifetime extension. It
MUST NOT be implicitly constructed from an integer, `Pointer<T>`, borrow,
serialized value, actor message, reflection value or foreign callback. A raw
pointer created from a managed/arena owner keeps an explicit lease/provenance
edge to that owner; a pointer created from an integer address is an explicitly
unbounded trusted operation and receives no safety claim beyond the selected
target's machine/ABI contract.

### Admission gate

Raw pointer formation, arithmetic, address conversion and dereference require
**both**:

1. a trusted execution domain (ordinary/private/shared native actor or trusted
   top-level native code; never `UNTRUSTED`, sandboxed guest, or portable Wasm
   source), and
2. an explicit `unsafe.memory` effect/capability in the callable's transitive
   effect summary.

Backends MAY additionally require a target/profile flag such as an embedded or
native-FFI build profile. Merely running in a trusted actor is not enough to
silently acquire raw memory authority.

### Raw operations

The canonical semantic operations are:

| Operation | Contract |
| --- | --- |
| `rt raw pointer` | Create a read-capable `RawPointer<T>` view from a stable, live `Pointer<T>`/arena place without consuming the owner. The owner/region cannot retire or move while the raw lease exists. |
| `rt raw mut pointer` | Create exclusive mutable raw authority; requires no competing shared/mutable loans and blocks owner move/reallocation/retirement. |
| `RawPointer<T>.from_addr(uintptr)` | Trusted embedded/FFI escape hatch for an externally supplied machine address. Null, width truncation and target address-space mismatches are rejected where representable. |
| `p + n` / `p - n` | Element-wise offset by signed element count, scaled by `sizeof(T)`, with address-overflow checks. For bounded provenance, out-of-bounds results are rejected before dereference; one-past-end may exist only for comparison/difference, never load/store. |
| `p.byte_offset(n)` | Byte-wise offset returning byte/raw storage authority; typed dereference requires an explicit aligned cast back to `RawPointer<U>`. |
| `p - q` | Element distance only when both pointers have compatible element type/address space and the same provenance object; unrelated-address subtraction is rejected/undefined at the unsafe boundary rather than fabricated into a safe integer. |
| `rt deref p` | Raw read. For bounded provenance, validate live generation, bounds and alignment before access. For integer-fabricated pointers this is explicitly unsafe and target-defined. |
| `rt deref mut p` | Raw write through exclusive authority; same liveness/bounds/alignment checks when provenance exists. |
| `p.addr()` | Expose `uintptr` only in `unsafe.memory` code. Integer address values are not pointers and do not retain provenance/lifetime. |

Typed arithmetic uses element counts, not bytes. No implicit wraparound is
permitted by the language contract even on targets whose machine arithmetic
wraps; an explicit target-specific unchecked intrinsic, if ever added, must be
separately named and remain outside safe `Pointer<T>`.

### Actor, ownership and lifetime rules

* `RawPointer<T>` is never `Send`, `Share`, `Serializable` or an actor
  mailbox payload by default. Copying a raw handle inside the same admitted
  native scope copies address authority but does not clone/own the pointee.
* Converting a safe pointer/borrow to raw does not erase the original loan. The
  compiler tracks the raw lease as a descendant of the same owner/provenance.
  `rt unref`, owner move/drop, arena retirement, reallocating mutations and
  hot reload are blocked until all descendant raw leases end.
* Raw pointers may not cross `await`, `select`, `*_blocking`, callback,
  generator, actor-turn, thread/isolate or reload boundaries without an
  explicit pin/stable-region proof plus cancellation/drop cleanup.
* Untrusted actors must fail at compile/admission time before executable code is
  emitted, even if the address originated in a trusted caller.
* FFI/MMIO accesses may require `volatile`, atomic ordering, address-space and
  alignment qualifiers. Ordinary raw load/store MUST NOT be silently treated as
  volatile or atomic.
* Java/Graal may implement this escape hatch only through a reviewed native/FFM
  bridge with stable-lifetime proof; a Java object reference or moving-GC object
  address is never a valid `RawPointer<T>` merely because host code can inspect
  it. LLVM/native backends are the first intended implementation target.

## Loan provenance and aliasing

Borrow checker tracks a **place identity**, source pointer identity, loan mode, lexical region, concrete projection, generation and drop state through HIR/MIR, including returns, calls, closures, casts, Option/Result, collections and destructuring. Do not infer a fresh owner merely because a Java object is reachable.

* Multiple read views may coexist; any mutable view is exclusive. Moving/unwrapping/dropping a pointer while any view is live is rejected. A reborrow cannot strengthen an immutable loan.
* `rt deref` result is a borrowed place; `rt take (rt deref p)`, `rt ref (rt deref p)`, `rt share (rt deref p)` and storing it in an owned field/aggregate are rejected. `rt copy (rt deref p)` is permitted ONLY for proven `Copy` pointees or a verified explicit copy protocol; deep copy may allocate.
* Returning a pointer transfers its unique ownership and revalidates domain/lifetime eligibility. Returning its borrowed view needs an explicit proven outlives relationship and is rejected until such signatures are supported.
* Calls reserve all argument loans until the whole invocation completes, evaluated left-to-right. A later argument cannot move or unwrap a pointer already borrowed in an earlier argument.
* No ordinary live pointer-derived borrow over `await`, `select` suspension, `*_blocking` suspend point, `rt cooperate`, generator yield, deferred callbacks or hot reload. A pinned stable owner plus resumable-frame outlives and cancellation proof is required before relaxing this prohibition.
* No pointer escape to another actor, thread, isolate, channel, stream, Observable, Future, closure, FFI callback or serialization payload by default. Actor-local owner-domain fences and verified Send/freeze/shared-region designs are prerequisites.
* Runtime generation counters reject stale handles/ABA and cross-region/cross-actor access. Stale or null pointers are not valid safe source states; if encountered at a dynamic trust boundary, trap deterministically as a safety failure, not as an untyped address read.

`rt unref` is *not* a reference-count decrement, a borrow-release primitive, or a spelling of dereference. Lexical loans end automatically by proven scope/last use. A future explicit `rt end_borrow` must consume the loan token and all derived aliases, with no use afterward; do not overload `unref` for that purpose.

## Zero-copy and zero-allocation are distinct claims

* A pointer move, borrow and dereference must not duplicate the pointee. A `Pointer<T>` is a handle; **zero copy of pointee bytes** is possible with pinned/preexisting stable storage, in-place channel/actor-local access, slices of preallocated SoA/ECS buffers, or arena ownership. Pointer wrapping/handle relocation may still move machine words.
* `rt ref` of a fresh JVM object currently constructs a new `OresPointer` object in PR #443 and therefore makes **no allocation-free guarantee**. `rt ref new Box()` may allocate `Box` too. An optimizer may scalar-replace local wrappers, but correctness and evidence cannot assume it. Native handles should be register/stack eligible when escape analysis allows.
* `requires no_alloc` can admit `rt borrow`, `rt deref`, `rt take`, and `rt unref` only with a verified drop/destructor/effect summary. `rt ref` is admitted under `no_alloc` only when the underlying storage already exists and handle formation is proven allocation-free, e.g. a caller-owned preallocated region; otherwise reject or require an explicit allocation effect.
* Checked bounds/provenance/epoch loads need no allocation but can add instructions. Native moving GC/compaction/FFI must not invalidate held pointers. A Java host GC may remain active; zero-guest-allocation is not zero JVM GC.
* `rt share` may introduce a refcounted allocation/synchronization, `rt copy` of move-only data may deep allocate, and `rt unref` may run a destructor whose effects are not `no_alloc`. Do not certify hot-path allocation-free behavior without executed allocation traces and a pinned exact source tree.

## Conformance and release gates

1. Parse, type-check and reject unsupported syntax deterministically; no fallback to generic class/method dispatch, raw integer pointers, untyped `Object`, or interpreter-only behavior.
2. Positive: ref/deref shared views, mutable exclusive view (when admitted), scope-end drop, unwrap/rebind, pointer move/return, nested call argument borrow, preallocated arena hot path.
3. Negative: double unref, deref-after-unref/move/drop, unref-with-live-view, aliasing mutable+shared views, pointer copy/share/forge, moving from deref, field/cast/aggregate escape, return local view, suspend/select/yield, actor send, FFI/callback escape, stale generation, cross-actor, bounds/alignment, partial initialization, unwind/cancel/hot-reload.
4. JVM: execute GraalVM interpreter, JIT and AOT tests; report allocation profiler/JFR guest bytes per operation. Native: run linked OresVM tests with ASan/UBSan/TSan where applicable, drop counters, allocator trace and strict no-tracing audit. Share identical source conformance fixtures, exact commits, results and rejected-feature inventory.
5. Keep PR #443 and backends in draft until old read-only `unref` tests are migrated, `rt unref` consumption is enforced in **both** static analysis and evaluator, and the HIR/LLVM/Wasm/.NET/Forge capability boundaries are explicit. Absent support must fail closed.

Related: [ownership syntax](OWNERSHIP_SYNTAX.md), [ownership boundary audit](OWNERSHIP_BOUNDARY_AUDIT.md), [memory-safety/performance contract](MEMORY_SAFETY_AND_PERFORMANCE.md), [Java pointer draft #443](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/443).
