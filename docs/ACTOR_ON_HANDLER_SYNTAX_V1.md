# Actor `on` handler and `state` syntax v1

Status: shared source-language contract for staged backend adoption. This document defines source admission, normalization, and runtime obligations. It does **not** by itself establish executable backend parity.

## Goals

Oreslang actor declarations may express message/request dispatch directly with Symbol selectors while preserving compiler-owned mailbox, ownership, state, and reply authority.

Canonical brace-less form:

```ores
define actor Counter as
    state {
        int count = 0;
    }

    on #increment ::
        state.count += 1
    end

    on #add(int amount) when amount > 0 ::
        state.count += amount
    end

    on #get -> int ::
        return state.count
    end
end
```

Equivalent braced form:

```ores
define actor Counter as
    state {
        int count = 0;
    }

    on #increment -> void {
        state.count += 1
    }

    on #add(int amount) when amount > 0 -> void {
        state.count += amount
    }

    on #get -> int {
        return state.count
    }
end
```

The two body spellings normalize to the same actor-handler representation. Runtime behavior, ownership, effects, dispatch identity, and ABI metadata must not depend on brace choice.

## Grammar

Informative EBNF:

```text
actor_handler  := "on" symbol_selector parameters? guard? return_type? handler_body
symbol_selector := SYMBOL_LITERAL
parameters     := "(" typed_parameter ("," typed_parameter)* ")"
guard          := "when" expression
return_type    := "->" type_ref
handler_body   := "::" statements "end"
                | "{" statements "}"

actor_state    := "state" "{" state_entry* "}"
state_entry    := type_ref IDENT ("=" expression)? ";"
                | IDENT ":" type_ref ("=" expression)? ";"
```

A zero-parameter selector omits parentheses canonically: `on #increment`, not `on #increment()`. Backends may retain a compatibility spelling only if it normalizes identically and does not create a second ABI identity.

`on`, `state`, and `when` are contextual in these positions. A Symbol selector is a compile-time Symbol literal, not a String and not a dynamically evaluated value. Handler identity uses the Symbol's normalized key, so equivalent spellings such as `#ready` and `#'ready'` collide and must be diagnosed as a duplicate selector/arity rather than producing two dispatch entries.

## Return rules

A missing return clause on an actor handler means `void`:

```ores
on #increment {
    state.count += 1
}
```

is identical to:

```ores
on #increment -> void {
    state.count += 1
}
```

A handler that can produce a value must declare its result type explicitly:

```ores
on #get -> int {
    return state.count
}
```

The compiler must reject a value-returning handler with an omitted result type, a value return from `void`, or reachable fallthrough from a non-`void` handler. **Every non-`void`, non-lambda callable in Oreslang requires an explicit `return` on every reachable value-producing path.** A trailing expression does not implicitly return from a function, method, actor handler, or ordinary block. Lambdas retain their separately defined expression-body shorthand.

For a value-producing dispatch expression such as `match`, the enclosing callable still needs its explicit function return:

```ores
on #get -> int ::
    return match state.balance over
        on n when n >= 0 -> n;
        on _ -> 0;
    end
end
```

Non-`void` handler return values are request/reply results, not actor output-stream emissions.

## Delimiter rules

Each handler chooses exactly one body form. Delimiters may not be mixed.

Invalid:

```ores
on #get -> int {
    return state.count
end
```

Invalid:

```ores
on #get -> int ::
    return state.count
}
```

The outer actor still owns its own closing `end` when the actor uses `as ... end`.

## Dispatch identity

V1 handler identity is the pair **(Symbol selector, arity)**. Parameter names and return types are not overload selectors.

Examples:

- `#increment/0`
- `#add/1`
- `#get/0`

A v1 actor may declare at most one handler for a selector/arity pair. Multiple guarded clauses for the same selector/arity are deferred until ordered clause exhaustiveness and overlap diagnostics have a shared contract. Backends must reject duplicates rather than choose by parameter type, source order, or return type.

Parameter types are part of the handler ABI even though they are not overload discriminators. Every incoming payload slot must be assignable to its declared type before user code runs. Multiple source parameters are represented in the mailbox/request envelope as one ordered tuple of argument slots; they are not multiple independent mailbox messages.

## Guards

A handler guard is evaluated after selector/arity and payload type admission but before the body.

```ores
on #add(int amount) when amount > 0 -> void {
    state.count += amount
}
```

Guards must be Boolean, pure, deterministic, and non-suspending. They may read admitted parameter values and immutable constants. They may not read actor state: selector/arity/type/guard admission must complete before acquiring any actor-state capability. A guard may not:

