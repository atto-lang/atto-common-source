# Full-AOT language closure and Elixir-inspired features v1

Status: shared language contract. This document defines what source features may enter the normal Oreslang language profile. Full ahead-of-time closure is a language admission rule, not merely a backend optimization target.

## Core invariant

After compile-time expansion and whole-program reachability, every executable behavior must be representable by a finite, statically emitted program image.

Runtime data may select among precompiled behavior. Runtime data may not create new executable Oreslang behavior.

The normal Oreslang profile therefore requires all of the following before backend code generation completes:

1. all source macros are expanded and eliminated;
2. all imports and aliases are resolved;
3. all reachable generic specializations or static witnesses are finite and known;
4. all actor handler tables are closed and deterministic;
5. all protocol/trait dispatch targets are statically representable;
6. all storage layouts and generated accessors are fixed;
7. all serializers/deserializers required by the closed program are generated;
8. all callable effects are known;
9. all ownership/borrow obligations are validated;
10. no executable behavior depends on runtime source compilation, runtime reflection, runtime type synthesis, runtime macro expansion, or a mutable runtime implementation registry.

A backend that cannot prove these properties must reject the program before emitting a runnable artifact.

## Explicit return invariant

Every non-`void`, non-lambda function, method, actor handler, and ordinary callable must execute an explicit `return` on every reachable normal value-producing path.

A trailing expression never implicitly returns from those callables.

```ores
fnc value() -> int
    42
end
```

is invalid.

```ores
fnc value() -> int
    return 42;
end
```

is valid.

Expression-bodied lambdas remain a separate, explicit shorthand because their syntax itself denotes an expression body.

For a value dispatch:

```ores
fnc classify(int value) -> Result<int, Error>
    return match value over
        on n when n < 0 ->
            Err(#negative);

        on n -> ::
            let int doubled = n * 2;
            return Ok(doubled);
        end
    end
end
```

the outer `return match` is a FUNCTION_RETURN. The block-arm `return Ok(...)` is an ARM_RESULT for the value match. The compiler must retain those distinct typed control-flow destinations.

## Match arm surface

Canonical value-match arms are:

```text
on <pattern> [when <guard>] -> <expression>;
on <pattern> [when <guard>] -> ::
    <statements>
    return <expression>;
end
```

Expression arms terminate explicitly with `;`.

A value-producing block arm may contain arbitrary statements, but every reachable normal completion path must explicitly produce an ARM_RESULT with `return <value>;`. Falling out of the block or relying on the final expression is invalid.

This rule does not make indentation semantic.

## AOT-safe Elixir-inspired features

### Typed `with`

A `with` construct is admitted only when it lowers completely to typed pattern tests, branches, and ordinary values before backend code generation. It introduces no runtime pattern interpreter.

Example target surface:

```ores
fnc checkout(UserId id) -> Result<Receipt, Error> ::
    return with
        Ok(user) <- fetch_user(id);
        Ok(account) <- fetch_account(user);
        Ok(receipt) <- charge(account);
    over
        return Ok(receipt);
    end
end
```

The exact failure-propagation syntax may evolve, but all patterns, result types, effects, and ownership transfers must be statically checked.

### Comprehensions

Comprehensions lower to ordinary statically selected iteration primitives. The iterable's runtime length may vary; the executable loop implementation may not.

```ores
let Array<int> squares =
    for n in values
        when n > 0
        yield n * n;
    end
```

For dense/inverted data, the compiler may lower directly to AoS/SoA/AoSoA/SoAoS accessors without materializing temporary logical objects.

A CPU/GPU comprehension is AOT-safe only when the selected kernel/code path is emitted ahead of time. Runtime shader/kernel source compilation is not part of the normal language profile.

### Traits / protocols

Elixir-style protocol ergonomics map to Oreslang traits and contracts.

Permitted lowering strategies are:

- monomorphized direct calls;
- statically generated witness/vtable objects;
- closed tagged dispatch over a statically known finite set.

A runtime registry that discovers an implementation from a newly synthesized runtime type is forbidden.

### Struct updates and typed paths

Checked update syntax and typed access paths must resolve to statically known fields/accessors/layout operations.

A logical path may be compiled differently for AoS versus SoA, but runtime reflection over field names is not required or permitted for the normal profile.

### Sigils / typed literals

A sigil is compile-time syntax processing.

Examples of intended categories include regex, URL, JSON schema, SQL, binary formats, and other typed literals.

A sigil implementation may emit ordinary constants, generated declarations, static automata, tables, or checked IR. It may not defer source parsing or code compilation to application runtime.

### Aliases and selective imports

Aliases/imports are lexical compile-time namespace operations. They have no runtime representation and cannot depend on runtime module discovery.

### Existing-value pattern matching

Oreslang should support an explicit way to match an existing binding rather than introduce a new pattern binding. Whatever surface token is selected, the decision is resolved statically and introduces no runtime environment lookup beyond reading the already compiled local value.

