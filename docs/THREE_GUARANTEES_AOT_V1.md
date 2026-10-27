# Three cross-cutting guarantees: full AOT, safe hot swap, real-time qualification, actor protocol proofs (v1)

**Status: proposed shared normative target; NOT implemented, not certified.** Extends (and does not replace) [AOT_LANGUAGE_CLOSURE_V1.md](AOT_LANGUAGE_CLOSURE_V1.md), [COMPILATION-POLICY.md](COMPILATION-POLICY.md), [HOT_UPGRADE_ERLANG_PITFALLS_V1.md](HOT_UPGRADE_ERLANG_PITFALLS_V1.md), [REALTIME_EXECUTION.md](REALTIME_EXECUTION.md), [REALTIME_AOT_EXECUTION_PROFILES.md](REALTIME_AOT_EXECUTION_PROFILES.md), [REFINEMENT_TYPES.md](REFINEMENT_TYPES.md), [OTP_BEHAVIOURS_V1.md](OTP_BEHAVIOURS_V1.md), and [FOUNDATIONAL_AUTHORITY_BOUNDARIES_V1.md](FOUNDATIONAL_AUTHORITY_BOUNDARIES_V1.md).

This is a **shared language/evidence contract, not a common compiler implementation**. Java/Graal and LLVM retain independent source frontends and borrow checkers. All source forms below are conceptual unless independently admitted by a backend. The accompanying JSON and tests are *source-free contract assertions*, never compiled Oreslang evidence.

## G0: universal normal-profile program-specific native AOT

Both required primary production paths compile **all reachable Oreslang guest functionality** before deployment.

- **LLVM:** typed/verified Oreslang -> LLVM objects -> native executable, with compiled actor handlers, callbacks, closure bodies, exceptional exits, scheduler continuations, and runtime glue. A JIT/evaluator/interpreter is not a substitute.
- **Java/GraalVM:** typed/verified Oreslang -> generated program-specific compiled JVM implementation (or equivalent AOT-visible guest lowering) -> **GraalVM Native Image native executable**. Merely embedding the Truffle interpreter in Native Image, including with `--no-fallback`, is explicitly *not* full guest AOT.
- Before linking, resolve macros/comptime, finite generic specializations, static protocol witnesses, actor/session transition tables, layouts/codecs, permission and effect closure, ownership, and all reachable suspension/failure/cleanup edges. All forbidden or unknown requirements fail **before executable artifact emission**, not as a runtime interpreter/JIT fallback.
- Runtime *data* may select from precompiled closed paths; dynamic code creation, reflection-dependent dispatch, runtime type invention, unbounded new generic implementations, dynamic shader compilation needed for semantics and source compilation inside a strict-AOT OresVM are forbidden.
- Imported/native/FFI functions are independently declared, permission checked, versioned, and included in the linked execution closure. Build success, Native Image of an evaluator, host-only tests and parser acceptance are **not guest-AOT proof**.

## G1: hot swapping in development and production

### Exact guarantees and limits

Both development and production use the **same fail-closed safety and authority checks**. Dev may compile an immutable candidate outside the running OresVM and offer fast diagnostics or a configurable downtime fallback; it cannot claim a zero-restart in-process guest-code swap when the deployed AOT platform cannot load compatible *precompiled* code.

- **In-process zero-process-restart** may be claimed only for a backend and artifact pair with **tested, explicit code-loading/linking support**. LLVM may use a separately linked precompiled native image/module under a verified loader policy; it must never require runtime LLVM IR compilation or JIT. Graal Native Image **must not be assumed** to define arbitrary new Java classes or compiled guest methods after image construction. A Graal implementation may use prelinked generation slots/closed dispatch or a separately verified native module ABI, if proven. Otherwise mark in-process hot swapping unsupported and use a controlled process handoff; a process handoff may provide zero *service* downtime but is **not** zero process restart.
- **Listener stability:** keep a stable admission/router listener where supported; atomically route newly admitted work by generation. A bounded proxy/broker can retain a listener across process handoff; any gap or dropped in-flight request defeats a claimed zero-downtime result.
- **Prepare -> validate -> stage -> fence -> publish -> drain -> retire.** Preflight checks image/source digest, signatures, dependencies, actor/session protocol graph, state and message schema, effects/capabilities, resource budgets and loader compatibility. Stage in independent owned storage with no mutation of the active version. A single authoritative compare-and-swap publishes a route epoch after ready checks; failure before publication leaves old routing intact.
- **Pin all in-flight work** (actor turns, pending Future/Task continuations, generator frames, callbacks, FFI/DMA/IO transfers, HTTP streams, session handles, shared-region leases and child tasks) to the admitted generation. No implicit cross-generation execution after `await`, critical exit or callback.
- **Schema migration** is a typed, deterministic and resource-bounded prepare operation from an immutable old-state snapshot to independent new state. Reject unsupported versions, nontransferable loans/capabilities or incompatible session transitions. Only a verified quiescent handoff or an explicitly version-compatible dual-generation protocol permits migration.
- **No forced purge.** Retire native code/arena only after physical quiescence plus successful cleanup; if references remain or generation-retention limits are met, reject/defer promotion and expose blockers. A cancellation request or timer expiry is not physical exit.
- **Failure outcomes:** distinguish admission, execution, completion, failure and indeterminate external effects. Post-commit rollback is a *new forward promotion*, not rewinding side effects. Business-level exactly-once delivery requires explicit idempotency/deduplication.
- **Production** additionally requires controlled signed-image policy, rate-limited/canary rollout, audit receipts, bounded memory and generation retention, and operator-accessible abort/resume paths. All guarantees are scoped to an individual OresVM or explicitly identified router; never claim atomicity across arbitrary distributed nodes.

