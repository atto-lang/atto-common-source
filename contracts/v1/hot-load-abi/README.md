# Universal Hot Load Interface v1 (UHL-1)

**Status: proposed normative contract, not implemented backend parity.** This complements the [actor hot reload model](../actor-hot-reload/README.md) and the OTP portability metadata in `contracts/library/v1/otp-portability.json`. It does not silently replace existing Java hot-load generations or LLVM code slots. The companion verifier is a **source-free model**, not an Oreslang guest, ABI, or sandbox test.

## Portable interface and backend mapping

The semantic interface is `ores.hotload/v1` with operations `query_capabilities`, `stage`, `prepare`, `freeze`, `quiesce`, `checkpoint`, `migrate`, `commit`, `abort`, `retain`, `release`, `retire`, and `inspect`. All are **trusted supervisor/runtime CONTROL** calls, never ordinary guest exports. `send`, `await`, `cancel`, and ETS operations remain independent DATA/provider APIs and must observe the same epoch fences. Implementation may be asynchronous; CONTROL must not block actor carriers while waiting for quiescence, I/O, compilation, or migration.

The included `ores_hot_load_v1.h` is a versioned **in-process C host adapter ABI**, not the wire format. Java/Graal may adapt from Java/Truffle native entrypoints; LLVM AOT/ORC and Cranelift use trusted native loader bridges; .NET NativeAOT uses explicit statically rooted native exports; Wasm uses a versioned Component Model/WIT host adapter with opaque resource handles, never C pointers. A backend lacking dynamic executable loading must report `UNSUPPORTED`, or perform explicitly identified supervised process replacement. There is no presumption that Cranelift provides an ORC-like JIT or that NativeAOT/Native Image can arbitrarily load managed classes.

`query_capabilities` reports independently: `code_only`, `state_migration`, `supervised_subtree`, `ets_heir`, `ets_schema_migration`, `untrusted_replacement`, `native_image_unload`, and permitted AOT/JIT transitions. A backend cannot claim UHL-1 full conformance by passing an unsupported-path rejection test. Unsupported features must fail **before** staging/publication; no implicit best-effort or cross-trust fallback.

## Canonical immutable identity

A release manifest must bind exact source Git tree and transitive dependency closure, compiler/toolchain and binary SHA-256, image digest/signature policy, module/actor public ABI, mailbox/wire ABI, state schema, ETS table schema, capabilities/effects, child specifications and parent supervisor identity, isolation kind, tenant/isolate placement and execution mode. Strings/hashes are *identifiers*, not authority. Handle/policy authenticity comes only from a trusted runtime-owned issuer and authenticated admission. No guest-provided `bool admitted`, arbitrary DSO path, context pointer, raw FFI pointer, or forged `CompiledUnit` is valid proof.

Stable `logical_actor_id`, `supervisor_id`, table IDs and actor-owned mailbox identity are separate from `physical_actor_id`, `code_generation`, `actor_incarnation`, and monotonic `route_epoch`. A transparent code-only upgrade changes **route epoch and code generation**, not actor incarnation or ETS table lifetime; a crash/restart increments **incarnation** and changes generation-fenced ownership. Epochs do not wrap or recycle.

## Transaction and single linearization point

1. **Stage** authenticated candidate into an isolated image without invoking application init. Bind a transaction to exact supervisor, logical actor/subtree, old epoch, expected image, capabilities and all schema digests.
2. **Prepare** the complete supervised child-spec update and explicit state/ETS strategy. Resolve dependents in supervisor-tree order, including dynamically registered children; reject unsupported topology, unresolved handles, unowned ETS tables and partial support.
3. **Freeze DATA admission** at the supervisor-owned gate (not by occupying a carrier). Permit CONTROL, stop, fatal notifications, cancellation and replies needed for drain. Every actor turn, suspended Task, continuation publication, timer, foreign callback, external operation, shared lease, ETS reader/writer, and remote acknowledgement that could access old code/state/image counts as a generation pin.
4. **Quiesce** with deadline and bounded queue budgets. Never equate empty mailbox with drained execution, and never run guest migration or cleanup beneath supervisor/loader locks.
5. **Checkpoint / migrate** with typed versioned formats, canonical encoding and fresh actor-owned staging arenas for schema changes. ETS schemas require a separate owner-authorized snapshot plus write fence or provable versioned dual-read/grace protocol. No pointers/capabilities/locks/callbacks/FDs in checkpoint wire. Refuse missing migrator, non-idempotent external side effects or shared-data layout drift with no proven grace.
6. **Commit** exactly once by CAS of expected `route_epoch`, publishing the new *coherent* (code image, route, child specs, actor state, ETS access epoch) tuple. Route publication must not be split across compiler/JIT, scheduler, supervisor and ETS provider. Concurrent commits have exactly one winner; losers retain no authority.
7. **Resume** DATA only after publication and successful candidate readiness. Precommit errors abort without disturbing old serving route; postcommit failures trigger a **new** controlled transition or supervisor crash/restart policy, not reopening stale ingress.
8. **Retire** old image only after all code-generation pins, FFI callback leases, old supervision handles, ETS snapshot readers and physical actor continuations drain. Image unload failures quarantine, preserve mappings and report failure; cleanup never occurs under CONTROL locks.

