# `define macro` semantics v1

Status: shared language contract.

This document defines the semantic contract for Oreslang `define macro`. A macro is a compile-time declaration kind. It is not a runtime function, runtime value, reflection hook, JIT entry point, or source-string evaluator.

The full-AOT closure contract in `AOT_LANGUAGE_CLOSURE_V1.md` remains authoritative. This document makes the macro portion precise enough for parser, semantic, caching, diagnostics, security, and cross-backend conformance work.

## Core invariant

A successful macro invocation transforms finite, validated compiler inputs into finite, hygienic Oreslang syntax/AST before ordinary backend code generation.

After expansion:

- no macro declaration or invocation is required by executable IR;
- generated code is indistinguishable from handwritten code for type, effect, ownership, visibility, actor-isolation, capability, AOT-closure, and ABI validation;
- the runtime image does not contain a macro evaluator merely to preserve program semantics.

A backend must reject a program before runnable artifact emission if it cannot complete macro expansion and ordinary semantic validation ahead of time.

## Declaration kind

`macro` is a distinct compile-time declaration kind.

The declaration head is:

```text
define [pub] macro <name>(<macro-parameters>) -> <macro-result-kind> ...
```

The exact body delimiter follows the ordinary callable-body grammar. The result kind is mandatory in v1.

Macros are private by default. `define pub macro` makes the macro importable as compile-time API; it does not create a runtime symbol.

Macro declarations live in a compile-time macro namespace. They are not overload candidates for ordinary runtime calls and cannot be stored in variables, actor state, messages, containers, FFI values, traits, or runtime reflection metadata.

A package may distribute a public macro as content-addressed compiler metadata/IR. That metadata is a build-time dependency only. A macro change invalidates dependent compilation caches.

### Canonical public-macro content identity

Public macro implementation content participates in compile-time ABI/cache
identity through the bounded backend-neutral format
`ores-macro-content-v1`, bound to macro semantics ABI
`ores-macro-semantics-v1`. It is a typed-AST encoding, not source text,
source locations, host reflection, object identity, or a language-runtime
`toString` representation.

Free-form strings are length-prefixed by **UTF-8 byte count**. Floating
literals use raw IEEE-754 bits so values such as `+0.0` and `-0.0` remain
distinct. Parameter names, parameter/result kinds, type structure, call origin,
object kind, and admitted evaluator/resource profiles participate. Pure source
whitespace does not.

The initial encoder admits at most 4,096 AST/type nodes, depth 128, and
1,048,576 encoded UTF-8 bytes. Oversized or unsupported public macro content
fails closed instead of falling back to host formatting.

A cryptographic digest of this canonical stream may be used for incremental
cache invalidation, but the digest is **cache identity only**. It never grants
identifier equality, hygiene equality, checked capture, visibility, or any
other semantic authority. Changing the canonical format version, macro
semantics ABI, or a bound resource profile invalidates affected public
compile-time artifacts.

## Compiler-only macro types

The compiler exposes a closed set of compiler-only meta types. They never enter runtime ABI or user data layouts.

Required v1 categories are:

- `Type`: a resolved compile-time type identity or bounded type variable;
- `Const<T>`: an immutable compile-time value whose type is itself compile-time serializable;
- `Identifier`: a hygienic compiler identifier, not an arbitrary source string;
- `Syntax<Expr>`;
- `Syntax<Stmt>`;
- `Syntax<Decl>`;
- `Syntax<Type>`;
- `Syntax<Pattern>`;
- `SyntaxList<Decl>`.

A macro result kind must be one of the syntax kinds admitted at its invocation position. A declaration-producing macro cannot be used in expression position, and an expression-producing macro cannot be spliced as a declaration.

`void` macro results are not admitted in v1. A macro that intentionally generates no declarations returns an empty `SyntaxList<Decl>`.

Raw token streams and source strings are not macro syntax values in v1. Text may be generated as ordinary data, but turning generated text back into executable Oreslang source is forbidden.

## Inputs

A macro parameter may accept only compiler-known inputs:

- a resolved `Type`;
- a `Const<T>` value;
- a hygienic `Identifier`;
- a typed `Syntax<K>` node.

The compiler AST must enforce the same `Const<T>` value-type invariant as the
source parser. Programmatic AST construction cannot smuggle compiler meta-types,
inferred generic holes, or runtime borrow capabilities inside `Const<T>`.
This validation is itself bounded and fail-closed.

