# Full-AOT metaprogramming v1: generics, comptime and hygienic macros

> **Status: proposed shared language contract.**
>
> This document specifies the intended cross-backend semantics for Oreslang
> metaprogramming. It does **not** claim that Java/GraalVM, LLVM, Wasm, .NET,
> Forge, or any other backend currently implements these features. Unsupported
> features must remain fail-closed until executable conformance exists.

## 1. Design principle

Oreslang metaprogramming is staged and closed-world by default:

> **Generics describe what can be generated. Macros describe how to generate
> it. `comptime` chooses values and structure during compilation. The compiler
> verifies every generated declaration before it can become executable code.**

The baseline language profile is strict AOT. A conforming strict-AOT artifact:

- requires no runtime macro engine;
- requires no runtime Oreslang compiler or JIT;
- never synthesizes new nominal types at runtime;
- never dynamically instantiates a generic type that was absent from the
  build-time closure;
- may carry statically generated type descriptors, trait witnesses, schema
  metadata and dispatch tables at runtime;
- may share one machine-code body between multiple semantic generic
  instantiations when doing so preserves all language semantics.

Runtime compilation is a separate, optional runtime capability. It is not part
of the macro system and must not be required by any strict-AOT program.

## 2. Staging model

The shared semantic pipeline is:

1. **Parse and collect declarations.**
   Record imports, generic parameters, macro declarations, annotations, source
   spans and lexical identities. Parsing does not execute guest code.
2. **Expand syntax macros.**
   Run hygienic, syntax-only transformations under deterministic resource
   budgets. Syntax macros do not receive arbitrary resolved compiler state.
3. **Resolve names, nominal identities and generic constraints.**
   Resolve imports, `where` bounds, associated types, const parameters,
   visibility and preliminary effect/ownership obligations.
4. **Run typed generation.**
   Run derive macros and explicitly typed procedural macros against immutable,
   visibility-filtered type metadata.
5. **Re-admit generated declarations.**
   Generated syntax is not trusted IR. Resolve and verify generated
   declarations exactly like handwritten source.
6. **Run complete semantic verification.**
   Type, effect, ownership, borrow, capability, actor-isolation, visibility,
   exhaustiveness and backend-profile checks must all pass.
7. **Resolve reachable generic instances and specialization.**
   Monomorphize where needed, share implementations where safe, and reject
   unbounded recursive instantiation.
8. **Lower verified typed HIR/OresIR.**
   Retain generic identities, macro provenance, source mappings and semantic
   obligations required by later verification.
9. **Close and emit the AOT artifact.**
   Perform reachability, descriptor/witness emission, deduplication, ABI
   validation, manifest generation and backend linking.

A frontend or backend may internally combine stages, but it must preserve the
same observable admission and execution semantics.

## 3. Three distinct mechanisms

Oreslang should not collapse all metaprogramming into one template language.

### 3.1 Generics

Generics parameterize declarations and express a family of statically valid
programs.

P0 requirements:

- type parameters;
- `where` trait bounds and multiple bounds;
- associated types;
- const generic parameters;
- deterministic inference and defaults;
- static trait witnesses;
- coherent specialization selection;
- effect, ownership and capability obligations propagated through witnesses.

Illustrative source:

```ores
define pub trait Encoder<T> as
    fnc encode(T value) -> Array<byte>;
end

pub fnc serialize<T, E>(T value, E encoder) -> Array<byte>
where
    T: Sendable,
    E: Encoder<T>
{
    return encoder.encode(value);
}
```

A strict-AOT build resolves the witness statically. It must not perform
runtime method-name lookup to decide which `Encoder<T>` implementation applies.

### 3.2 `comptime`

`comptime` evaluates compile-time-only decisions and bounded structural
operations. It is not ordinary runtime control flow and it is not merely an
optimizer hint.

```ores
comptime if N <= 8 then
    comptime for i in 0..N {
        // structurally generated operation
    }
else
    for i in 0..N {
        // ordinary runtime loop with a statically known bound
    }
fi
```

For `comptime if`, only the selected branch belongs to the instantiated
program. For an ordinary `if`, both branches are source-level program
branches even when constant folding later removes one.

For `comptime for`, the iteration count is a compile-time structural
generation request and is subject to expansion budgets.

The ordinary top-level `const` evaluator remains narrower. In particular,
the compile-time constant contract may reject arbitrary ordinary `fnc` calls
even when a broader macro/comptime host eventually admits explicitly marked
compile-time functions. Import must remain metadata-only and must not execute
guest initialization.

### 3.3 Macros

Macros generate syntax or declarations. Macro output never bypasses semantic
verification.

The v1 model has two explicit phases:

