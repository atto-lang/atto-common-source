# Tenant domains and secure execution v1 (proposal)

**Status:** design proposal; no compiler or backend parity admitted by this document.
**Scope:** AttoLang actor isolation, Wasm host domains, native process fallback, and kernel-resource capabilities.

## Domain semantics

An actor belongs to exactly one `TenantDomain` at a time. A tenant domain is distinct from its actors, worker threads, OS processes, and language-level heaps. Domain creation is a privileged supervisor operation, never an untrusted guest builtin. A guest-supplied tenant ID or integer capability handle is not an authenticated security principal.

Each domain consists of an opaque identity, monotonic generation/epoch, execution tier, capability table, and resource policy. Actors inherit the domain's authority and budget ceilings but cannot mint additional authority through inheritance or type casts.

Capabilities bind a resource kind, owning domain and generation, allowed rights, and optional limits. Handles must not expose raw Linux file descriptors or host pointers to untrusted guests. Revocation denies new operations immediately; stale completions are discarded by domain generation. Already-submitted network packets cannot always be retracted and must be reported as ambiguous rather than guaranteed cancelled.

## Execution tiers

| Tier | Admission | Required enforcement |
| --- | --- | --- |
| Sandboxed Wasm | Untrusted guest modules | Validating engine, independent guest memories/Stores, restricted host imports, bounded instruction fuel/epoch interruption, memory/table limits |
| Trusted native | Trusted compiler output only | Ownership/borrows and runtime capability discipline; NOT an adversarial memory boundary |
| Process-isolated native | Arbitrary or insufficiently verified native code | OS process mappings and appropriately configured namespace/seccomp/LSM and broker policies |
| Verified compartment native (future) | Security-reviewed SFI/MPK/CHERI implementation | Protected memory, authenticated transitions, non-bypassable I/O, tested revocation, explicit threat model |

An implementation must fail closed rather than silently downgrade an untrusted tenant into a trusted-native in-process tier. Wasmtime itself does not isolate a compromised host engine from other Stores within its process.

## Scheduler and resource accounting

AttoLang's actor scheduler controls actor turns and continuations; the OS schedules kernel threads. Wasm engine fuel is a deterministic per-turn execution limit, not an OS CPU quota. Epoch interruption bounds guest execution approximately, not arbitrary native hostcalls or guaranteed hard real-time deadlines. Kernel-enforced CPU/memory/network accounting is a separate future feature.

## Network capability protocol

The guest may submit a bounded socket intent through an approved host import. Submission returns `PENDING` until a trusted broker authorizes and completes its side of the operation. No hostcall may misrepresent queued I/O as delivered. Brokers check domain identity/epoch, rights, destination allowlists and quotas before every dispatch. Trusted supervisors must discard stale queued intents after revocation. This proposal is subordinate to the existing `docs/NATIVE_IO_NAMING.md` nonblocking and suspension contract; offloading blocking I/O to worker threads is not acceptable.

## Hot upgrades and cancellation

Actor-generation changes and domain revocation are different operations. Code hot-upgrade should stage new code and state, transfer only explicitly authorized handles, atomically switch actor routing, then drain/revoke the old generation. All lingering I/O completions and handles require generation checks. Process crashes, speculative side channels, and kernel compromise remain distinct failure classes.

## LLVM and Java/Graal parity requirements

LLVM and Java/Graal must eventually run **byte-identical AttoLang source fixtures** demonstrating actor-domain membership, capability denial, quota errors, revocation, completion, and cancellation. Backends may use different enforcement layers, but source-visible status and ownership semantics must converge. Until admitted by real compilers and native/JVM execution tests, neither backend should claim this language surface is implemented. Arbitrary untrusted LLVM-native code must use process isolation by default; a C-only ABI test is not source-level parity.

## Admission and acceptance gates

1. One Linux process hosts at least 100 Wasm tenant Stores with independent memories, measured under a reproducible harness.
2. A genuine uninstrumented Wasm infinite loop runs out of engine fuel and only its tenant is revoked; a neighboring Store retains state.
3. OOB memory traps, memory growth restrictions, and forbidden WASI imports fail closed.
4. Forged cross-domain socket handles never result in broker submission.
5. Revocation and stale asynchronous completion cannot resurrect authority or dispatch queued operations.
6. Adversarial hostcall tests, artifact signing/pinning, compile-rate limits, crash injection, peer review, and process containment are required before production promotion.
7. Native LLVM guest-source compilation, real Java/Graal conformance, and verified kernel/compartment tests remain separate open gates.

## Prototype evidence

The independent `atto-multitenancy-poc` v0.4 Rust Wasmtime host is a research slice with authored but, at the time of this proposal, **NOT_EXECUTED** Cargo tests in its delivery container (Rust toolchain unavailable). It currently queues I/O intents but does not integrate its Rust path with the existing Node UDP broker. Previous v0.3 Node regression tests passing do not establish Wasmtime security or native source parity.

**Decision:** proposal only. Nothing in this document creates new AttoLang syntax or admits unsupported compiler features.