A planned replacement is **not** a failure for restart-intensity counting. A crashed child *is* handled by its supervisor's policy; a failing stage is an abort (not an implicit process restart). Enforce one_for_one/one_for_all/rest_for_one restart ordering and shutdown timeouts where supported; unresolved descendant/child migration fails closed. CONTROL fatal/stop lane cannot be blocked or dropped by a full DATA queue. Do not re-execute `on_start` on an in-place code-only change; a new physical actor's runtime bootstrap must not overwrite restored state, and guest startup hooks follow an explicit restoration policy.

## Erlang-style guest lifecycle and release plans

UHL-1 deliberately separates supervisor CONTROL from Oreslang source code. A future compiler-owned guest hook analogous to OTP `code_change` must have **typed, explicit, deterministic** semantics: `migrate_state(old_schema_id, checkpoint, migration_input) -> Result<new_checkpoint, UpgradeError>`. Its effect closure must be pure and bounded; no ordinary I/O, shared table mutation, actor spawn, FFI, sleep or network side effects, no ambient authority, no class reflection and no executable-pointer copying. Source syntax is **not standardized by this C header** and must be agreed in the Oreslang grammar/stdlib before guest support is claimed. A separate runtime-held ETS snapshot/schema adapter may validate table migration; guest code never owns CONTROL or table handoff rights.

An OTP-like declarative release plan orders `stage -> prepare -> freeze -> quiesce -> migrate -> publish -> retire` for a *complete* supervision subtree. It must carry explicit upgrade and downgrade schema pairs, child-spec versions, restart/shutdown order and dependent module closure. Arbitrary guest callbacks are not invoked under the supervisor lock. Rollback **before** publication can discard the candidate; downgrade **after** publication is a new authenticated transaction and cannot undo external side effects implicitly. No automatic rerun of actor `on_start` is allowed for a state-restored code-only upgrade; spawning a new physical actor must avoid overwriting restored state and follow an explicit restoration policy.

## ETS-like tables across upgrades and supervisor death

`ores.core/otp/ets` tables are **runtime-owned bounded typed tables** with independent `table_id` + nonrecycling `table_epoch`, tenant, owner incarnation, ACL and schema digest. They are not raw aliases into an actor-private heap. Code-only replacement preserves table identity, rows, owner and table schema. Tables owned by a stable supervisor/custodian are preferable for long-lived app state.

If a worker owns a table, configure an explicit **same-tenant, live, approved heir** before failure. On owner death, the runtime atomically fences the dead owner, makes the table temporarily non-writable, and transfers custody with a single-use generation-bound receipt. The heir must acknowledge before mutation; duplicate, late, foreign-tenant, wrong-incarnation and stale receipts fail closed. **Acknowledgement must additionally prove that the old physical owner is no longer in the runtime actor registry and has no executable actor turn, Task, FFI, timer or ETS lease able to access the table.** A staged handoff is not evidence of retirement, nor is a matching numeric receipt. A host-only `confirm_owner_retired` callback is meaningful only after independently verified registry/continuation teardown. If an heir dies before acknowledgement, close/quarantine the table; never reopen old-owner DATA. For shared tables, enforce the access policy and retired-owner fencing **while holding the same table lock** used for owner epoch advancement, so a prechecked DATA operation cannot write under a new owner after publication. Without a valid heir the table closes (or persists only under an explicitly declared durable provider) instead of silently becoming public. A planned hot upgrade may delegate ownership only through the same fenced transaction, never via a guest pointer. Transfer changes owner incarnation/table epoch but not table ID or committed rows. A failed owner-to-heir handoff must not leave two writers.

ETS schema migration needs transactional snapshots or explicit compatible multi-version epochs, schema-specific authorization, bounded memory and a rollback boundary. Even if code and supervisor publication are atomic, external network/database/ETS effects that already escaped are **not** automatically reversible. Cross-node distributed ETS/pg semantics require a separate protocol: this local ABI makes no network-consensus promise.