A macro cannot receive a runtime object, actor reference, file/socket handle, pointer, capability, borrow, mutable global, task/future, or other runtime authority.

A `Type` argument exposes only compile-time metadata visible to the invocation scope. Type inspection must obey normal privacy and actor-state boundaries. Physical addresses, raw field offsets, raw pointers, and backend object handles are not part of `Type` inspection.

Type/layout inspection is **compiler introspection**, not runtime reflection. A spelling such as `reflect.layout(T)`, if provided, is a compile-time intrinsic only: it must fully evaluate before AOT code generation, may return only finite abstract layout facts needed for checked lowering, and may not require a reflection engine or type-discovery runtime in the produced binary. It must not grant raw-pointer authority, expose process addresses, or make actor-private storage externally observable. Backends emit only the resulting closed layouts/constants/accessors.

For generic type variables, a macro may inspect only facts known from the declaration and satisfied bounds. It cannot defer semantic decisions to runtime in order to learn a concrete type later.

## Invocation surface

The canonical v1 invocation spelling is explicit and cannot be confused with an ordinary runtime call:

```ores
derive_codec!(type User);
let int answer = literal!(const 42);
```

Macro arguments state their compiler category at the call site:

```text
type <TypeRef>
const <closed compile-time expression>
ident <call-site identifier>
syntax expr <expression>
syntax stmt { <single statement> }
syntax type <TypeRef>
syntax pattern <pattern>
syntax decl { <declaration> }   // reserved until hygienic declaration quotation is implemented
```

The `ident` form supplies a hygienic compiler identifier plus call-site provenance. It does **not** by itself capture, alias, or grant access to a caller binding. If a macro intentionally needs an existing call-site binding, its body must use the separate explicit checked-capture operation described under Hygiene. That operation resolves the exact declaration/local identity and expected declaration kind, enforces visibility/privacy, and records the resolved identity in provenance.

`name!(...)` in declaration position requires `Syntax<Decl>` or `SyntaxList<Decl>`. In expression position it requires `Syntax<Expr>`. Other result/context combinations are rejected before expansion. Statement/type/pattern invocation positions may be added only with equally explicit typed AST nodes; they must not be inferred by reparsing generated text.

Qualified macro lookup obeys normal compile-time visibility. A private macro may be referenced only from its owning module/container; qualification never bypasses privacy. A public macro may cross its declared compile-time API boundary through the ordinary compile-time import/qualification rules.

Closed `Const<T>` type metadata also has deterministic admission limits: type
matching visits at most **512 type nodes** at depth at most **64**, using a
bounded worklist rather than recursive structural comparison. Diagnostic
rendering is independently bounded to 16 nested levels, 128 visited nodes,
16 children per type, and 1,024 characters before a truncation marker.
Types exceeding the admission budget are rejected rather than recursing
indefinitely or printing unbounded compiler diagnostics. These limits do not
alter the normal equivalence of `boolean` and `bool`.

A `const` argument is never permission to evaluate runtime source early. The compiler must prove both that the expression is closed/side-effect-free **and** that its compile-time value has the declared `Const<T>` type. If either proof is unavailable, compilation rejects the invocation rather than calling runtime code, host functions, reflection, I/O, or JIT machinery.

## Typed AST generation

Macro output is typed compiler AST, not text substitution.

Quasiquote/unquote constructs compiler-only `Syntax<K>` values and preserves
hygiene/provenance. It must never be implemented as parse-a-generated-string.

The initial executable expression-template subset uses direct compiler forms:

```
define macro twice(Syntax<Expr> value) -> Syntax<Expr> {
    return quote(unquote(value) + unquote(value));
}
```

For this subset, `quote(template)` may construct only identifier-free expression
structure: literals, admitted unary/binary/conditional structure, finite
list/tuple/closed aggregate literals, and direct `unquote(parameter)` slots.
Each unquoted parameter must be a declared `Syntax<Expr>` compiler value.
`unquote` is a structural splice, not textual substitution.