- **syntax macros** operate on syntax fragments before ordinary type resolution;
- **typed macros** operate after resolution on immutable compiler-owned metadata.

Derive macros are typed macros invoked by declaration annotations.

Exact grammar remains subject to parser/formatter review, but the intended
source shape is:

```ores
@derive(Debug, Equality, Codec<#json>)
define pub struct User as
    int id;
    String name;
    bool active;
end
```

and, for an explicitly typed generator:

```ores
define typed macro generate_debug<T: type>() -> declarations as
    comptime for field in meta.fields(T) {
        emit quote {
            // emit verified syntax using typed syntax interpolation
        };
    }
end
```

A syntax macro uses the same `quote` family but receives syntax objects rather
than resolved `TypeMeta<T>`.

## 4. Syntax objects and hygiene

Macros operate on structured syntax, never on unchecked source-string
substitution as the primary mechanism.

The compiler should expose versioned, bounded concepts such as:

- `SyntaxExpr`;
- `SyntaxType`;
- `SyntaxDecl`;
- `SyntaxIdent`;
- `TypeMeta<T>`;
- `FieldMeta<T>`;
- `MethodMeta<T>`;
- `DeclEmitter`;
- `DiagnosticEmitter`.

Generated identifiers receive a fresh hygienic syntax context by default.
Spliced caller syntax retains its caller context. Accidental capture is a
compile-time error or is made impossible by construction.

Intentional generation of a public declaration name is allowed, because the
macro is explicitly contributing a declaration. Intentional capture of an
existing caller-local binding is not part of v1. If a future escape hatch is
added, it must be explicit, visibility-checked and auditable.

Macro APIs must not expose mutable compiler internals. Metadata views are
immutable and filtered by the same visibility/module rules that govern source
programs.

## 5. Generated code is untrusted until verified

Macro output is **not** typed OresIR merely because it came from a typed macro.

The compiler should distinguish at least:

- parsed syntax;
- resolved/generated syntax;
- verified typed HIR/OresIR.

Every generated declaration must pass the same checks as handwritten code:

- type checking;
- effect checking;
- ownership and move checking;
- borrow checking;
- actor lexical isolation;
- actor state-loan and `critical` rules;
- capability admission;
- visibility/privacy;
- trait/interface conformance;
- exhaustiveness;
- backend/profile restrictions.

A macro cannot manufacture an `ActorRef`, pointer, capability, borrow,
descriptor, witness or private-member access that ordinary source could not
obtain.

**Representation is never authority.** Layout-generating macros may change
AoS/SoA/AoSoA/SoAoS representation, but must not confer pointer access, widen
capabilities or allow actor-private data to escape.

## 6. Deterministic compile-time host

Macro/comptime execution is deterministic and resource-bounded.

Forbidden ambient operations include:

- network access;
- arbitrary filesystem access;
- environment variables or credentials;
- wall clock;
- nondeterministic randomness;
- process execution;
- unrestricted host FFI;
- spawning guest actors;
- mutable shared compiler-global state.

A compiler may permit declared read-only build inputs in a future contract, but
they must be explicit dependencies included in reproducible cache keys. They
must never be implicit ambient filesystem reads.

Required budgets include:

- expansion depth;
- generated node/declaration count;
- comptime steps/reductions;
- memory/serialized output size;
- recursion depth;
- diagnostic volume.

Budget exhaustion is a deterministic compiler diagnostic, not a crash,
timeout-as-success or partial expansion.

A restricted WebAssembly component is a plausible build-host implementation,
but the language contract does not require WebAssembly. Any implementation is
acceptable if it satisfies the same sandbox, determinism, versioning and
resource-limit semantics.

## 7. Generic identity and specialization

Full AOT does not require one machine-code body per semantic generic instance.

The compiler must keep these identities distinct:

### `GenericInstanceId`

Semantic identity of a resolved generic instantiation. It includes normalized
module/declaration identity, type arguments, const arguments, relevant
ownership/effect/capability parameters and language-level generic semantics.

### `SpecializationId`

Identity of a chosen specialization strategy after coherent selection. It
records why a specialization applies and the target assumptions that affect
that decision.

### `CodeBodyId`

Backend emission identity. Multiple `GenericInstanceId` values may legally map
to one `CodeBodyId` when sharing preserves all semantic obligations.

Example:

```text
foo<int>  ──┐
            ├── one backend code body, if representation and semantics permit
foo<uint> ──┘
```

The semantic type descriptors remain distinct even when code is shared.

Overlapping specialization must use explicit coherence rules. Source order must
not select a winner. Ambiguous or recursively unbounded specialization is a
compile-time error.

## 8. Generated declaration identity and hot reload

Generated declarations need deterministic provenance and identity independent
of absolute filesystem paths and incidental line-number changes.

