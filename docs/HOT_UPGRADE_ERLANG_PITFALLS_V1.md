# Oreslang hot upgrade safety contract: lessons from Erlang/OTP v1

**Status:** normative target and acceptance checklist, not an implementation-complete claim. Java/Graal and LLVM remain separate compilers. See [actor state schema migration #149](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/149), [generation reload #73](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/73), Java [rolling HTTP generation goal #1971](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1971), [Java actor route PR #1967](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1967), and [Java HTTP drain draft #2026](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2026).

## Erlang/OTP precedent versus Oreslang requirements

Erlang's module code server normally retains only *current* and *old* code. Loading a newer module when an older generation is still referenced risks purging old code; `code:purge/1` can kill processes that reference old code, whereas `code:soft_purge/1` refuses removal while references persist. An Erlang process can remain on old code until a suitably qualified call transitions it. Fun references can retain old code. OTP also offers `gen_server:code_change/3` for state changes, but upgrades require compatible release sequencing across processes/modules/nodes.

These are **specific Erlang design and operational constraints**, not a claim that Erlang/OTP is incapable of safe zero-downtime upgrades. Oreslang should preserve OTP's supervision, isolation and deliberate upgrade behavior while avoiding implicit purge and manual source-level code-switch calls.

Primary references:
- https://www.erlang.org/doc/apps/kernel/code.html
- https://www.erlang.org/doc/system/code_loading.html
- https://www.erlang.org/doc/apps/stdlib/gen_server.html
- https://www.erlang.org/doc/system/release_handling.html

## Non-negotiable Oreslang invariants

### 1. No implicit forced purge; bounded multi-generation retention
- Never kill a still-running actor, silently cancel a request, free an arena or unload a code image to make room for a third (or Nth) deployment.
- Every live code image has a stable **content digest**, trusted ownership domain, generation ID, resource budget and explicit lease accounting. Retire only after real physical quiescence of *all* reachable old-image frames/closures/callbacks, including children, timers, Task continuations, HTTP transport, FFI and shared-region leases.
- Retain as many coexistence generations as policy admits (not hard-coded two). Once the bounded image/memory/lease budget is exhausted, **reject/defer another promotion** with structured blockers, not a forced purge. A forced process-level restart is an explicit operator action and must not be mislabeled a zero-loss in-process upgrade.
- A cancellation timeout requests graceful/forced *operation* shutdown according to resource capabilities, but never certifies in-process native-code quiescence on its own.
- Cleanup/unload failures quarantine a code image, expose durable error/remaining references and consume retention budget until safely cleared.

### 2. No Erlang-style implicit jumping between code generations
- An actor turn executes under the generation pinned at admission. No local function call, dynamic import, `await`, callback or `fnc` dispatch may silently jump to a newer implementation halfway through that turn.
- Compiler-emitted generation/closure metadata pins ordinary closures, asynchronous frames, lambda captures, callback tables, static method references, interface dispatch tables, native trampolines and any guest-visible function object that can execute old instructions. Structural-type erasure or imports must not erase provenance.
- **New spawns** may use a new generation immediately after atomic promotion. **Existing actors** keep their generation until the trusted supervisor moves them at an explicit quiescent handoff boundary. The application does not need to call itself using a specially qualified form just to switch code.
- A suspended Task may resume in the *original pinned* generation, not an unrelated new one; in-place upgrade either waits for it to physically quiesce or uses a separately proven continuation-migration protocol. No implicit migration of instruction pointers.

### 3. State schema and mailbox are independent, versioned contracts
- The source `state { ... }` block is the compiler-checked actor state migration anchor. It is **not** itself a serialization format or a guarantee of compatibility. Schema fingerprint covers types, field names/IDs, ownership, mutability, layout, capability-bearing values, defaults and version.
- Changing only implementation code with identical state/message/capability ABIs permits a code-only swap after source-level safe-point proof.
- Any schema change needs a typed, deterministic, effect-restricted migration from an immutable old-state view into fresh staging state with independent arena ownership; validate old and new invariants before one authoritative code+route+mailbox-epoch+state publication.
- Migration hooks must not perform network I/O, spawn actors, mutate old state, cross raw native pointers or exercise undeclared capabilities before commit. Reject unsafe closure/socket/borrow/ActorRef deserialization and unsupported backend kinds. No arbitrary user `code_change` hook running under a supervisor lock.
- A new field with no valid default/migration, field retype/remove, or changed actor protection domain **fails closed**, not a best-effort cast. Downgrade requires its own reversible migration; rollback after an externally visible commit is a **new forward transaction**, not an unsafe rewind.

### 4. Dependency graph and version skew
- Stage the entire linked and signed/digested import dependency set. Hash caller-facing ABI, checked effects, symbols, interface dispatch, serializer layout and capabilities; define exact compatible-version ranges explicitly.
- Within one pinned invocation, imports that are supposed to belong to an image graph resolve to **that graph**, not the newest global symbol table. A mixed-generation call across actor boundaries uses an explicitly versioned/wire-compatible message contract.
- Reject cycles or inconsistent version sets whose migration/publication ordering cannot be proved. Do not claim a single atomic deployment across multiple OresVM nodes: use staged rolling compatibility and explicit deployment epochs.

### 5. Message and side-effect semantics
- Keep stable logical ActorRef, mailbox identity and accepted message sequence for code-only in-place upgrades. Preserve mailbox order at the freeze boundary. The CONTROL lane remains responsive while DATA dispatch is fenced.
- Capture caller and callee version, actor incarnation, message sequence and response correlation in authenticated completion receipts. Duplicate/stale or foreign completions cannot advance another incarnation's watermark.
- Explicitly distinguish *admitted*, *executing*, *done*, *failed*, and *indeterminate* outcomes. No automatic replay of potentially executed payment/POST messages. Exactly-once **business effects** require application deduplication/transactional idempotency; the runtime alone cannot infer them.
- HTTP keep-alive, HTTP/2/3 streams, SSE and WebSockets use **request/stream-scoped** generation pinning and bounded drain. Never close a stable listener just to rotate a handler generation. A streaming response retains old code even after its handler returns.

### 6. Supervisor authority, observability and rollout
- Only a trusted supervisor owns image admission, code signature validation, staging, quiescence proof, CAS route publication and cleanup. Never expose a guest-accessible raw purge, stale code pointer or untrusted upgrade control token.
- Export per-image blockers: actor turns, suspension frames, FFI callbacks, HTTP exchanges/response bodies, external operations, shared regions, pending cleanup, memory bytes, oldest pin age, and active/retiring/quarantined status. Never turn a missing measurement into zero.
- Canary promotion checks behavior and compatibility *before* new traffic; after promotion health failure, explicitly roll out an already verified previous image to **new** traffic and drain the bad generation, rather than overwriting frames that have begun executing.
- Publish structured audit receipts with exact code/source tree digest, expected and resulting route epochs, ABI/state migration hashes, exact actor domain, and held/retired leases.
- Code image retirement requires logical quiescence *and* physical cleanup confirmation; surviving NIF/FFI or ORC loader objects prevent it even when zero guest actors remain.

## V1 source-independent conformance matrix (DO NOT report green without real execution)

1. **Three versions**: a V1 closure/HTTP stream holds a pin; deploy V2 and V3 where budgets permit, then retire V2; V1 must survive and its callback must run under V1 or be explicitly cancelled and physically drained.
2. **Budget pressure**: V1 never drains; N subsequent candidates exceed cap -> deterministic admission rejection with blockers, no actor termination, memory explosion or hidden purge.
3. **Safe-point dispatch**: V1 actor enters await while V2 staged; resuming cannot invoke V2 unpinned. After V1 continuation returns and mailbox watermark drains, upgrade at the supervisor checkpoint.
4. **Closure/import provenance**: function capture, callback, interface vtable and imported function all use pinned ABI/image; stale cross-generation dispatch fails closed.
5. **State migration**: V1 `state{count:int}` -> V2 identical schema code-only -> V3 added field requires explicit typed migration and checked rollback. Reject loss of borrowed/native capabilities.
6. **Mailbox/side effects**: concurrently enqueue requests during DATA freeze; exactly one version owns each message, per-actor order preserved; indeterminate operations never auto-replayed.
7. **HTTP**: stable OresVM PID/listener; slow V1 stream, new V2 request and later V3 request overlap; old response completes under V1; WebSocket long-tail either continues or explicitly closes under bounded policy.
8. **Native cleanup**: callback and FFI return races, cancellation, loader unload failure, and quarantine exhaustion cannot cause use-after-unmap, deadlock or false success.
9. **Rollback**: invalid signature, incompatible effect ABI, old/new state validation error, health failure, and concurrent promotion preserve one serving route.
10. **Conformance evidence**: exact same 3-4 imported .ores source files compiled+executed by independent Java/Graal and LLVM compilers with source/hash/pin comparison, JDK25 JUnit, real native loader, GCC/Clang sanitizer runs, and real executed CI steps.

## Implementation boundary

Do **not** add an independent router, second actor-code publisher, or another per-actor global scheduler. Extend existing Java `ActorRoutePublicationV1` / `ActorUpgradeEpochGate`, `HttpGenerationDrainV1`, and LLVM `NativeActorHotUpgradeGate` / supervisor code slot so all physical leases participate in one verified retirement decision. The current HTTP ledger supplies **HTTP-side blocker diagnostics only**; it cannot authorize unloading an LLVM/Graal image.