Template validation is itself bounded (v1: depth at most 64, 2,048 template nodes) and
must not erase an admitted syntax parameter before ordinary semantic checking.
A parameter used more than once may be duplicated only when the call-site
syntax is a trivial `NameExpr` or literal. Repeated unquote of a nontrivial
expression is rejected before expansion because it could duplicate effects,
actor-state access, or ownership transfers such as `rt take`. Template
expansion never mints additional ownership authority.

Even for an admitted duplicated trivial splice, every emitted source occurrence
must have a distinct compiler AST identity. A template must not alias one
identity-keyed `Expr` object into multiple output positions; provenance and
later compiler side tables operate per occurrence.

Until generated-identifier hygiene and checked capture are implemented, a
template may not introduce a `NameExpr`, call target, member path, constructor
name, runtime intrinsic, macro name, actor/task handle, or other identifier-bearing
authority. Caller identifiers may appear only by arriving inside an unquoted
caller-owned `Syntax<Expr>` subtree.

Both `quote` and `unquote` are contextual compiler intrinsics inside macro
scope and cannot be rebound there. Outside macro scope those spellings remain
ordinary runtime identifiers. Only direct-call-origin `quote(...)` and
`unquote(...)` are compiler intrinsics; pipeline/member/call rewriting must
not be reclassified as quotation.

Every emitted node has:

- a syntax kind;
- a source/provenance chain;
- a hygiene scope/mark;
- a stable compiler identity for caching and diagnostics.

Successful expansion publishes provenance only after the complete emitted
subtree has been produced. Failed or partial expansion must not publish
provenance for nodes that are not committed. Call-site syntax splices and
compiler-evaluated constant quotation remain distinguishable in compiler-only
origin metadata; that metadata is diagnostic/build-time state, not runtime
authority or ABI.

Malformed AST, context-incompatible AST, or AST that attempts to embed a compiler/runtime capability is rejected before ordinary semantic checking.

### Closed constant quotation and staged runtime expressions

The compiler-only quote intrinsic may turn a **proven compile-time
constant** into closed `Syntax<Expr>`. Scalar constants become literal nodes;
admitted immutable list/tuple/record constants become closed aggregate syntax
whose children are themselves evaluated constant syntax. This is not parsing
text, executing guest code at runtime, or bypassing ordinary semantic checks:

    define macro literal(Const<int> value) -> Syntax<Expr> {
        return quote(value);
    }

    fnc answer() -> int {
        return literal!(const 42);
    }

The generated executable function contains the ordinary literal expression
42 and no macro invocation. A bounded closed expression such as
`const (40 + 2)` may therefore evaluate to the same literal before quotation.
Evaluation must use guest-compatible numeric semantics: for example, `4 / 2`
has compile-time type `float`, not `int`, because ordinary Oreslang division
produces a floating result. The `quote` intrinsic is valid only in a
compile-time macro body; emitting a runtime call to `quote` is not a valid
fallback. Within a macro declaration, the intrinsic name `quote` is reserved
and cannot be reused as a macro parameter/local binding whose resolution would
make quotation ambiguous. This reservation does not require `quote` to become
a global runtime keyword outside compile-time macro scope.

The quotation intrinsic is recognized only in its direct compiler form `quote(value)`. Pipeline/member/call rewriting such as `value |> quote()` must not be reclassified as the intrinsic merely because it normalizes to a similar call shape.

The compiler must verify constant type, value, canonical encoding,
and exact literal semantics before publication. A conforming bounded evaluator
may reduce closed constant expressions before quotation, but that evaluator is
still compiler-only and deny-by-default.

The initial deterministic evaluator profile admits only finite, closed AST:
primitive literals; unary numeric/boolean/bitwise operations; finite arithmetic,
comparison, equality, boolean and shift operations; conditionals whose complete
branch set is closed and type-consistent; and finite list/tuple/closed-record or
closed-struct literals whose children satisfy the same rules. Names, calls,
runtime intrinsics, actors, tasks/futures, handles, reflection, FFI, I/O,
environment, time, randomness and generated-source parsing are not evaluator
inputs.

Evaluation is budgeted independently of runtime execution. The profile must
bound at least AST steps, recursion depth, aggregate element count, individual
string size, and estimated compile-time memory. Budget exhaustion is a compile
error and never enables a runtime/JIT fallback.

Comptime integer arithmetic is checked: overflow is a compile error rather than
wrapping. This is an intentional compile-time semantic guard, not permission to
change runtime integer semantics. The v1 recursion-depth limit is inclusive:
depth 64 is admitted and depth 65 is rejected.