### Actor contracts / behaviours

Actor contracts are statically checked handler ABIs. They are especially useful for hot reload: a new actor generation may be admitted only when its compiled handler/state/effect ABI satisfies the required contract and upgrade rules.

Hot reload loads a fully compiled code generation. It is not a license for the running VM to compile source or macros.

## Compile-time evaluation

The normative `define macro` object model, hygiene, typed AST, phase, determinism, authority, resource, generic, and backend rules are specified in `MACRO_SEMANTICS_V1.md`. Those rules refine this closure contract and are mandatory for a backend claiming macro support.

Oreslang may support `comptime` evaluation and `define macro`, but both are compilation phases.

`comptime` computes compile-time values, types, dimensions, target decisions, generated constants, and layout parameters.

`define macro` transforms validated syntax into ordinary Oreslang syntax/AST.

After expansion, neither construct exists as an executable runtime feature.

### Compile-time authority

Compile-time execution is deny-by-default for ambient nondeterminism.

Without an explicit build-input mechanism, compile-time code may not read:

- the network;
- wall-clock time;
- process-global random state;
- undeclared environment variables;
- arbitrary host files;
- mutable external services.

A future explicit build-input/embed facility may admit file/resource inputs only when the compiler/build graph records their identity/content hash so cache keys and reproducibility remain correct.

Compile-time code cannot mint runtime ownership, actor-state, FFI, filesystem, network, supervisor, or raw-pointer authority. Generated code is checked exactly as handwritten code.

### Hygiene

Macro-generated identifiers must be hygienic unless the macro uses an explicit, checked capture/export operation. Macro expansion cannot bypass visibility, private namespace boundaries, effect declarations, ownership checks, actor isolation, or capability checks.

### Resource bounds

Compile-time execution must be resource-bounded. Nontermination, recursion/resource exhaustion, or expansion blowup is a compile error. A compiler may expose deterministic resource limits; exceeding them does not fall back to runtime execution.

## Generics and finite closure

Generics may generate code, but the AOT graph must remain finite.

Permitted strategies include:

- monomorphization of reachable concrete instantiations;
- explicit specialization;
- shape sharing where ABI/ownership semantics are identical;
- static witness passing for bounded polymorphism.

Runtime creation of a new generic type instantiation or runtime specialization/JIT is forbidden in the normal profile.

Recursive generic reachability that creates an unbounded specialization graph is a compile-time error.

## Reflection and metadata

Runtime reflection is not required for ordinary language semantics.

The compiler may emit closed metadata explicitly requested by a feature such as serialization, diagnostics, stack traces, or tooling. That metadata is a finite generated table, not a mechanism to discover arbitrary new types or executable implementations.

Generated serializers/deserializers are preferred over reflective field walking.

## Runtime-generated data versus runtime-generated code

Runtime generation of data is allowed:

- HTML;
- JSON;
- SQL strings;
- JavaScript text returned as content;
- templates;
- byte buffers;
- configuration-derived values.

The running OresVM may not treat those generated bytes/text as new executable Oreslang code under the normal profile.

Likewise, web tooling may emit JavaScript as build output or response data, but an Oreslang application does not require a runtime Oreslang JIT to do so.

## Hot reload

Hot reload remains compatible with full AOT:

1. compile the candidate source/macros/generics into a complete AOT image;
2. validate its ABI, state schema, effects, ownership contracts, permissions, and code identity;
3. stage the image as a new generation;
4. atomically route eligible new work;
5. drain/retire prior generations under the ordinary lifecycle contract.

No source compiler or macro expander needs to exist inside the production runtime image.

## Forbidden normal-profile mechanisms

The following are not admitted as hidden implementation techniques for the features above:

- `eval` of source strings;
- runtime AST execution;
- runtime macro expansion;
- runtime JIT compilation;
- runtime shader/kernel compilation required for correctness;
- runtime protocol implementation discovery from arbitrary type names;
- runtime type creation that changes executable dispatch;
- reflective field lookup required to implement ordinary struct/pattern semantics;
- dynamic module loading whose ABI/effects were not statically described and validated;
- arbitrary Elixir-style `use` code injection at runtime.

A backend may have its own JIT internally for already closed code where the platform profile permits it, but language semantics must not depend on runtime compilation and the same program must have a complete AOT lowering.

## Backend acceptance

A backend may claim an Elixir-inspired feature only when:

1. its parser/semantic checks consume the shared source contract;
2. macro/comptime expansion is complete before ordinary codegen;
3. the resulting program graph is finite;
4. unsupported dynamic cases fail before partial artifact emission;
5. AOT compilation emits all executable behavior required by the test;
6. the produced binary executes without a source compiler, macro engine, runtime type generator, or JIT dependency;
7. Java/Graal Native Image and LLVM native execution prove the same observable source semantics before cross-backend parity is claimed.

Wasm/.NET/JS/Forge consumers must either implement the same closed semantics or reject unsupported cases explicitly.
