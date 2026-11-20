# Durable workflow actors v0 — proposal and conformance contract

**Status:** design contract for implementation; not a claim that Java, LLVM, or other backends implement this feature.
**Scope:** Oreslang actor execution, `stdlib/workflow`, external adapters, and browser projections.
**Dependency rule:** `core` stays freestanding; `alloc` is optional; database, HTTP, Git and AI interfaces must not be imported by `core`.

## Identity and scheduling

An actor has a stable logical address `(tenant_id, workflow_id, run_id, node_id)`, different from an ephemeral incarnation/placement or process ID. The directory resolves an address to a live mailbox or a dormant durable inbox. Node records always bind to a versioned workflow definition. `WorkflowNode<In,Out,State>` is an optional library-level typed contract, not another actor keyword. A node can have many UI elements; one HTML button does not imply one actor.

A durable actor MUST:
- preserve its identity, committed state and durable unconsumed messages across runtime crashes;
- serialize admitted handlers under Oreslang's actor-wide execution lease (including continuations and cleanup);
- have a monotone **activation epoch** and storage-enforced fencing for writes from previous activations;
- retain private mutable state in its actor-owned heap/arena, not place ordinary actor state into a shared heap;
- use explicit checkpoint-safe points, not arbitrary stack/borrow/FD serialization;
- preserve explicit resource/capability policy on reactivation, never restore access merely from saved handles;
- reject incompatible state/code versions unless a reviewed migrator is supplied.

`RUNNING -> QUIESCING -> DORMANT -> RESTORING -> RUNNING` is the normal freeze cycle. `FAILED`, `CANCELLED`, `COMPLETED`, and `QUARANTINED` are terminal/recovery states. Durable logical actors can remain dormant for years without retaining OS threads, private arenas or sockets.

## Atomic transition boundary

For one inbox message, perform one database transaction (conceptually):

1. Verify tenant and actor IDs, current fencing epoch, and inbox delivery ID.
2. Validate the typed input, workflow-definition version, and optional deduplication key.
3. Compute next state and a list of event/outbox **intents** under the actor execution lease.
4. Commit state version, consumed inbox position, new events, outbox intents, and changed timers together.
5. Send outbox intents asynchronously; record delivery receipts separately and retry idempotently.

External integrations are *not* part of this transaction; therefore the contract does NOT claim exactly-once network side effects. Once-only logical *commit* is possible; transport delivery may be at least once. Each side-effect intent must have a durable deterministic idempotency key, explicit tenant authorization, capability scopes, deadline, retry policy and reconcile action. A dispatcher must check the current run/attempt/SHA before any mutation of Git state.

An incoming GitHub webhook is authenticated at ingress, durably stored and acknowledged quickly. It is matched by installation/repository, workflow run, requested ref, exact expected commit SHA and iteration; an unrelated or delayed delivery cannot advance the run. Signature failure and replay attempts fail closed.

## Suspension and restoration

A freeze request seals execution admission, waits for safe handler completion (or a defined durable suspension), stores a versioned snapshot + inbox/outbox cursors and registered timers, then releases the arena and activation lease. Any new message is stored durably and may reactivate the actor. No guest callback runs during database recovery outside the actor execution lease. In-flight AI calls, container jobs and Git pushes are persisted as *operations with external receipts*, not suspended Java/LLVM stacks. Rehydration reconciles such operations before submitting duplicates.

The snapshot envelope must identify the state-schema version, code generation and snapshot checksum/hash. For v0, `snapshot_digest` is mandatory, formatted `sha256:<64 lowercase hex>` and computed over RFC 8785 JCS canonical JSON of the entire snapshot envelope **excluding the digest member**; validate it before activating, and bind the hash to the expected tenant/address and storage version. A digest detects accidental corruption, not malicious storage tampering; authentication and encryption-at-rest are separate adapter responsibilities. Migrations need explicit version edges, rollback strategy, and test vectors. Activation epochs are independent of code generations: a hot reload and a lease takeover may have distinct fencing and code versions.

## Workflow graph

A workflow definition consists of typed node instances and explicit directed edges:
- `connect(a,b)` checks output/input compatibility; `when(a,#failed,b)` routes typed outcomes;
- loops are allowed, but *each iteration* is separately recorded and bound by progress/budget policy;
- `ActorStream<T>` `pipe` remains a streaming primitive, not a synonym for durable routing;
- cancellation and compensation are messages; they must be deduplicated and supervised;
- a workflow run may outlive browser sessions and may pin an older definition/code generation;
- human approvals are durable decisions with authenticated actor/run/version context.

Default fail-closed budgets: iteration count, AI token/cost, CPU and elapsed time, repeated failure fingerprint, and human review on privileged actions. The workflow must not auto-merge, deploy or publish sensitive data solely because tests pass.

## UI projection and transports

The backend actor/run record is authoritative. A UI projection is a versioned, redacted view of state, not guest actor-memory serialization. HTTP/HTMX commands authenticate user, tenant and actor permissions and are delivered to mailboxes; GET views are read-only. Prefer a full rendered snapshot on reconnection plus SSE updates tagged by monotone event IDs. Treat SSE/HTMX payloads and selectors as presentation only; never authorize commands by presence of a button. Escape all user-controlled content, redact secrets and prevent cross-tenant subscriptions.

## AI development loop v0

`TicketSource -> CodeEditor -> GitPush -> (GitHubWebhook/CI correlation) -> TestRunner -> [pass:Approval, fail:BugReporter -> CodeEditor]`.

Required stable fields: `workflow_id`, `run_id`, `node_id`, `iteration`, `expected_sha`, `dedup_key`, `state_schema_version`, `code_generation`, `activation_epoch`.
GitHub issue creation should use a failure fingerprint and deterministic idempotency key to avoid creating a report per redelivery.

## Conformance gates (not yet implemented by this contract)

1. Crash before and after atomic commit: no lost committed event or doubled state transition.
2. Duplicate and out-of-order webhook: at most one logical iteration advance for matching SHA.
3. Expired worker epoch: all storage writes fail, including state, outbox, and timers.
4. Freeze while external side effect is pending: restore reconciles receipt or retries without losing intent.
5. Incompatible snapshot version/code generation: quarantine; no silent best-effort rehydration.
6. Quiescing under mailbox load: durable ingestion continues; no guest handler runs during snapshot release.
7. Multi-tenant authorization and arbitrary user strings: no leakage into another actor's UI projection.
8. Progress policy: unchanged failure is bounded; success routes to review, not automatic privileged action.

Related implementation locations: `oreslang-source.java` runtime; `oreslang-platform-conformance` executable abstract models; `oreslang-ssr` HTMX/SSE rendering. This document defines semantics only, not executable runtime coverage.