- mutate actor state or other storage;
- perform I/O or actor messaging;
- `await`, select, cooperate, or otherwise suspend;
- transfer ownership with `rt take`;
- acquire mutable loans or capabilities;
- invoke an effectful or dynamically dispatched callable.

A false guard performs no user-state mutation. For a one-way event it enters the runtime's unhandled-event path; for a request it completes the request exceptionally with the runtime's unhandled-request failure. A backend must not silently execute the body or fabricate a default result.

## Actor state

An actor may contain zero or one compiler-owned `state { ... }` block. Ordinary actor instance fields outside that block are not an alternative storage channel once this contract is enabled.

Both state-entry spellings are accepted and normalize to the same fixed-key state schema. In v1, a default initializer must be a detached context-free scalar/immutable literal admitted by the actor-state contract. Calls, external bindings, evaluated allocations, and reference-valued defaults remain rejected until an actor-owned initialization/move lowering proves ownership:

```ores
state {
    int count = 0;
    name: string = "counter";
}
```

The type-first form is the documentation default. The name-first form remains accepted for compatibility with existing staged actor-state work.

`state` inside an actor handler is a compiler-recognized actor-state projection, not a heap object, reflection map, public field, or transferable reference.

```ores
state.count += 1
return state.count
```

Direct handler access is syntactic sugar for the shortest compiler-owned state capability necessary for that operation:

- a read such as `state.count` requires a read capability;
- an assignment requires a write capability;
- a compound assignment such as `+=` requires both read and write;
- the capability cannot escape the expression/statement or survive suspension.

This does not weaken the sealed `handle_state` / `using state.read/write` contract used by ordinary helper methods and lower-level backends. A backend may lower direct handler projections to those sealed operations. It must never expose a raw mutable state pointer or permit `rt borrow state.count` to escape an actor turn.

State keys are fixed at compile time. Duplicate keys, unknown keys, dynamic indexing, `self.state`, and returning/capturing the state object itself are rejected. Within an `on` handler, `state` is a reserved compiler binding: handler parameters and local bindings may not shadow it.

## Handler state authority

An `on` handler is an actor-turn entrypoint. It may use direct `state.<key>` syntax without a source-level `with state.read/state.write` clause; the compiler derives the minimal state-effect set from the body and records it in handler metadata.

Ordinary actor helper methods retain the explicit effect/capability rules of the actor-state contract. Calling a helper from a handler is permitted only when the helper's declared effects fit the handler's derived authority and ownership/lifetime rules.

This distinction keeps the common event-handler case concise without turning arbitrary methods into ambient mutable-state code.

## Event versus request/reply

A `void` handler is an event handler. A non-`void` handler is a request/reply handler.

The transport envelope, normalized selector, ordered argument tuple, correlation identifier, reply completion authority, cancellation state, and pending-reply accounting are runtime-owned. Guest source must not forge a dispatch envelope or directly manufacture/complete a reply token. Unknown selectors, arity/type mismatches, and false guards fail before user body execution or actor-state acquisition.

A non-`void` handler therefore lowers to the same kind of compiler/runtime request path as a typed `ActorRef.request(...): Future<T>`; it must **not** be implemented by emitting onto the actor's ordinary output stream.

This contract intentionally does not choose the final caller-side selector sugar. Whether a later source form is `ref.request(#get)`, a typed generated method, or another checked spelling, it must target this exact selector/arity/type contract and the same runtime-owned correlation machinery. Java PR #456 supplies correlation/reply machinery, but its single private `run(In): Out` entrypoint is not by itself multi-selector dispatch; an implementation must add an authenticated selector-bearing envelope/dispatch table before claiming this syntax executable.

Until a backend has a real correlated request/reply implementation, it may parse and diagnose this syntax but must not claim executable support for non-`void` handlers.

## Normalization

Both:

```ores
on #increment ::
    state.count += 1
end
```

and:

```ores
on #increment -> void {
    state.count += 1
}
```

normalize to one handler record equivalent to:

```text
selector = #increment
arity = 0
parameters = []
result = void
guard = none
state_effects = {read, write} as derived from body
body = canonical statement list
```

Concrete delimiters are not preserved as semantic behavior.

## Ownership and suspension

Handler parameters cross an actor boundary and must satisfy the backend's ordinary actor Sendable/ownership contract. Pattern-like parameter binding must not imply a hidden move.

State loans and borrowed payload references may not escape through:

- returned values;
- actor outputs;
- nested tasks;
- closures that outlive the handler;
- `await` or other suspension points unless the ordinary ownership checker independently proves a permitted owned copy.

