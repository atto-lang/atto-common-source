# Unsafe language boundary v1

Status: proposal only. No compiler, runtime, or native executable support is claimed.

Oreslang should provide explicit `unsafe` scopes and `unsafe fnc` declarations for operations whose safety invariants the compiler cannot prove. Unsafe syntax is not OS permission, memory authority, ownership transfer, or permission to bypass actor state sealing.

This design extends `docs/POINTER_CAPABILITY_CONTRACT.md` and its proposed `unsafe.memory` effect. `Pointer<T>` remains a separate owning pointer, and raw pointers remain non-owning, provenance-checked capabilities. The conflicting public-pointer wording in `docs/OWNERSHIP_SYNTAX.md` must be reconciled before enabling pointers.

The initial implementation should reserve unsupported syntax and reject it before code generation. Parser, effects, native grants, execution, and backend parity are later gates.

## Proposed source surface (not yet executable)

```oreslang
// The caller must satisfy a documented contract.
unsafe fnc read_register(address: RawPointer<u32>): u32
    // SAFETY: live aligned read-only grant, matching actor and region epoch.
    return unsafe {
        std.unsafe.memory.read_volatile<u32>(address)
    };
end
```

The precise block-expression/statement AST grammar is still proposed. The initial keyword reservation must not be mistaken for accepting this example. `unsafe fnc` marks *caller-required* obligations; an `unsafe` block marks a local proof obligation. An ordinary safe function may encapsulate a verified unsafe implementation, but does not thereby acquire grant authority. Importing `std.unsafe` is not sufficient either.

Proposed subpackages: `std.unsafe.memory`, `std.unsafe.pointer`, `std.unsafe.ffi`, `std.unsafe.layout` and `std.unsafe.intrinsics`. No such package is declared implemented by this proposal. Function/method names use snake_case.

## Effect checks and auditing

Separate (a) *internal* unsafe operation effects recorded for every function containing or transitively invoking unsafe primitives and (b) *caller-required* unsafe obligations when invoking an `unsafe fnc`. Canonical initial effects are `unsafe.memory`, `unsafe.ffi`, `unsafe.mmio` and `unsafe.intrinsic`. These are not filesystem/network/process permissions.

The compiler must preserve effect summaries through linked metadata, macro expansion, generic specialization, wrappers, inlining, trait dispatch, closures, type erasure, reflection and tree shaking. Unknown effect summaries fail closed. A safe wrapper can discharge a caller obligation only if it validates its own preconditions; it must retain internal effects in an audit manifest. No effect annotation alone grants permission, raw pointer provenance or memory rights.

## Memory and actor authority

A future `RawPointer<T>` is not a safe `Pointer<T>`. The former is non-owning and receives a live region lease or an immutable supervisor/platform native-memory grant. Every grant binds runtime and actor identity, trust domain, region/object and grant identity, generation/epoch, address space, bounds, read/write rights and MMIO/FFI classes. Numeric addresses alone have no authority.

`unsafe` cannot waive checked bounds, integer overflow, alignment, exclusive-loan proofs, provenance fencing, grant narrowing, actor-domain checks or runtime revocation. Raw pointer and grant tokens must not pass by actor send, channel, serialization, `any`, erased generic field or reflection. They are non-Sendable and non-Serializable by default. `UNTRUSTED` actors cannot receive native address authority even inside an unsafe scope. Forged native authority must fail again at the host call boundary.

Unsafe operations do not permit direct access to sealed actor state, supervisor CONTROL queues, mailbox internals or generation state. Arbitrary hostile native code in the same address space cannot be contained merely by language checks; untrusted plugins require a real process/VM sandbox.

## Cancellation, AOT, optimization and realtime

Raw pointer leases do not automatically pin memory. Crossing await, select, FFI callback, DMA, actor turn or hot reload requires a separate stable-region lease with unwind/cancellation/quiescence proof; otherwise reject. Retired logical actors do not imply physically reclaimed arenas. LLVM optimizer metadata (`inbounds`, `nonnull`, `noalias`, `dereferenceable`, TBAA) requires independent, scope-valid proof; typed casts do not manufacture it. Volatile is not atomic.

Unsafe does not imply `no_alloc`, `no_block`, `hard_rt`, `pure`, bounded WCET, deterministic cleanup or IRQ safety. Hard-realtime and freestanding targets must independently prove scheduling, bounded memory, and cleanup constraints. Java/Graal native-image and LLVM native AOT use the same source-level rules, but backend-specific FFI/GC details and verification remain separate.

## Release gates

- **G0:** reserve keyword; reject unlowered unsafe constructs with an explicit diagnostic; create shared negative-first vectors.
- **G1:** checked AST for unsafe block/function, formatting, lexical safety contracts, HIR/MIR effect propagation and deterministic unsafe-call manifest.
- **G2:** unforgeable runtime/native grants, ownership and pinning checks, guarded FFI/MMIO source execution, and source-level Java/GraalVM Native Image plus LLVM AOT tests.
- **G3:** adversarial cancellation, reuse/ABA, callbacks, hot swapping, sanitizers, embedded/QEMU and five-backend parity. Unsupported targets must fail before emitting IR/executables.

The manifest should report source span, effect, call-edge, backend/profile, and verification status without leaking addresses or secrets. Every release receipt must identify exact source and fixture hashes. A zero-step CI job, static oracle or host-only test is not a compiled guest pass.

Related: [LLVM issue #528](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/528). It names `NativePointer<T>`; this contract names `RawPointer<T>`. Settle the spelling before enabling the type.