Non-finite floating results are rejected by the cross-backend deterministic
profile, including literal floats embedded directly in a typed quote template,
unless a future semantics version defines a canonical representation shared by
every backend.

The evaluated value must still match its declared `Const<T>` exactly and the
emitted `Syntax<Expr>` must re-enter ordinary type/effect/ownership/capability
checks. Expected-type-directed evaluation is permitted only where the declared
`Const<T>` supplies otherwise-missing closed information. In const-v1 this
includes the empty list: `Const<List<int>>` may admit `const []` because the
element type is supplied by the declared expected type. An empty list without
an exact closed `List<Element>` expectation remains rejected.

Unsupported values fail closed without silently reinterpreting an unevaluated
expression as a constant.

Quoting a Const<T> value is not a general syntax-tree constructor.
General quasiquotation/unquotation must use typed Syntax<K> nodes with
explicit hygiene and provenance. In particular, quotation cannot grant
caller-binding capture, export authority, access to private actor fields, or
permission to generate unbounded new generic instantiations.

### Compile-time generation versus runtime behavior

A macro expands at **build time** and may produce a function that accepts
ordinary **runtime** inputs. For example, a UI view macro may generate
precompiled rendering/reactivity operations; invoking those operations may
create and update DOM nodes or produce HTML dynamically. That does not mean the
macro runs at runtime, and it does not require generating or compiling new
JavaScript or Oreslang source during execution.

A runtime renderer may produce HTML, JSON, byte buffers, SQL queries, and
even source **text as data**, subject to ordinary escaping, injection,
capability and trust constraints. Any execution of such text by another
language/runtime is outside this macro contract and must not be silently
promoted into trusted Oreslang executable behavior. A normal Oreslang web build
may emit precompiled JavaScript/Wasm artifacts; browser engine machine-code JIT
is not evidence of runtime Oreslang macro expansion.

The normal full-AOT profile rejects source-string eval, runtime macro
invocations, dynamic nominal type synthesis, and runtime generation of a new
Oreslang executable behavior. Explicit hosted compiler capabilities, if ever
added, are a separate opt-in profile.

## Hygiene

Generated identifiers are hygienic by default.

Hygiene identity is exact compiler identity, not merely a spelling or truncated hash. It includes the canonical source-unit identity in addition to caller module, macro owner/declaration identity, invocation site, and deterministic expansion ordinal. Two separately compiled source units in the same module must not become the same hygiene scope merely because line/column and local ordinals repeat. A compiler may hash a canonical identity for caches/serialization, but a hash collision must never make two hygiene scopes equal, grant capture, or change name resolution. The executable/native artifact does not need a runtime hygiene table after expansion.

File-backed source-unit identities are **logical relative paths**, normalized
independently of the host OS: backslashes become forward slashes, repeated and
`.` segments collapse, and `..` may remove only an existing logical segment.
Absolute paths and any parent escape above the logical root are rejected.
Consequently `pkg\\tmp\\..\\unit.ores` and
`pkg/tmp/../unit.ores` denote the same hygiene unit on every backend, without
embedding a developer workspace path. Direct in-memory compilation uses the
explicit `<memory>` unit. One parsed program cannot be rebound to a different
canonical unit identity. The initial limits are 4,096 characters for a
source-unit id and 1,024 characters for an `Identifier` argument/hygiene
hint.

Fresh generated identifiers use a lossless encoding of the canonical source-unit
identity plus deterministic per-expansion/local ordinals as compiler-internal
handles. This encoding is not a hash. Equality/capture authority is still the
exact hygiene metadata, not the textual internal handle. Source code cannot
spell the compiler-internal generated-name prefix.

A generated identifier with the same spelling as a caller binding does not capture or overwrite that caller binding unless an explicit checked capture operation is used.

The first Java/Graal expression slice exposes two direct compiler intrinsics for
`Identifier` parameters:

- `hygienic(id)` creates a fresh compiler identifier associated with the
  invocation's exact hygiene identity. Its internal compiler spelling is
  source-unspellable and is not capture authority; the caller-provided spelling
  is retained only as a diagnostic hint.