An implementation must run the same ownership checker used by ordinary actor mailbox/request entrypoints after syntax normalization. Handler syntax does not imply a second `async` declaration kind: a handler may suspend only on a backend that has real actor-turn continuation lowering. Otherwise any suspending handler body must be rejected before code generation. Direct state capabilities remain expression/statement scoped and never stay live across that suspension.

## Interaction with `match ... over`

The `on` keyword deliberately has the same "this case handles this pattern" meaning used by canonical matching. Value-match arms have two explicit body forms:

```text
match_arm := "on" pattern guard? "->" expression ";"
           | "on" pattern guard? "->" "::" statements "end"
```

The expression-arm semicolon is explicit. A block arm is introduced by `-> ::` and, when it produces a value for a value `match`, must execute an explicit arm-result `return` on every reachable value-producing path. There is no implicit "last expression" return from a block arm.

Canonical example:

```ores
define actor Account conforms AccountService as
    state {
        int balance = 0;
    }

    on #deposit(int amount) when amount > 0 -> void ::
        state.balance += amount
    end

    on #withdraw(int amount) -> Result<int, Error> ::
        return match amount over
            on n when n <= 0 ->
                Err(#invalid_amount);

            on n when n > state.balance ->
                Err(#insufficient_funds);

            on n -> ::
                state.balance -= n
                return Ok(state.balance);
            end
        end
    end

    on #get -> int ::
        return state.balance
    end
end
```

Here the outer `return match ...` is the explicit **function/handler return** required by the non-`void` handler. Inside the block arm, `return Ok(...)` is the explicit **ARM_RESULT** for the selected value-match arm; it does not bypass the match and return directly from the actor handler. Frontends must preserve those two return destinations distinctly in typed IR.

Actor `on #selector` declarations are not implemented as runtime source-level `match` statements, however. The compiler records a handler dispatch table so selector/arity/type admission occurs before entering user code. This avoids repeated dynamic matching and keeps handler ABI metadata available to AOT/linkers.

## ABI and hot-reload identity

The canonical handler dispatch table is keyed by normalized Symbol selector plus arity. ABI signature metadata includes ordered parameter types, result type, and interaction kind (event versus request/reply). Concrete body delimiter and guard expression text are not ABI identity. Actor state has a separate schema fingerprint over fixed key names and key types; defaults and handler bodies are code-generation semantics, not a substitute for schema compatibility.

A backend must make dispatch-table construction deterministic and reject normalized duplicate keys before emitting executable artifacts. Hot reload may change handler bodies/guards under the ordinary code-generation compatibility policy, but a selector/arity/signature or state-schema change must pass the actor upgrade compatibility gate rather than being silently treated as the same ABI.

## Diagnostics

At minimum, frontends should distinguish:

1. malformed handler header;
2. non-Symbol selector;
3. duplicate normalized selector/arity, including equivalent quoted/unquoted Symbol spellings;
4. missing explicit result type for a value-returning handler;
5. non-`void` fallthrough;
6. value return from `void`;
7. non-Boolean/effectful/suspending guard;
8. mixed body delimiters;
9. duplicate or unknown actor-state key;
10. forbidden state-reference escape;
11. payload ownership/boundary failure;
12. backend lacks executable request/reply lowering.

Diagnostics should recover where practical so a compilation may report multiple independent handler problems rather than stopping after the first one.

## Backend promotion gates

A backend may claim **parser support** after source admission and normalization tests pass.

It may claim **event-handler execution** only after proving Symbol selector/arity/type dispatch, guard behavior, actor-state mutation, ownership, lifecycle, and one-way failure behavior in real guest execution.

It may claim **request-handler execution** only after additionally proving correlated Future completion, cancellation/stop races, exactly-once reply settlement, failure isolation, result ownership/copying, and no output-stream substitution.

Cross-backend parity requires Java/GraalVM, LLVM, .NET, Wasm, and JS/Forge-facing consumers to agree on the machine-readable cases; unsupported backends must reject before partial code generation.

## Existing staged work to reconcile

At the time this contract was written:

- Java draft PR #456 contains a runtime-owned typed request/reply vertical slice using a private request entrypoint and `ActorRef.request(In): Future<Out>`. It is a useful lowering substrate, not proof that this `on #selector` syntax is implemented.
- LLVM draft PR #244 contains the one-`state { ... }` actor-state invariant and sealed scoped state access. Its existing name-first state entries remain compatible with this contract.
- Java current main already recognizes canonical `match value over ... on Pattern ... end`; actor handler parsing should reuse the contextual `on` vocabulary without creating a second match-expression semantics.

These references are implementation inputs only. Exact-head executable evidence is still required before promotion.
