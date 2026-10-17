# OTP-style behaviours for Oreslang — proposed v1 contract

**Status: design proposal only.** The separate [freestanding core / alloc / actor / OTP portability contract (PR #66)](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/66) is the single authority for the six required `stdlib/otp/*.ores` source paths, portable import closure, and current **not-implemented** status. This RFC covers the behaviour semantics, and does not claim any source-level OTP execution.

## Objective

Provide an Oreslang-native, strongly typed analogue of Erlang/OTP **behaviours** over existing actor/CONTROL/ownership infrastructure. Do not model these as BEAM bytecode, and do not conflate generic servers with all actors. Prefer `std/otp` (or final namespaced equivalent) interfaces implemented by ordinary serial actor classes, with an optional `extends GenServer<...>` convenience base after the compiler supports it.

Existing dependencies:
- Java supervision source lowering: oreslang-source.java#641, runtime tree: #476.
- Native supervisor semantics: oreslang-source.llvm#175.
- Native actor and compiler gaps: await/continuations, message ownership, exception/control delivery.
- Stable control-plane identities and hot upgrade generations remain separate from ordinary actor group membership.

## Minimal behaviour matrix

| OTP concept | Oreslang analogue | Core contract |
| --- | --- | --- |
| gen_server | GenServer<State,Call,Reply,Cast> | typed request/reply, cast, startup/teardown, serial state |
| supervisor | Supervisor<Spec> | runtime-minted CONTROL authority; one_for_one, one_for_all, rest_for_one; bounded restart intensity |
| gen_statem | GenStateMachine<State,Event,Data> | explicit transitions, deferred events, timers and deterministic state actions |
| gen_event | EventManager<Event> | typed subscriptions, bounded queues, supervised handlers |
| application | Application | dependency graph, initialize/start/stop ordering, failure/rollback |
| release | OresRelease | versioned app bundle, capability/policy manifests, staged update + rollback |
| registry / pg | ActorRegistry and ActorGroup | named lookup with incarnation fencing; group membership never conveys supervisor authority |
| ETS | SharedTable<K,V> | explicit table owner, immutable/sendable keys, scoped read/write grants, lifetime and quotas |
| Mnesia | DistributedStore (later) | replicated transactional persistence; **not** equivalent to ETS or a local map |

The names and example syntax are proposals; compiler admission must remain fail-closed until actually implemented.

## Generic-server v1 API / state-machine obligations

Prefer library behavior contracts, not a special new `gen_server` language keyword.

- A server is **one serial actor turn** across `await`; handlers cannot run concurrently against its private mutable state, including while suspended. Other actors may continue.
- Type parameters are nominal `State`, `Call`, `Reply`, `Cast`; callers can only send request variants admitted by the endpoint. No `any` payload fallback.
- Lifecycle callbacks: `init(args) -> Result<State, InitError>`; `handle_call(request, reply_to, state)`; `handle_cast(event, state)`; `handle_info(event, state)`; `tear_down()`; and `code_change(old_revision, snapshot) -> Result<State, UpgradeError>`. Exact syntax/return envelopes TBD. Compiler callback signature enforcement mandatory.
- `ref.call_async(req, deadline, cancel) -> Future<Result<Reply, CallError>>`; `ref.cast(event) -> Result<SendReceipt, SendError>`. `await` in calling actors stays nonparking; no unbounded implicit wait. `SendReceipt` acknowledges local admission, not successful processing or remote delivery.
- Runtime-minted **opaque one-shot reply capability** binds actor identity + incarnation + call correlation; may be consumed once or explicitly declined; never serialize or hand to arbitrary actor DATA and never let guest forge IDs.
- Calls to self that would deadlock must be rejected or fail deterministically. Call timeout/cancellation does **not** retract already accepted work. Late reply cannot satisfy another call, and pending future resources retire.
- Bounded and separate USER mailbox / reserved CONTROL capacities; on overflow, caller receives typed error, retaining explicit ownership of any undelivered moved payload.
- A crash reports one authenticated failure per actor incarnation to its supervisor using CONTROL; `throw/raise/panic` escalation follows Oreslang's error model. Ordinary users cannot forge or swallow failure/control events.
- Explicit startup readiness handshake; errors returned to spawner **and** supervisor. Child spec binds parent before visibility. Teardown at most once on own actor lane where graceful; forced stop/cancel different.
- Restart spec: permanent/transient/temporary; `one_for_one`, `one_for_all`, `rest_for_one`; intensity and period limits with escalation, no hot busy restart loop. Clear ordering for drain/stop/restart.
- Hot reload: validate ABI, code revision, message schema and capabilities before publication. Migrate detached, owned state at safe point; rollback leaves old code authoritative; stale messages/references are fenced via incarnation and code revision. Outstanding continuations must pin old revision until quiescent.
- Serializing actor-local state into ETS or distributing tables requires separately authorized data ownership, and does not share mutable actor heap pointers.

## Source example (DESIGN SYNTAX — must not be advertised as compilable)

```ores
// Illustrative API; not yet parsed/compiled as written.
define actor Counter extends GenServer<CounterState, CounterCall, CounterReply, CounterCast> as
  // State must remain sealed within actor turns.
  // on_call(#get, reply_to) -> reply(#value, count)
  // on_cast(#increment) -> mutate own count
end
```

Avoid inventing a privileged `handle_supervisor_panic` ordinary callback. Supervisor CONTROL is runtime-minted, not a DATA method.

## Executable conformance gates (required)

1. Compile-admission + negative source fixtures for handler signatures, wrong Call/Reply/Cast variants, attempted forged reply capability, duplicate reply and arbitrary forged CONTROL; cross-backend when supported.
2. Start one GenServer; 100 clients concurrently call + cast; linearizable single-server handler order; finite/mailbox saturation backpressure.
3. Request times out while accepted server still completes; ensure late result cannot confuse a reused correlation ID or race with cancellation; deterministic self-call refusal.
4. Actor panic/unhandled error emits exactly one CONTROL event and supervised restart; restart intensity exhaustion escalates to parent (not a catchable actor Error).
5. `one_for_all` and `rest_for_one` child ordering; graceful reverse shutdown; startup failure/rollback.
6. Hot-code generation pinning + compatible state migration + rejected incompatible ABI/capability escalation; no leaked old heap references.
7. Differential Java/LLVM source and runtime cases with **real exact-head compiler provenance**. A fake harness or static schema check is not implementation evidence.

## Milestones

G0 — Spec and normative source fixtures in common-source / platform-conformance.
G1 — Java/Truffle library + runtime GenServer with true guest-source execution (call, cast, init, teardown) under existing serial actor discipline.
G2 — Supervisor-managed GenServer child specs, failure CONTROL, restart policy and fault-injection.
G3 — LLVM/native parity (await/reply/cancel, source handlers, restart CONTROL); do not assume native actor host tests imply guest-source parity.
G4 — gen_statem, Application, EventManager/Registry; ETS-like table and releases later.

Dependencies are feature gates, not claims of CI success. Never mirror private compiler trees into unapproved or public CI repositories.