- `capture_fnc(id)` explicitly requests one **public, ordinary,
  reifiable module-level `fnc`**. It resolves from the macro call-site module,
  verifies declaration kind/visibility/reifiability, and lowers the checked
  target to a source-unspellable, lossless internal module-qualified expression.
  Runtime/AOT execution therefore does not depend on the macro hygiene side
  table and a caller local with the same spelling cannot redirect the capture.

Both are contextual compiler intrinsics only inside a macro body, direct-call
origin only, and cannot be shadowed there. Outside macro scope, `hygienic` and
`capture_fnc` remain ordinary runtime identifiers.

For this first slice, `capture_fnc` does not capture locals, fields, methods,
imports, arbitrary values, types, actor functions, actors, handles, or
capabilities. The target must be exactly one public ordinary `fnc`; private
functions are closed even when macro owner and caller module are the same.
Overloaded families, routines, unspecialized generic functions, and suspending
functions are also closed because the current first-class function
representation cannot preserve those distinctions safely.

The lowered module reference uses a compiler-internal source-unspellable
spelling containing the module identity as lossless UTF-8 hex rather than by an
authority-bearing hash. **The encoded spelling alone is not authority.**
Semantic/type admission and capability admission must additionally require the
exact compiler identity minted by the successful `capture_fnc` lowering.
Programmatic AST construction of the same `$module$...` bytes without that
identity is rejected before execution. Generic AST rewriting must preserve the
checked-capture node identity rather than rebuilding it and silently discarding
its admission proof.

After semantic admission, runtime/AOT evaluation may decode the internal module
reference before local-variable lookup while still applying the normal actor
lexical namespace restrictions; runtime artifacts do not need the macro hygiene
table. Capability admission canonicalizes the authorized internal receiver back
to the real `Module.fn` path before referenced-function effect scanning, so
checked capture cannot launder restricted effects through an opaque compiler
name.

Explicit capture must:

1. name the requested binding through a compiler identifier operation, not string concatenation;
2. resolve from the macro call site;
3. state/validate the expected declaration kind;
4. obey visibility and private-container rules;
5. preserve the captured binding's identity in provenance.

A macro cannot capture a private binding across a module/package boundary merely because it knows its spelling.

Intentional stable names emitted into the surrounding declaration scope use an explicit checked expose-name operation and then participate in ordinary duplicate/coherence/export validation.

## Generated declarations and namespace safety

A declaration-producing macro may generate ordinary declarations in its expansion scope.

The first executable Java/Graal declaration slice is deliberately narrower than
the eventual v1 surface. It admits only a direct compiler intrinsic:

```ores
define macro make(
    Identifier name,
    Type result,
    Syntax<Expr> body
) -> Syntax<Decl> {
    return declare_fnc(name, result, body);
}
```

`declare_fnc` emits exactly one **private, ordinary, zero-argument,
non-async, non-generic function** whose return type is the supplied `Type`
and whose body is one explicit `return` of the supplied `Syntax<Expr>`.
The `Identifier` is an explicit stable-name exposure operation; its exact
argument source site is retained separately from the macro invocation and
definition sites.

This first slice rejects a generated name if any runtime declaration in the
target module already uses that name, and it rejects a second generated
declaration with the same name. It does not synthesize or merge overload
families. Nested expression macros inside the generated return expression must
fully expand first. The resulting `FunctionDecl` then re-enters ordinary
type/effect/ownership/actor-capability validation exactly like handwritten
source.

`declare_fnc` cannot select public visibility, actor kind, parameters,
generics, effects, annotations, imports, exports, modules, packages, or macros.
Source `syntax decl` arguments remain reserved; this builder does not enable
textual or arbitrary declaration quotation.

In v1 it may not generate or mutate:

- package/module headers;
- imports or aliases;
- exports/re-exports;
- another `define macro` declaration;
- build configuration or manifest entries;
- compiler flags or target capabilities.

This keeps namespace discovery, dependency resolution, export review, and macro availability independent of expansion order.

Generated `pub` declarations are still subject to ordinary visibility/container/export rules. Macro provenance must be retained in emitted ABI/debug metadata sufficient to explain where a generated public declaration came from.

## Expansion phases

The required high-level phase order is:

1. parse source while preserving macro declarations/invocations;
2. resolve imports/aliases needed to locate already-declared macros;
3. bind macro signatures and compile macro bodies in the restricted compile-time environment;
4. resolve explicit type/constant/syntax arguments needed by invocations;
5. expand macros using a deterministic worklist;
6. reject residual macro/comptime executable nodes;
7. bind/type-check generated ordinary declarations and expressions;
8. run effects, ownership/borrow, actor-isolation, capability, visibility, and ABI checks;
9. compute finite generic specialization/static-witness closure;
10. emit ordinary closed HIR/IR/AOT artifacts.

Macro expansion must not depend on successful backend code generation.

Macro output may contain invocations of already-bound macros. Such invocations enter the deterministic worklist. A macro may not generate a new macro declaration.

Direct or indirect expansion cycles are compile errors. The compiler tracks the active expansion key rather than relying only on a depth limit.

## Determinism and expansion identity

For the same declared build inputs and compiler contract version, macro expansion is deterministic.

A canonical expansion key includes at least:

- macro declaration identity/content hash;
- canonical typed arguments;
- declared content-addressed build inputs, if supported;
- target/profile/feature values explicitly exposed to compile-time code;
- macro-semantics/compiler ABI version.

It must not include ambient wall-clock time, process ID, nondeterministic map iteration, undeclared environment values, absolute host paths, ambient random state, or network results.

Sibling expansion order cannot be observable through mutable global compile-time state.

Target-independent contract vectors must produce the same canonical expanded-AST hash across Java/Graal and LLVM. Target-sensitive expansion is allowed only through explicit deterministic target/profile inputs and is compared within the same target profile.

## Authority and effects

Macro execution is deny-by-default.

The reachable compile-time call graph may not access:

- network;
- wall-clock time;
- ambient randomness;
- undeclared environment variables;
- arbitrary host files;
- mutable external services;
- FFI;
- raw pointers/addresses;
- actor spawn/state/mailboxes;
- supervisor/runtime capabilities;
- runtime tasks/futures/threads.

Compile-time helper calls are admitted only when they are themselves valid in the restricted compile-time environment.

A macro may emit deterministic compiler diagnostics. Diagnostics are the only permitted observable side channel.

Macro failure never grants runtime fallback. An unhandled compiler-evaluator failure is either a deterministic macro diagnostic or a compiler bug; it is not executable program behavior.

## Ownership and actor isolation

Macro AST values are compiler-owned immutable/persistent values, not aliases to runtime objects.

A macro cannot use `rt borrow`, `rt mut borrow`, `rt share`, or `rt take` to obtain or transfer runtime authority during expansion.

Generated source may contain ordinary ownership operations, but those operations are checked after expansion exactly as handwritten source.

Type/layout inspection cannot expose an actor-private field, unsafe address, or pointer merely because the macro asks for a different storage layout. AoS/SoA/AoSoA/SoAoS selection does not grant raw access or weaken ownership.

## Generics

Macros and generics compose only through finite compile-time closure.

A macro may generate generic declarations or receive compile-time `Type` values. Generated generics enter the same reachability/specialization/witness analysis as handwritten generics.

A macro invocation inside a generic declaration is expanded from information available at that compile-time phase. It cannot remain as a runtime specialization hook.

If a macro requires concrete information unavailable for a bounded type variable, compilation must report that the requested metadata is not known at that phase; it may not defer expansion to runtime.

Any macro/generic feedback loop that creates an unbounded sequence of declarations or specializations is rejected.

## Resource bounds and transactional expansion

Expansion is resource-bounded by deterministic budgets for at least:

- evaluator fuel/instructions;
- recursion/call depth;
- expansion nesting depth;
- generated AST node count;
- compile-time memory.

The selected budget profile is part of the build configuration and cache identity. Cross-backend conformance runs use the same profile.

The initial bounded constant-evaluator profile used for Java/Graal parity is
`const-v1`: at most 512 evaluated AST steps, recursion depth 64, 256 aggregate
elements, 65,536 UTF-16 code units in any one compile-time string, and
1,048,576 bytes of deterministic estimated compile-time value memory. Integer
addition, subtraction, multiplication, and unary negation are checked and
reject signed-64-bit overflow instead of wrapping. The estimate is an evaluator
accounting metric, not a promise about host heap allocation. LLVM parity must
either implement the same profile and semantics or continue to reject the macro
surface before IR.

The `const-v1` profile rejects non-finite floating results for now. This is a
conservative cross-backend parity restriction, not a statement that ordinary
runtime Oreslang floating arithmetic can never produce infinities or NaNs.