A generated declaration identity should incorporate, as applicable:

- source module/package identity;
- originating declaration semantic identity;
- macro package identity and semantic version/digest;
- macro definition identity;
- invocation identity;
- normalized macro inputs;
- normalized generic and const arguments;
- schema/protocol version when semantically relevant;
- compiler contract version.

Runtime type descriptors additionally carry or reference the active code
generation/hot-reload epoch where required by the runtime type contract.

A new hot-reload generation may contain new AOT-generated specializations.
Already running actors remain bound to their existing generation until migrated
or drained. Migration cannot silently equate incompatible generated state or
wire schemas.

## 9. Macro provenance and diagnostics

Every generated node must retain enough provenance to explain its origin:

- invocation source span;
- macro definition identity;
- expansion stack;
- originating syntax/declaration;
- generated declaration identity;
- normalized macro input digest.

Diagnostics should point first to the user invocation and then expose generated
frames on demand.

Developer tooling should include:

```text
oreslang build --emit-expanded
oreslang build --emit-specializations
oreslang build --explain-macro
oreslang build --check-aot
oreslang build --comptime-trace
```

`--check-aot` should prove closure rather than merely report that a host
runtime was itself compiled AOT. Its report should include at least:

- reachable semantic generic instances;
- emitted/shared machine-code bodies;
- required runtime descriptors/witnesses;
- unresolved reflection roots;
- dynamic nominal-type construction requirements;
- runtime compiler/JIT dependencies;
- unsupported backend/profile requirements.

## 10. Reflection and metadata

Compile-time metadata is not unrestricted runtime reflection.

Typed macros may inspect visibility-filtered, immutable metadata such as:

- declaration name/kind;
- generic parameters and resolved arguments;
- fields and methods;
- annotations;
- traits/interfaces;
- ownership/effect/capability facts;
- source-level representation attributes.

Target-dependent physical layout is exposed only after the target layout phase
and only through a distinct target-layout API. A source-level `TypeMeta<T>`
must not accidentally expose backend pointer/object layout as language
semantics.

At runtime, reachable values may carry precomputed descriptors and witnesses.
That does not authorize synthesis of new nominal types or new generic
instantiations.

## 11. Strict-AOT and dynamic-runtime profiles

### Strict AOT baseline

Required properties:

- all macro execution completed before application artifact emission;
- all reachable generic instances resolved;
- all required descriptors/witnesses emitted;
- no runtime Oreslang source compilation;
- no runtime nominal-type synthesis;
- no runtime compiler plugin loading required by language semantics;
- unsupported dynamic-compilation operations fail explicitly.

### Optional dynamic-compilation capability

A hosted runtime may separately expose a capability-gated compiler API such as
`Compiler.compile(...)`. That facility:

- is not a macro;
- is not required for strict AOT;
- does not inherit ambient authority from the calling actor;
- must re-run ordinary Oreslang semantic verification;
- must give generated code only explicitly delegated capabilities;
- may be unavailable on Native Image, Wasm or other profiles;
- must fail closed when unavailable.

Dynamic actors/modules should preferentially enter through normal actor/module
boundaries so ownership, lifecycle and capability isolation remain explicit.

## 12. Const generics and layout-aware programming

Const generics are P0 because they support dimensions, capacities, exact array
lengths, packet layouts and storage strategy without a separate template
language.

Illustrative source:

```ores
define struct Vector<T, const N: int>
where T: Number + Copy, N > 0
as
    Array<T, N> data;
end
```

For layout-aware containers:

```ores
define struct Table<T, const Layout: StorageLayout> as
    // representation selected/generated at compile time
end
```

A layout strategy may generate accessors and physical storage, but every
conversion must preserve ownership and capability class. An actor-private
buffer remains actor-private after layout transformation.

## 13. Interaction with effects and actors

Generic constraints are not limited to nominal traits. The resolved generic
obligation set must be able to carry language facts such as:

- `Sendable`/shareability requirements;
- copy/move/borrow obligations;
- callable effects;
- suspension requirements;
- capability requirements;
- actor-safe admission.

A generic witness cannot erase effects or capabilities.

Generated actors are ordinary actors for all semantic purposes. They receive no
special access to:

- caller lexical state;
- another actor's private heap;
- supervisor CONTROL channels;
- native handles;
- FFI;
- filesystem/network capabilities;
- raw process memory.

Generated actor message schemas must be versioned and must participate in the
same descriptor, serialization and hot-reload compatibility rules as
handwritten schemas.

## 14. Dependency cycles and fixed points

Macro dependencies are explicit and deterministic.

A typed macro cannot require a fully resolved type whose existence depends on
that same macro invocation.

The compiler may use a dependency-aware fixed point for independent generated
declarations, but it must reject cycles that require circular semantic
knowledge.