### AOT and real-time interaction

A strict real-time actor must not perform an unbounded loader, migration, code-signature check, class initialization, deallocation, or quiescence wait on its time-critical carrier. Stage and validate off the critical path; activate only at a **proved bounded safe point** included in response-time analysis. If activation latency or interference is unknown, deny live promotion for that certified domain. Hot swapping does not preserve an existing real-time certificate automatically: new code, code-generation digest or hardware/runtime assumptions require renewed qualification.

## G2: soft versus hard real-time guarantees

**AOT is necessary for strict profiles but insufficient for real-time.** Define three different promise levels:

1. **Portable AOT correctness:** executable semantic and safety equivalence; no timing bound implied.
2. **Soft real-time (including Java/Graal Native Image):** a declared measured service objective, bounded queues and resource policy, latency distribution and overload behavior. A reported p99 or p99.9 latency does not promise no deadline misses.
3. **Hard real-time (LLVM first; separately qualified real-time Java vendor target only):** an independently validated **per-artifact/per-workload/per-hardware-and-OS** response-time bound including WCET, scheduling interference, release/wakeup jitter, lock blocking, FFI, memory activity, cancellation/cleanup, IRQ and loader interactions. A deadline is guaranteed *only under explicit certified arrival, resource, hardware, software and environmental assumptions*. No general-purpose Graal Native Image, ordinary JVM, annotation or scheduler watchdog implies hard RT.

Unknown/unbounded transitive work, recursion, allocation, OS blocking, I/O wait, FFI, timers, lock hold, callback, actor restart, cleanup, message sizes, channel admission, or hidden GC interference **rejects** hard-RT admission. A watchdog observes a miss; it cannot prove an absent miss. An actor's CONTROL priority does not make its worst-case handling time zero.

For native hard RT, reachable certified paths require no tracing GC and qualified bounded allocations/drops from admitted regions/pools. For Java/Graal, Native Image and low-GC work are distinct from a proven RTSJ/vendor real-time target; do not silently relabel managed-code latency measurements as hard-RT evidence.

On overload use deterministic typed backpressure/drop/rejection (per contract), never unbounded buffer growth or undisclosed blocking. The exact fallback outcome is part of the function/actor API and timing analysis.

## G3: express legal actor behavior as proofs before code emission

### Session/phase typestate is *per conversation*, not global actor state

A freely cloned `ActorRef<Message>` cannot statically prove the global state of a shared actor: another caller may move that actor to another phase. Instead introduce a **compiler-recognized, opaque, affine, per-session transition capability**. Illustrative semantic type only: `Session<Actor, Protocol, Phase>`. Use existing actor and state mechanisms; no new actor declaration keyword and no extra guest actor instance fields.

- A protocol is a **finite, statically closed transition graph** whose edges specify allowed source phase, message/reply types, next phase, error/fault branches, effects, maximum resource use where required, permissions and ownership changes. Compile-time proofs derive from verified typed HIR/call graph, never client-provided JSON claims.
- An opaque runtime session identity binds actor ID + incarnation + code generation + protocol/schema ABI + unique session ID/epoch. The actor/session runtime mints identities. Plain integer IDs, cross-actor copies, serialization, reflection, `any`, foreign pointer casts and user constructors never create authority.
- The transition capability has one live mutable owner. Moving it consumes the prior handle; duplicate sends/transitions and use-after-move must be static errors where provable and runtime rejects at all trust boundaries.
- A transition is linearizable and bounded at admission. **Before admission**, a failed send returns the original usable phase capability (or an equivalent typed retained-ownership outcome). **After admission**, timeout/cancellation does not mean the operation never executed: return a typed *pending/indeterminate* disposition with a recovery/settlement capability, never a fabricated success or a fresh old-phase handle.
- A successful authoritative reply returns the next-phase capability once. An actor panic/restart, stale code generation or protocol mismatch invalidates or safely settles existing handles; no automatic cross-incarnation privilege renewal. Supervisor-only CONTROL remains uncatchable by guest actor code.
- Session handles cannot expose actor-private `state {}`; actor-owned persistent session data must reside in that single sealed state schema, while runtime-owned admission metadata is opaque. A state critical loan cannot escape through a handle or across an unproven suspension.
- Static *effects* constrain operations (`throws`/`raises`/`panics`, `pure`, allocation, I/O, suspension), but **effect annotations never grant OS permissions**. Effective permission is the intersection of process policy, actor/isolate grants, delegation, operation authority and target resource. Unknown direct/indirect call/FFI effects reject strict AOT/RT admission. Typed error return paths do not allow guest interception of actor-fatal panic or supervisor CONTROL.
- Session transitions from a previous code version remain pinned to that protocol version, or are upgraded only through an explicit, verified compatible session migration. Incompatible hot swap may route *new* sessions to the new generation while old sessions drain, without forging a new next phase.