Nested expansion charges the same enclosing budget accounting. Exceeding a limit is a compiler diagnostic.

The macro-enabled AST rewrite that locates/eliminates macro nodes is itself
resource-bounded, including for programmatically constructed AST. The initial
Java/Graal profile allows at most 512 simultaneously nested expression/statement
rewrite frames and 1,000,000 visited expression/statement nodes per expansion
pass. This guard runs before later provenance/semantic phases so a deeply nested
AST cannot exhaust the compiler stack first. These limits participate in the
macro semantics/cache profile.

An invocation is transactional: if expansion fails, none of its partial generated declarations become visible to subsequent phases.

## Diagnostics and provenance

A macro diagnostic should report:

- the primary generated-source or invocation error;
- the macro call site;
- the macro definition site;
- a bounded nested expansion trace when relevant.

Generated-node provenance must survive long enough that later type/effect/ownership diagnostics can explain the originating macro invocation.

Provenance is compiler-only exact identity metadata. Each successfully emitted
syntax node records an ordered expansion-origin chain containing at least the
canonical source-unit identity, caller module, canonical macro owner module,
canonical declaration-local macro name, invocation source site, macro
definition source site, deterministic expansion ordinal, and emission kind. Qualification spelling is not itself macro identity: a call spelled
`Producer.identity!(...)` from module `Consumer` records caller `Consumer`,
owner `Producer`, and macro name `identity`. Nested expansion appends origins
rather than replacing an inner origin.
Provenance publication is transactional: a failed expansion publishes no
partial origin chain. This metadata is not runtime authority and need not be
retained in the executable/native artifact.

The bounded provenance attachment walk in the initial Java profile is
limited to **256 nested AST/statement frames** and **65,536 visited expression
or statement nodes**. It collects and validates the complete emitted subtree
before recording any of the new origins. Exceeding either budget must reject
with a compiler diagnostic and publish **zero new origins**, including when a
large flat aggregate or deeply nested caller-owned syntax is spliced.
Previously published origins belonging to an independent successful inner
expansion remain valid. A failed walk must not corrupt the next independent
macro expansion. Backend parity tests apply the same resource profile.

Macro expansion diagnostics participate in the ordinary compiler diagnostic cap; an expansion failure must not flood unbounded repeated errors.

## Incremental compilation

Macro expansion cache entries are valid only when the canonical expansion key and every transitive compile-time dependency match.

A macro body change, imported public-macro change, declared build-input hash change, target/profile change used by the macro, or macro-semantics ABI change invalidates affected expansions.

Cache hits may improve build speed but must not alter diagnostics or semantics.

## Hot reload

Macros do not execute inside the running OresVM.

A hot-reload generation is compiled and macro-expanded outside the runtime, then admitted through the ordinary code identity/ABI/state/effect/ownership checks.

Changing a macro therefore changes the compiled generation; it does not install a runtime macro implementation.

## Required rejection cases

A conforming compiler rejects at least:

- macro source-string eval or parse-generated-source execution;
- macro result kind used in the wrong syntax position;
- raw token-stream macro APIs in v1;
- runtime value/capability passed to a macro;
- generated import/export/macro/package/build declarations;
- implicit caller capture by textual name;
- private cross-boundary capture;
- residual macro invocation after expansion;
- direct/indirect expansion cycle;
- budget exhaustion;
- nondeterministic/ambient host access;
- generated ownership/effect/capability violation;
- unbounded macro/generic specialization feedback;
- runtime fallback after any macro failure.

## Backend acceptance

A backend may claim `define macro` support only when:

1. it consumes this shared semantic contract;
2. parser/AST represent `MacroDecl`, macro parameters, result kind, invocation, hygiene/provenance, and generated nodes explicitly;
3. expansion occurs before backend executable IR;
4. target-independent shared vectors produce the same canonical expansion result/hash;
5. generated code is rechecked through ordinary semantics;
6. negative tests reject authority, hygiene, phase, cycle, resource, and finite-closure violations;
7. the final native/runtime artifact has no macro engine dependency required for correctness.

Java/Graal Native Image and LLVM native execution are the first parity gate. Wasm/.NET/JS/Forge must implement the same semantics or reject unsupported macro syntax explicitly.
