# Actor spawn dependencies and init hook — v1 proposal

**Status: PROPOSED / NOT EXECUTED.** This is a language-and-runtime design contract, not a claim that any Oreslang compiler admits `init` or the `state { ... }` literal shown below. Frontends MUST fail closed until grammar, type/effect checking, lowering, and actual guest tests are implemented.

## Decision

- `import module` / `import namespace` makes code and types available; imports do not select a tenant-specific live actor, grant resource authority, or construct a service instance.
- Explicit arguments to `spawn Actor(...)` supply dependency **values**. They bind by name/position under ordinary Oreslang call rules to exactly one special `init(...)` hook declared in that actor. They do **not** call an actor constructor; constructors for actors remain forbidden.
- `init` is a **reserved actor lifecycle entrypoint**, not a user-callable method or an actor message. It runs once during a *new* incarnation, after the runtime reserves an actor-owned arena and validates dependencies, but before the `ActorRef` is published and before a mailbox, handler or task can enter guest code.
- The actor retains its single compiler-owned `state { ... }` schema. **All actor-instance fields, including dependency references and mutable workflow data, live in this state schema.** There is no parallel injected-field store. Initial construction of the complete state value is different from later state mutation; **every later state mutation uses sealed `handle_state(critical[write] ...)`**. A read uses `critical[read]` where required.
- No `@Inject`, runtime reflection, service locator, implicit global dependency registry, ambient I/O provider, class constructor, or new `inject` keyword. A composition root can be an ordinary Oreslang function or a library-provided typed actor-graph builder.

## Illustrative source grammar — not compiler-verified

The following new **proposed** surface requires its own parsing and lowering. Do not copy this into a production executable and assume it compiles.

```ores
import module orders
import module storage
import module payments

define isolated actor OrderActor as
    state {
        store: ActorRef<TenantStore>;
        gateway: ActorRef<PaymentGateway>;
        phase: OrderPhase;
    }

    init(store: ActorRef<TenantStore>,
         gateway: ActorRef<PaymentGateway>) -> state {
        return state {
            store: store,
            gateway: gateway,
            phase: #created
        };
    }

    pub begin_order() -> void {
        self.handle_state(critical[write] |s| -> {
            s.phase = #processing;
        });
        // Messaging / external effects occur only after the state loan releases.
    }
end

pub async routine main(): void {
    val store = await spawn TenantStore();
    val payment = await spawn PaymentGateway();
    val orders = await spawn OrderActor(store: store, gateway: payment);
}
```

The contextual `-> state` and `return state { key: value, ... };` are a **candidate one-time, complete-state builder**. They are not ordinary state projection/mutation, not a general constructor syntax, and not public/serializable state values. The compiler type-checks each key and moves or copies admitted values into the new actor-owned state under runtime authority, then seals the state before publication. A source form must not accidentally permit building a detachable state record outside `init`.

If no `init` is declared, `spawn Actor()` is permitted only when the state is empty or every state key has a compiler-admitted, detached, context-free literal default. With `init`, **every state key must appear exactly once in the returned complete state**, even if the schema carries a default. Partial/dynamic state construction fails closed. Exactly one `init` per actor; its signature/arity is not overloaded. Optional/named argument rules must follow the ordinary language binding contract; v1 does not introduce hidden defaults for actor capabilities.

## Precise lifecycle

1. **Preflight:** resolve imports and actor type at compile/link time; bind spawn argument labels/arity exactly to the declared init signature; check types, effects, ownership, required capabilities, provider availability, tenant/isolate authority, and graph budgets. Reject ambiguity, missing/extra/duplicate labels, implicit conversions, borrowed/expired refs, and stale generations. Static checks do not substitute for live runtime revocation/fencing.
2. **Reserve:** runtime allocates the actor's private arena/state slot, mailbox budget, supervisor/parent link, generation and cancellation/teardown scope. None of these creates a guest-visible `ActorRef` yet.
3. **Run init:** execute one deterministic, synchronous, non-suspending, bounded state builder in an exclusive initialization lane. No mailbox access, `self` publication, actor send/spawn, `await`, I/O, dynamic provider resolution, `handle_state` loan, or acquiring new privileged capability. Inputs may be immutable values or admitted owned/capability-checked references. Ordinary borrow lifetimes may not outlive the call.
4. **Commit:** verify every state key initialized with the declared type; atomically install the complete actor-owned state, freeze immutable dependency bindings, and mark the actor ready. Only then publish a valid actor ref, enable mailbox admission, and start scheduled actor work.
5. **Abort:** any init/type/authority/resource failure destroys the private partial state/arena, revokes staged capabilities, releases all credits and leases exactly once, and returns an explicit spawn failure to the creator. No actor ref escapes and no message/handler is processed. Never silently retry init.
6. **Stop/restart:** a fresh supervised incarnation may perform a new init with freshly authorized capabilities; stable logical identities and old incarnation refs remain generation-fenced. Durable workflow **restore** does not rerun ordinary init over snapshot state: perform separate schema-version validation, capability rebinding, lease fencing, and explicit migration before admission. No automatic replacement of old bindings during hot reload.