## Mandatory conformance matrix

Run all cases with **Java/Graal, LLVM AOT/PIC and ORC where available, Wasm, .NET NativeAOT and Cranelift**; distinguish `PASS_EXECUTED`, `UNSUPPORTED_CONFIRMED`, `NOT_EXECUTED`, and `FAIL_EXECUTED`. At minimum: ABI-preserving code-only 42→43/45 with stable logical ActorRef/mailbox/ETS; AOT→AOT and each advertised JIT transition; failed stage; incompatible ABI, capability, state and table schema; concurrent CAS; stale/forged handles; parent/child restart strategies; freeze during await/FFI/ETS mutation; table heir/owner death; duplicate receipt; bounded quota; failed migration/health; postcommit failure; unload quarantine; untrusted placement; rapid upgrades; graceful shutdown while frozen. Verify six dimensions separately: source compiler, guest execution, supervisor routing, ETS provider, physical resource lifetime and isolation boundary.

Every executable result must carry exact source/tree SHA, toolchain digest, exact guest image hash, backend/mode, runner ID, run attempt, **nonzero executed steps**, observed outputs and negative-test receipts. No promotion from documentation, host-only model, synthetically green JSON, or zero-step CI. Private source mirroring requires independent authorization and exact tree/blob verification.

**Related**: common-source #73, Java #1967/#1972, LLVM #595/#602/#627, platform-conformance #284, common-source #107. Erlang's `release_handler`/`sys:change_code` and ETS `heir`/`give_away` are inspiration, not a binary ABI that Oreslang can reuse.

## Model fail-closed capability and counter boundaries (2026-11-04 hardening)

The **source-free Python reference** distinguishes an omitted feature list (model defaults)
from an explicitly empty feature set (no capabilities). An empty set MUST NOT
silently restore hot-loading, ETS-heir, or supervisor-subtree permissions. The
runtime owns authority; a caller-supplied feature list is not authorization.

The model rejects an ETS table-epoch increment or actor-incarnation restart at
`2^64 - 1` **before changing the owner, transfer receipt, counter, or supervisor
state**, because UHL-1 exposes bounded 64-bit host identities. These guards are
reference invariants only, **not** evidence of real ETS, restart, or native ABI
execution. The source-free suite is now **27** unittest cases per round (81
across three repetitions); original source-org stepful CI, native ABI adapters,
actual compiled AttoLang guests, and independent review remain outstanding.

## Terminal supervisor shutdown and ETS authority (source-free model hardening)

A terminal supervisor stop MUST revoke both pending and acknowledged ETS heir
DATA rights, preserve table ID/committed row values only as non-addressable
reference state, and refuse new handoffs or acknowledgement of pre-stop
single-use receipts. Closing the logical table is an immediate authority fence;
this source-free model does **not** prove safe physical reclamation, native
quiescence, or replay-free persistent storage. Three regressions cover pending
heir, live owner and already acknowledged heir shutdown races.

## Physical owner retirement gate and image label re-use (2026-11-08)

**Normative acceptance requirement, model-only implementation:** An ETS owner-death
event fences the previous writer but does **not** prove the old physical
owner is gone. The heir receipt must remain pending until the trusted
runtime independently establishes actor registry removal **and** drains all
turn/Task/continuation/FFI/timer/ETS/external leases able to touch the table.
Only that supervisor-owned proof at the exact table epoch may make the
single-use heir acknowledgement eligible. A stale, cross-tenant or forged
proof, unretired lease, pending transfer, or terminal stop MUST reject without
publishing a second writer. Terminal stop also revokes already confirmed but
unacknowledged retirement eligibility.

A child restart MUST NOT discard live physical Task/FFI/ETS leases or an
unacknowledged heir transfer. Retired or quarantined code-image identifiers
MUST NOT be recycled while the old identity may remain mapped; the final
runtime needs distinct monotonic generation IDs plus immutable content
digests, rather than trusting this oracle's simplified string code labels.
Actual owner-retirement proof requires runtime-owned actor registry,
generation pin bookkeeping and loader/ETS integration. The Python method
`confirm_owner_retired` represents the trusted observer **only**; calling
it in a model is not physical teardown evidence.

These eight additional source-free regressions intentionally do **not**
validate a source actor, real ETS provider, native image unloading, compiler
instrumentation, zero downtime, or backend parity. Together with the
stacked terminal-stop patch, the expected source-free inventory is 35 Python
cases per round (105 over three runs) **once executed on an admitted runner**.