### Static witnesses and refinements

Existing `docs/REFINEMENT_TYPES.md` and the static-traits parts of the AOT language closure remain authoritative. Built-in / statically checked refinement constraints can prove inputs and output invariants; dynamic untrusted values require explicit checked construction. Associated/protocol witnesses are finite and resolved at compile time, not selected by an open runtime registry. Protocol witnesses must not launder capabilities or skip effects/ownership validation.

## Diagnostic categories and admission behavior

Proposed stable diagnostic families (exact code numbers reserved pending frontend implementation):

| Category | Reject examples |
| --- | --- |
| `AOT_INCOMPLETE_GUEST_CLOSURE` | Truffle evaluator used as guest AOT, missing compiled actor/callback path, unsupported runtime source fallback |
| `AOT_OPEN_DISPATCH` | runtime extension of protocol/generic targets or arbitrary runtime AST/macro execution |
| `UPGRADE_UNSAFE_GENERATION` | impossible code loader, lost frame pin, unproved state/session migration, over-budget retirement |
| `UPGRADE_CAPABILITY_ESCALATION` | new generation expands OS/actor/CONTROL authority |
| `RT_UNKNOWN_BOUND` | missing WCET / queue / cleanup / lock / FFI / GC interference evidence |
| `RT_CERTIFICATE_MISMATCH` | source/image/hardware/OS/runtime/callgraph no longer matches qualification |
| `SESSION_ILLEGAL_TRANSITION` | wrong phase, unlisted message, use after moved session capability |
| `SESSION_AUTHORITY_FORGERY` | copied/replayed/serialized handle, stale generation/incarnation, forged epoch |
| `SESSION_AMBIGUOUS_COMPLETION` | cancellation/timeout incorrectly reissues old-phase handle after accepted work |
| `EFFECT_PERMISSION_MISMATCH` | effect signature treated as a permission grant, unknown FFI, non-delegable capability |

All unsupported cases **fail closed**. Do not label generic runtime `Err` as proof of a compiler rejection. Required results: `verified`, `compile_reject_expected`, `unsupported`, `failed`, or `not_executed`. Only executed guest code + exact provenance qualifies as positive backend evidence.

## Executable evidence gates (not satisfied by this document)

- **E0:** shared schema, source-free oracle + negative cases (this PR level).
- **E1:** independently compiled real `.ores` positive/negative fixtures in Java and LLVM, including ownership/effect/permission/protocol rejection; backend syntax unsupported cases explicitly fail before artifact.
- **E2 LLVM:** actual native executable with actor/session send/await/timeout/cancel/panic and generation fencing; verified no guest interpreter/JIT; inspect linked closure; ASan/UBSan as applicable.
- **E2 GraalVM:** actual Native Image native executable containing program-specific compiled guest calls, no guest Truffle evaluator fallback; actor/session execution, cancellation and generation pins; inspect emitted program-specific methods and reachable code.
- **E3 swap:** verified in-process precompiled loader support *per backend*, or honest alternative process handoff; V1->V2->V3 with long-lived stream, bounded budget rejection, no forced purge, cancellation-versus-quiescence negative, schema and capability compatibility, post-commit rollback semantics; verify listener/request continuity before claiming zero downtime.
- **E4 RT:** source-linked bounds and a target-specific timing/deadline certificate, including upgrade jitter, GC/interference assumptions and stress corroboration; normal Graal Native Image qualifies only as AOT/soft-RT without separate hard-RT vendor proof.
- **E5 parity:** same observable source semantics and negative diagnostics in both backends; then .NET/WASM/Forge explicitly report implemented or unsupported separately. Pin exact repository tree, toolchain, artifact digests, runner allocation, executed steps and test receipts. Zero-step Actions, host mocks, reference JSON, skipped/pending or source-free tests **never** count as backend proof.

## Rollout order

1. Shared contract and machine-readable fail-closed vectors (E0) with zero changes to executable language behavior.
2. Java and LLVM source-derived **closed-world typed effect/ownership/witness/transition evidence** plus negative compiler gates before enabling positive features.
3. LLVM native guest AOT and Java guest-code Native Image AOT for the same small actor protocol; only then describe that protocol as implemented.
4. Generation-aware session migration and certified safe-point boundaries; production admission distinct from optimistic dev tooling.
5. Soft-RT observability then per-target hard-RT qualification, without silently upgrading soft latency claims.

Existing implementation trackers: Java [AOT closure #2044](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/2044), shared [hot generation #73](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/73), [actor state upgrade #149](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/149), Java [typestate #1392](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1392), and [five-backend parity #1078](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1078). Avoid duplicate feature implementations; wire new acceptance cases into these trackers.