The existing `await spawn Actor(...)` idiom is preserved. The exact typed spawn-failure surface must be reconciled with the current backend `Future` / `Result` ABI; this proposal intentionally does **not** invent a hidden flattening of `Future<Result<...>>` or retype every existing call. A failed init must always be observable, not an allegedly successful ref.

## Hardening and dependency authority

- `ActorRef` names a communication endpoint, **not** direct access to another actor's mutable fields/heap. Passing a ref does not transfer unrelated memory authority.
- The supervisor/compiler must validate imported type identity and runtime capability/tenant/isolate scope. An arbitrary typed ref is never sufficient proof of authorization; cross-isolate/tenant refs require explicit brokered endpoints and policies, not pointer sharing.
- Dependencies are immutable **bindings** in the owning actor's state: a handler cannot silently rebind `store` or `gateway`. If changing a dependency is required, stage a new actor graph generation and explicitly drain/fence/rebind through the supervisor. This is not live global DI.
- Initialize all dependencies in the composition root. If `PaymentGateway` needs async startup, spawn/verify it **before** spawning `OrderActor`; do not make init await or execute network I/O. Graph admission rejects unresolvable dependency cycles instead of exposing half-initialized refs.
- Actor code and handlers must not publish a partial `self`, and a child that fails during graph startup must trigger bounded rollback of only the graph-owned children, not accidentally stop independently owned shared services.
- Actor state writes in handlers/helper methods are sealed and non-reentrant. Use the canonical `self.handle_state(critical[write] |s| -> { ... })` family from the proposed actor critical-mode contract; no read→write escalation, mutable loan across suspension, messaging while loan held, or unlocked self-field changes.
- Hard-real-time actors require a statically admitted, bounded init cost/allocation profile with no unbounded allocation or blocking paths. Do not claim hard RT merely from a synchronous hook.
- A capability or secret must not be serialized with a durable snapshot as a reusable authority token. Recovery reattests and rebinds against current tenant permissions.
- All dependency graph edges and init ABI signatures must be visible in AOT metadata: no classpath reflection, unbounded dynamic service resolution, or backend-specific implicit host-language DI.

## ABI and compiler conformance

The actor initialization ABI includes canonical actor type identity, init parameter names/types/ownership/effects, exact state key schema and immutable-binding flags. Canonical type and namespace imports use the package root/closed resolver; identical imported namespace identities may not create duplicate dependencies. A changed init signature or state schema is an explicit compatibility/migration decision, never a silent hot-reload match.

Required negative compiler/runtime fixtures: duplicated/overloaded init, actor constructor, external `actor.init()`, missing/extra/wrong/duplicate spawn argument, implicit conversion, incomplete/duplicate/wrong-typed state return, `await`/message/spawn/self escape during init, ref of wrong tenant or revoked incarnation, partial publication on failure, invalid restore re-init, mutation without `critical[write]`, unresolved graph dependency cycle, and resource exhaustion with no leaked credits.

**Evidence:** `fixtures/actor-init-spawn-v1.json` defines proposed accept/reject vectors. `tests/actor-init-spawn-v1.test.mjs` is a source-free reference gate; it does not parse, compile, or execute `.ores`. Promote Java/Graal, LLVM, .NET NativeAOT, Wasm and JS only upon exact-tree real guest compile/execute with nonzero CI steps, explicit backend SHA and actor/ref/cancellation/arena observations. If unavailable, report `NOT_EXECUTED` or `UNSUPPORTED`. No transfer of private source between organizations without separate authorization.

## Compatibility notes

- Reconciles the single `state { ... }` and sealed state authority in [actor on-handler syntax](ACTOR_ON_HANDLER_SYNTAX_V1.md) and the staged `critical[read]` / `critical[write]` convention in [PR #187](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/187). Current actor on-handler direct projections remain a separately gated compiler sugar, not permission to mutate ordinary helper state without sealed write authority.
- Keeps the existing [functional actor composition](FUNCTIONAL_ACTOR_COMPOSITION_V1.md) and [durable workflow actors](DURABLE_WORKFLOW_ACTORS_V0.md) semantics. Graph wiring and tenant-specific service references are userland; the language only needs a single init ABI and admission checks.
- This proposal should be implemented **first** in the shared semantic/HIR contract, then Java and LLVM frontends/runtimes, then .NET/Wasm/JS. A shared contract document is not backend parity.