Examples of invalid cycles:

- macro A needs `TypeMeta<X>` to run, but A is the invocation that creates X;
- derive A generates implementation B only if B already resolves;
- specialization S recursively requires a strictly new specialization S' with
  no finite structural descent.

Cycle diagnostics must identify the relevant dependency path.

## 15. Incremental compilation and cache keys

A macro-generated artifact is invalidated when any semantic input changes,
including:

- macro implementation/package digest;
- macro API version;
- normalized invocation arguments;
- relevant source/type metadata;
- generic/const arguments;
- imported compile-time constants;
- compiler semantic-contract version;
- enabled language features;
- target ABI/layout assumptions when the expansion depends on them.

Cache hits must not skip ownership, effect, capability or actor-isolation
obligations. A cache stores verified results under a semantic key; it does not
turn previously generated code into trusted input for a different context.

## 16. P0/P1/P2 scope

### P0

- shared staging/identity/AOT contract;
- `where` bounds and static witnesses;
- associated types;
- const generics;
- bounded constant evaluation;
- deterministic generic instance/specialization identity;
- specialization budgets and recursion rejection;
- descriptor compatibility with strict AOT.

### P1

- hygienic syntax macros;
- typed macros and `@derive`;
- bounded macro host;
- generated-code provenance;
- full semantic re-admission;
- `comptime if` and bounded `comptime for`;
- strict-AOT macro package build/link path;
- cross-backend generated-code fixture corpus.

### P2

- higher-kinded generics;
- GADTs/typestate refinements beyond the bounded existing proposals;
- richer type-level arithmetic/dimensions;
- explicit compile-time build-input capabilities if justified.

P2 work must not delay P0/P1.

## 17. First executable demonstrator

The first vertical slice should intentionally prove the architecture rather than
maximize feature count.

### Source behavior

1. Define a const-generic data structure.
2. Define a nominal record/struct with fields.
3. Apply `@derive(Codec<#json>)`.
4. Generate concrete encode/decode declarations from immutable type metadata.
5. Run generated declarations through type/effect/ownership checks.
6. Resolve reachable generic instances and record specialization identities.
7. Emit a strict-AOT artifact.
8. Execute the same supported fixture through:
   - Java/Graal guest AOT;
   - LLVM native AOT.
9. Compare result/diagnostic behavior and semantic artifact digests.

### Required negative controls

- unhygienic local capture attempt;
- macro access to network/filesystem/environment;
- macro expansion budget exhaustion;
- recursive macro expansion;
- typed macro dependency cycle;
- generated private-member bypass;
- generated borrow/move violation;
- generated actor-private state escape;
- generated capability escalation;
- forged generic descriptor/witness;
- ambiguous specialization;
- unbounded recursive specialization;
- strict-AOT source requiring runtime compilation;
- backend that cannot lower the admitted feature must reject rather than
  silently change semantics.

Infrastructure failures, zero-step CI, parser-only admission and source-free
reference models are reported separately from executable guest evidence.

## 18. Existing work this contract extends

This proposal should extend, not replace, existing tracked work:

- common-source issue #2: versioned deterministic typed HIR, generic IDs, source
  spans and macro provenance;
- common-source issue #23: deterministic compile-time constants without
  import-time execution;
- Java issue #848: fully reified Oreslang generic descriptors;
- Java issue #926: deterministic specialization identities and budgets;
- Java issue #1683: structured `where` trait bounds and static witnesses;
- Java issue #171: true guest AOT with no runtime nominal-type synthesis;
- Java issue #1392: later typestate/GADT/dimension-type work;
- common-source generic-scalar conformance corpus: executable baseline for
  cross-backend generic behavior.

This document does not change the rule that Java/GraalVM and LLVM remain
independent compiler implementations until shared components are separately
proven and adopted.

## 19. Canonical outcome

The intended model is:

```text
source
  │
  ├─ generics / traits / const generics
  │             │
  │             ▼
  │       constraint solving
  │
  ├─ syntax macros ────────┐
  │                        │
  ▼                        │
resolved types             │
  │                        │
  ├─ typed derives/macros ◄┘
  │
  ▼
generated declarations
  │
  ▼
full semantic verification
  │
  ▼
reachable specialization
  │
  ├─ specialize code
  └─ share code when safe
  │
  ▼
verified typed HIR/OresIR
  │
  ▼
AOT closure + descriptors + ABI validation
  │
  ├─ LLVM/native
  ├─ Graal/Java
  └─ Wasm/.NET/JS where supported
```

The core invariant is simple:

> **No metaprogramming feature is an escape hatch around Oreslang semantics.
> Generated code becomes executable only after the same verification that
> applies to handwritten code.**
