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

At G0, `unsafe` is reserved in all source positions and imports containing an `unsafe` standard-library path segment are intentionally not yet admitted. When G2 publishes the `ores.std/unsafe/*` namespace (with only explicitly approved compatibility spellings), the parser must recognize `unsafe` as a **qualified import/path segment only**; it must not make the keyword a legal binding, callable, alias, or dynamic property fallback. **Import visibility is a privileged host-native capability, not a harmless namespace lookup.** Untrusted actors and **all VM-isolates, including trusted guest code**, MUST reject imports, transitive dependencies, aliases, re-exports and dynamic resolution of the unsafe package. A manifest flag, lexical unsafe scope or a parent actor's grants cannot change that. Only a host-authorized trusted native extension domain outside any VM-isolate may eventually resolve it.

The precise block-expression/statement AST grammar is still proposed. The initial keyword reservation must not be mistaken for accepting this example. `unsafe fnc` marks *caller-required* obligations; an `unsafe` block marks a local proof obligation. An ordinary safe function may encapsulate a verified unsafe implementation, but does not thereby acquire grant authority. Importing `std.unsafe` is not sufficient either.

Proposed subpackages: `ores.std/unsafe/memory`, `ores.std/unsafe/pointer`, `ores.std/unsafe/ffi`, `ores.std/unsafe/native`, `ores.std/unsafe/layout`, `ores.std/unsafe/platform` and `ores.std/unsafe/intrinsics`. No such package is declared implemented by this proposal. Function/method names use snake_case.

## Effect checks and auditing

Separate (a) *internal* unsafe operation effects recorded for every function containing or transitively invoking unsafe primitives and (b) *caller-required* unsafe obligations when invoking an `unsafe fnc`. Canonical initial effects are `unsafe.memory`, `unsafe.ffi`, `unsafe.mmio` and `unsafe.intrinsic`. These are not filesystem/network/process permissions.

The compiler must preserve effect summaries through linked metadata, macro expansion, generic specialization, wrappers, inlining, trait dispatch, closures, type erasure, reflection and tree shaking. Unknown effect summaries fail closed. A safe wrapper can discharge a caller obligation only if it validates its own preconditions; it must retain internal effects in an audit manifest. No effect annotation alone grants permission, raw pointer provenance or memory rights.

## Memory and actor authority

A future `RawPointer<T>` is not a safe `Pointer<T>`. The former is non-owning and receives a live region lease or an immutable supervisor/platform native-memory grant. Every grant binds runtime and actor identity, trust domain, region/object and grant identity, generation/epoch, address space, bounds, read/write rights and MMIO/FFI classes. Numeric addresses alone have no authority.

`unsafe` cannot waive checked bounds, integer overflow, alignment, exclusive-loan proofs, provenance fencing, grant narrowing, actor-domain checks or runtime revocation. The grant is a host/supervisor-minted, identity-checked object, never a user-provided boolean or numeric address. A public operation on a fabricated opaque token must be rejected *before* reading attacker-controlled fields or triggering attacker callbacks.

Raw pointer and grant tokens must not pass by actor send, channel, serialization, `any`, erased generic field or reflection. They are non-Sendable and non-Serializable by default. `UNTRUSTED` actors cannot receive native address authority even inside an unsafe scope. Forged native authority must fail again at the host call boundary.

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

## G0 admission audit, October 27, 2026

The Java Parser accepts public pre-tokenized input; reserve-word checks must not rely exclusively on `Lexer`. An externally constructed `IDENT("unsafe")` is rejected just like a genuine UNSAFE token, while STRING, SYMBOL_LITERAL and TEMPLATE_LITERAL remain data. The LLVM nested parser must report the absolute source offset for unsafe inside interpolations. Positive lexical/compiled-baseline fixtures guard against blanket string/comment/suffix rejection. These tests do **not** authorize lowering of any unsafe operation.

## Unsafe standard-library package isolation (P0 update, October 29, 2026)

The package is the supported **application-facing** interface to native extensions and memory: proposed `ores.std/unsafe/ffi`, `ores.std/unsafe/native`, `ores.std/unsafe/memory`, `ores.std/unsafe/platform`, with core ABI implementation private to the compiler/runtime. Legacy `std/unsafe/*` and dotted/colon spellings are reserved against source/package fallback, not silently accepted as public imports. A package named `unsafe_tools` is distinct from the reserved exact `unsafe` segment. At G0 **all** `unsafe` standard-library imports reject; the implementation is not installed.

Execution domains form a fixed, host-assigned trust boundary: (1) untrusted actors and all VM-isolates have no unsafe module catalog, (2) trusted actors do not automatically receive FFI, (3) a separate explicitly authorized trusted **native host** may receive a library-specific, versioned grant. The host/native extension domain must be distinguished from a Graal guest Context or other VM-isolate; a policy flag cannot upgrade a guest context. Never use a caller-chosen `trusted=true`, environment variable, package manifest or reflection as authority.

The resolver rejects unsafe dependencies before fetching source; typed linked import/effect metadata must reject re-exports, dependency graphs, dynamic imports, macros and code-loading aliases. Linkers and AOT image builders must not emit guest-callable native trampolines, method handles, symbols or dynamic-loader routes. Runtime dispatch and native-loader admission independently recheck immutable host-minted domain identity and exact library+symbol+ABI allowlists, grant lifetime and epoch. Unknown metadata or unsupported backends reject *before* executable/IR emission. No `ffi` or `native` allow flag overrides an isolate ban.

The native ABI should initially be a stable, explicitly versioned C-compatible ABI (C++/Rust use a C wrapper), with generated typed bindings, scoped lifetimes, cancellation, reentrancy and error-return contracts. Raw foreign pointer, function-pointer, symbol handle, privileged closure, and native-memory lease transport through actor messages, generic erasure, channels or serialization is denied. Foreign exceptions must not cross incompatible ABIs. In-process arbitrary foreign code shares process authority and is **not sandboxed** by an Oreslang unsafe import policy: untrusted tenants require a separate process/protection domain for extensions.

Safe Oreslang packages may internally depend on reviewed native code only through a **host-owned safe service facade** with explicit permissions, bounded quotas, verified serialization/ownership and no native pointer exposure. The guest receives typed values or narrowly scoped opaque resource IDs, not the native library or unsafe package. This allows safe std crypto, image, filesystem and network services even when their implementation is native.

### Independent release proof

- Exact-head negative imports for untrusted actor and trusted/untrusted VM guest, direct/transitive/re-exported/dynamic, legacy aliases, package shadowing, crafted AST, reflection and native symbol calls.
- Exact-head positive native-host-only extension proof with a real allowlisted ABI symbol, lifetime/error/callback/unwind and actor revocation; no positive claim until source compiles and runs.
- Java/GraalVM Native Image, LLVM AOT, Forge/.NET/WASM negative-first parity, executable source fixtures, private CI runner admission, and sanitizers where native memory is involved.
- An executed Python contract test is only a reference-model check, never a substitute for Oreslang guest compiler, linker or runtime tests.
