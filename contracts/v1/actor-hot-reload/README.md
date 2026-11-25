# Actor hot reload v1 — cross-backend reference contract

**Status: model-only, not production implementation.** This contract is intended for Java/Graal, LLVM AOT/ORC, Wasm and other backends. It adds portable security and lifecycle expectations without copying private compiler source into a carrier repository. Its Python tests exercise an independent reference state machine; no guest compiler, code image, executable linker, ABI, sandbox, or real actor has been tested by this contract.

## Physical placement is not memory ownership

- Every SHARED actor owns its mutable actor heap/arena; shared access is only via explicitly authorized and synchronized shared domains. A shared arena is **not** an OS address-space boundary.
- PRIVATE/isolated trusted actors own separate mutable heaps even if they run in one trusted process. Immutable code images can be shared; mutable heap pointers cannot.
- UNTRUSTED actors have bounded, separate logical ownership and supervisor admission; the current pooled Graal JIT/GC execution domain is **not** a separate address space per actor. A dedicated OS process is an optional stronger tier, mandatory when an explicitly requested threat model cannot be enforced by the pool.
- Do not claim that a source-level actor kind alone enforces OS isolation. A target that lacks the requested sandbox/permissions refuses admission.

## AOT / JIT choices

AOT-to-AOT replacement is valid: an approved supervisor stages a relocatable, versioned native image/shared library and keeps it mapped while pins exist. LLVM ORC JIT is an alternative for staging a new generation (AOT→JIT→AOT supported). Compilation mode is not an authority or state-migration proof. Graal Native Image cannot arbitrarily load new closed-world Java classes; dynamic guest code requires an explicitly allowed Truffle/JIT domain or replaceable process.

## Mandatory upgrade transaction

1. **Admit** a signed/digest-verified artifact under compiler/loader-held supervisor authority, using the exact code-unit identity, source root tree, transitive imports, ABI, permissions, actor kind, isolation placement, schema layout and checkpoint format. A guest-provided digest, string, annotation, FFI pointer, boolean `admitted` or arbitrary dynamic library path is never authority.
2. **Stage** candidate code in a separate versioned image. No candidate initializer, user DATA turn, migration or FFI callback may execute under a CONTROL lock or be visible through the old route.
3. **Freeze** new DATA admission via a monotonically increasing, non-recycling route epoch. CONTROL and cancellation keep progressing; receive/await resumptions, external callback publications, I/O, timers, FFI frame/borrow leases, shared-domain lifetime pins and all configured concurrent actor turns count toward quiescence. A bare empty mailbox is insufficient.
4. **Snapshot** only from the actor's single `state { ... }` schema using its verified exclusive/critical state loan; do not copy raw heap pointers, locks, executable pointers, open file descriptors or borrowed shared values.
5. **Publish code-only** using exact state/mailbox/capability/shared-cell ABI equality, unchanged actor/incarnation/mailbox/heap identity and a CAS on the expected epoch. A wrong epoch, ABI or missing lease refuses without damaging the old actor. Logical route epoch changes, actor incarnation does not.
6. **Migrate state** only through a separately authorized typed conversion to an independently owned staging arena and validated snapshot. If a shared-cell schema changes, require explicit versioned COW/RCU agreement and a grace period. Migration failure rolls back before external effects; post-commit failures must never resurrect stale ingress.
7. **Retain and retire** each old image until native calls, suspended frames, callbacks, shared-memory/FFI borrows and remote acknowledgments have released generation pins. Destroy code-holding objects before ORC ResourceTracker/DSO unload. Failed unload quarantines the generation and emits durable observable diagnostics; never pretend reclamation succeeded.
8. **Health/canary** verify data-plane execution and rollback/compensation policy separately. Crash/restart increments actor *incarnation*, whereas transparent code replacement increments *route epoch*.

## Authority and actor-kind guards

- The supervisor/CONTROL runtime, not an untrusted actor, owns stage/freeze/publish/retire capability.
- Guest-supplied callback or FFI entrypoint pointers are not an approved image.
- Shared actors cannot hot-replace incompatible shared cells without a versioned grace protocol and all readers/writers accounted for.
- PRIVATE actors may be rebuilt in a fresh process or context, but mutable state still requires an authenticated checkpoint and explicit restoration.
- UNTRUSTED code cannot elevate capabilities, move into trusted placement or escape quotas through migration.
- Multiple execution threads per actor (explicit max > 1) add independent execution pins; all must quiesce, including outstanding tasks and nonblocking continuations.
- Stop/cancel must not be lost during a freeze; held CONTROL authority and code leases do not imply permission to resurrect a stopped actor.

## Executable evidence required for release

The adjacent `verify.py` is a **source-independent reference monitor**. Success only validates these modeled invariants. Release requires a new, non-skipped actual source-compiled actor test per backend for AOT→AOT, AOT→ORC→AOT, JIT→JIT, actor identity, same- and changed-schema migrations, rollback, malicious loader rejection, shared FFI/critical leases, 3 concurrent actor turns, awaited callbacks, stale/foreign refs, malformed images, code retention, failed unload quarantine and untrusted sandbox placement. Pin source commit/tree, compiler artifact/dependency digest, signed manifest, platform/toolchain, logs and sanitizer results. Do not reclassify a source-free or public synthetic run as compiler/runtime proof.

Linked source work: [Java #1270](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1270), [LLVM #602](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/602), [LLVM #627](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/627), [LLVM #606](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/606), [LLVM #607](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/607), [LLVM #610](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/610) and [common source #73](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/73).

## Task/suspends generation pins and placement invariance (v1 extension)

The `suspends` effect executes within the **same Task**; an `await`
suspends its carrier but must retain the old code image and actor-generation
lease. Only physical Task quiescence after lexical cleanup releases the
lease. Nested `task {}` launches acquire *independent* child Task generation
pins, including for `do task` (discarded handle). Pending shared Future
producers do not become child-owned merely because an awaiting Task cancels.

Hot reload cannot change the actor's kind, physical protection placement or
shared-cell schema by silently switching from AOT to JIT. The reference
monitor now binds immutable placement directly into every staged image,
rejects malformed/unknown placement names, and checks the same placement
again at generation publication. This is a **model label**, not a proof
that a sandbox process or isolation boundary was actually instantiated.

Two additional model regressions cover suspended Task pin retention and
cross-protection placement rejection. The underlying Python reference
monitor, Java actor gate, Java Task/cleanup runtime and LLVM PIC/ORC paths
still require independent, exact-head executable verification.
