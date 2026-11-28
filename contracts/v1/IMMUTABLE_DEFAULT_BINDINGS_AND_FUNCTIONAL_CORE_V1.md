# Immutable-by-default bindings and functional core — contract v1

**Status: proposed source-language contract; NOT implemented or parity-verified.**
This specification records the requested decision, defines an executable conformance
target, and deliberately does not claim parser, type-checker, runtime, or backend support.
The independent Java/GraalVM, LLVM, .NET, WASM and other frontends must all either
implement the same contract or reject unsupported code explicitly.

## Decision: unqualified typed local declarations are immutable

For a local declaration of a Copy scalar:

```ores
int x = 7;
const x = 7;
const int x = 7;
const x: int = 7;
```

All four forms MUST infer/resolve the same `int` type and produce the same
fixed readonly local binding semantics. Local `const` is a binding-permission
property, not a demand that the initializer execute at compile time. Its
initializer is checked and evaluated eagerly once in lexical order, exactly
like the immutable-default typed form. A compiler may fold a proven constant
expression, but that optimization fact must not change the binding kind or
observable evaluation/error behavior.

The new typed-default binding and local `const` both have runtime
single-assignment, readonly-view semantics. `val` remains a distinct
single-assignment spelling with its existing referent-mutation permission,
and `let` remains the explicit rebinding capability. Omission of `const`
is NOT permission for mutation. A type-only local initializer is never a
second spelling of `let`.

```ores
int x = 7;
x = 8;                // ERROR: immutable binding
x += 1;               // ERROR: assignment to immutable binding
rt mut borrow x;      // ERROR: cannot grant exclusive mutable access
```

No implicit declaration through `x = 7`, implicit cast, implicit mutation,
operator overloading or unproved ownership transfer is introduced.
The rule applies only when the compiler has recognized a **type reference in
a declaration position**. An arbitrary identifier-expression must not become
a declaration because its value looks like a type.

## Preserve and distinguish existing explicit permissions

| Local binding form | Rebind the name? | Write through the referent? |
| --- | --- | --- |
| `T x = value` (new) | No | No, readonly view; runtime initializer allowed |
| `const T x = value`, `const x: T = value` | No | No, readonly view; eager checked initializer |
| `const x = value` (inferred type where admitted) | No | No, readonly view; eager checked initializer |
| `val T x = value` | No | Existing mutable-referent permission; still needs exclusive ownership |
| `let T x = value` | Yes | No, readonly view |
| `let mut T x = value` | Yes | Yes, only with proven ownership |
| `const mut T x = value` | No | Yes, only with proven ownership |

These rows express *binding* and *referent-view* permissions independently,
not automatic deep-frozen storage. Retain existing legacy `val`, `let`,
`const`, and the accepted modifier orders until an explicit versioned
migration is approved. For an `int` Copy value, a mutable-referent permission
is not a loophole for reassigning a `const` binding.

Local `const` uses an eager checked initializer and creates a fixed readonly
binding. This is not a claim of global import-time execution, runtime-free
storage, atomicity, deep freezing, or referential purity. Destructured
`const`, for-of `const`, and standalone local `const` therefore share the
same binding-level immutability rule. Contexts that specifically require a
compile-time constant expression (for example a switch/case pattern) retain
that separate expression-level requirement. File/module constant evaluation
and import/no-execution rules remain separately governed (common-source issue
#23).

## Readonly semantics and alias safety

- `T x = expression` has a checked initializer and is definitely assigned once.
  It must be rejected without an initializer unless a separate explicitly
  specified definite-assignment construct covers the case.
- A readonly view prevents field/index/method mutations *through that view*;
  it cannot be cast to mutable, aliased as mutable, or laundered through
  a closure, generic type, pattern binding, FFI, or dynamic dispatch.
- An immutable **binding** is not necessarily a deeply immutable **object**.
  A separately live authorized mutable owner may mutate an object if the
  ownership model admits that alias; mere `const` must never be claimed to
  ensure shareability. Deeply immutable/Sendable snapshots need whole-graph
  proof, no mutable aliases and explicit lifetime/generation checks.
- Immutable structured values, tuples, records and ADT payloads should
  default to readonly fields/views; class and actor-field admission is a
  separate versioned migration, not a silent change to current field grammar.
  Actor state remains writable only through checked actor-state/critical APIs.
- Pattern, match, lambda capture, loop, destructuring, optional/named-argument
  and parameter bindings default readonly unless explicitly granted existing
  mutation permissions. Lexical shadowing may introduce a new immutable name,
  never mutate the shadowed value.
- `rt borrow` can make a read-only loan; `rt mut borrow` requires a proven
  exclusively mutable owner. A `rt take` of an owned non-Copy binding
  may consume it once, but consumption does not convert a readonly view into
  ambient mutation or create a second live owner.
- Every access must respect the current no-`&`/`*` public syntax rule and
  explicit Copy/move/borrow/drop ownership semantics.
- Immutable capture cannot acquire ambient powers or leak state across actor,
  future, cancellation, hot-reload, generation or isolate boundaries.

## Parsing, typing, and lowering

1. Add a typed-local-declaration AST node / canonical HIR flag
   `binding_rebindable=false, referent_mutable=false` when the syntax is
   `T x = expr`. Keep source spans, spelled syntax and diagnostics.
2. Retain inferred local `const x = expr` when the initializer has exactly
   one stable static type. Runtime dependence does not make the binding mutable
   or invalid; inference is from the statically checked expression type, never
   from a runtime value. Reject missing initializers, circular inference,
   ambiguous or unresolved type names and unsound generic inference.
3. Parse declarations in a well-defined statement context and distinguish
   `Foo bar = ...` from `Foo(bar)` and ordinary expressions without
   value-dependent disambiguation. Report a stable parse/name-resolution
   error rather than falling back to a mutable binding.
4. Normalize the four scalar examples into equivalent immutable runtime
   bindings while preserving source spelling/provenance in HIR for diagnostics
   and tooling. Proven compile-time-constant value metadata is orthogonal to
   whether the binding was spelled `const` or type-first. The type-first
   spelling is not a new runtime ABI.
5. Enforce readonly checks after name resolution for assignments, compound
   assignments, indexed/member writes, mutating receiver calls, mutable loans,
   pattern capture and indirect alias escape.
6. The formatter must preserve/canonically render the agreed spelling; it must
   not rewrite a readonly typed declaration into `let` or `val`.
7. Existing files using `let` or `val` keep their current meaning. Any field,
   module-level or actor-state changes require a separate compatibility audit
   and explicit migration/version gate.

## Minimum executable conformance matrix

Each scenario needs its own case ID, exact input source, expected value or
compile-fail diagnostic, and compiler-backed guest receipt. The following
names describe required fixtures; they are **not** assertions of executed tests.

| ID | Fixture | Expectation |
| --- | --- | --- |
| IDB-01 | `int x = 7; return x;` | Pass; returns 7 |
| IDB-02 | `const x = 7; return x;` | Pass; same inferred type and value |
| IDB-03 | `const int x = 7; return x;` | Pass; same observable behavior |
| IDB-04 | `const x: int = 7; return x;` | Pass; same observable behavior |
| IDB-05 | `int x = 7; x = 8;` | Compile fail: readonly binding |
| IDB-06 | `int x = 7; x += 1;` | Compile fail: readonly binding |
| IDB-07 | `int x = 7; rt mut borrow x;` | Compile fail: readonly loan |
| IDB-08 | `let int x = 7; x = 8;` | Pass: explicit rebinding |
| IDB-09 | `const int x = 7; int x = 8;` in a nested block | Pass: lexical shadowing |
| IDB-10 | Same-scope repeated `int x` | Compile fail: duplicate declaration |
| IDB-11 | `const x = unknownName;` | Compile fail: unresolved initializer |
| IDB-12 | `const x;` | Compile fail: type/inference/initializer |
| IDB-13 | `int x;` | Compile fail: no initializer |
| IDB-14 | `string x = 7;` | Compile fail: no implicit conversion |
| IDB-15 | Type-first `Foo x` with unresolved `Foo` | Compile fail, no expression fallback |
| IDB-16 | Function call `Foo(x)` near typed declarations | Existing expression semantics retained |
| IDB-17 | Readonly indexed write `x[0] = y` | Compile fail |
| IDB-18 | Readonly field write `x.field = y` | Compile fail |
| IDB-19 | Mutating receiver called through readonly view | Compile fail unless method proven readonly |
| IDB-20 | Closure captures immutable `x`, then tries to rebind it | Compile fail |
| IDB-21 | Closure reads captured immutable `x` | Pass, with valid lifetime proof |
| IDB-22 | Destructuring default bindings and pattern matching | Readonly by default |
| IDB-23 | `val` vs `let` vs `const mut` existing permissions | No regression |
| IDB-24 | Non-Copy owned value moved exactly once | Pass / use-after-move fails |
| IDB-25 | Borrow escapes or crosses await / cancellation unsafely | Compile fail |
| IDB-26 | Actor state updated without checked critical/state API | Compile fail |
| IDB-27 | `const` does not authorize shared mutable reference | Compile fail |
| IDB-28 | Mutability attempt hidden inside a generic or method | Compile fail |
| IDB-29 | Effectful initializer of typed-default/`const`/`val` binding | Allowed only in an effect-permitted context; binding remains single-assignment |
| IDB-30 | Local `int x` native vs Java/Graal behavior | Differential parity: values, errors, ownership |

A source-grep test, host-only arithmetic check, zero-step workflow or
successfully parsed fixture is **not** compiler-backed execution. Require
pinning compiler commit and tree IDs, stepful Actions with runner admission,
positive guest execution, negative compiler diagnostics, ownership checker
proof, receipt integrity/mutation checks, and independent review. Keep all
unexecuted and unsupported cases explicit.

## Functional programming feature audit / completion targets

The binding rule is the foundation, **not** a declaration that the whole
language is functional or pure. Track each item independently as implemented,
host-tested, compiler-backed guest-tested, and cross-backend parity-verified:

- Immutable defaults for locals, parameters, patterns, captures, aggregate
  fields, and readonly access; explicit owned mutable escape hatches.
- Value types, product types, ADTs/tagged unions, Option/Result, exhaustive
  pattern matching and totality/exhaustiveness diagnostics.
- First-class typed functions, lexical closures, higher-order combinators
  (map/filter/fold/scan/zip), composition and partial application with
  effect and capture tracking.
- Explicit `pure` contracts with transitive effect checking, capability
  confinement and isolation of pure computation from actor/I/O effects.
- Persistent maps, lists/vectors, sets, structural sharing, stable iteration,
  safe immutable snapshots and deterministic equality/hash semantics.
- Immutable-friendly actor reducers and state-machine transitions with
  separately checked effect commands; actor state need not be globally immutable.
- Compiler-checked generic abstractions/typeclasses, no runtime reflection,
  no implicit conversions, no operator overloading.
- Safe recursion, tail-call optimization where established, clear allocation
  and stack-bound behavior; no promise of unbounded tail recursion without proof.
- Eager evaluation by default; explicit generators/lazy sequences where useful,
  without switching the language to implicit lazy evaluation.
- Property-based and mutation tests plus cross-backend differential fixtures,
  including cancellation, FFI, hot reload and isolation boundaries.

`pure` must remain a compiler-enforced, transitive effect contract rather
than being inferred from `const` alone. A pure function may use locally
owned mutation if it cannot escape; a typed-default / `val` immutable binding
may have an effectful initializer in a permitted context. A separate
compile-time-constant-expression context may still reject effects regardless
of binding spelling. Respect the existing design in the Java
reference `docs/PURE.md`, and the shared ownership contract
`docs/OWNERSHIP_SYNTAX.md`.

## Scope and release gates

This is a **design-only PR**. It changes no compiler or library source and
does not authorize merging runtime behavior. Subsequent implementation PRs:
(1) Java/Graal parser + AST/type/ownership/effect + tests;
(2) LLVM equivalent parser/HIR/native guest tests;
(3) independent .NET/WASM/Forge parity tracking and checks;
(4) formatter, LSP/diagnostics, stdlib fixture migrations;
(5) pinned compiler-backed cross-backend conformance, branch protection
and independent approval.

Related design context: Java issue #758 (field final vs mutable referent),
Java issue #817 (`const mut` vs rebind), Java draft PR #1079 (persistent HAMT
and pure actor proposal), Java `docs/PURE.md`, and
common-source `docs/OWNERSHIP_SYNTAX.md`. Do not double-credit runtime
prototypes as implemented source-language functionality.

## Audit resolution — local const is a binding rule (2026-11-01)

The Java documentation contained stale wording that described standalone local
`const` as compile-time-only. Audit of the live Java type checker and the
active Java/LLVM/.NET/Cranelift parity branches shows local `const`
initializers are already runtime expressions: the compiler may discover and
record constant values, but does not require local `const` to be constexpr.

This contract therefore treats `int x = expr` and `const x = expr` as the
same fixed readonly local-binding permission for supported scalar cases.
`const` remains distinct from `val` where referent-mutation permissions
differ. Any context that requires an actual compile-time constant expression
must check that property explicitly rather than infer it from the binding
keyword. Java docs and backend contracts must be updated together; no backend
may silently reintroduce a constexpr-only local-const rule.

## Implementation inventory (2026-11-01, not release evidence)

- Java/Graal: source parser + typed/borrow and real guest **authored** tests,
  `oreslang-source.java#2414`, separate inference/cast `#2405`.
- LLVM: native scalar type-first parser + Rust CTest for six real linked
  guest executions and seven compile-negative programs,
  `oreslang-source.llvm#1266` stacked on inference/cast `#1256`.
- Wasm: eighteen LLVM-bridge real-guest test targets `oreslang-source.wasm#227`.
- Cranelift: bounded native JIT immutable scalar local slice `oreslang-source.cranelift#21`.
- .NET: experimental structured parser adds distinct runtime readonly binding
  kind and typed CFG/CIL checks in `oreslang-source.net#298`, stacked on
  `#282`; shipping parser stays fail-closed through `#287`.
- Shared source conformance: 32 real .ores fixture files in
  `oreslang-platform-conformance#271`. The 32/32 exact-byte readback is
  **source integrity only**, not compilation or runtime test evidence.

**Open correctness gate:** binding immutability and proven compile-time value
metadata must remain independent in every backend. Java/LLVM may keep existing
CONST-like binding metadata only if constant folding/evaluation records are
separate and never cause a runtime-dependent initializer such as
`int x = input + 1` or `const x = input + 1` to be treated as a
compile-time value. The same distinction must survive branch merges, generic
inference, closure capture and actor ownership. A source-local parser
acceptance test is not a proof of this guarantee.

No current patch claims complete functional-programming feature coverage,
whole-object deep freezing, or five-backend exact-head passing execution.

## November 1 branch-reconciliation audit (latest)

The inference/cast parent branches received new primitive type-first parser
implementations while their separate immutable-default children were open.
We reconciled by **preserving the newer parent compiler code**, rather than
merging stale duplicate parser branches:

- Java `oreslang-source.java#2405` already has the more precise
  `looksLikePrimitiveTypeFirstImmutableBinding` lookahead; child
  `#2449` adds dedicated readonly tests and actual Graal guest tests.
  Superseded duplicate parser `#2414` was closed unmerged.
- LLVM `oreslang-source.llvm#1256` already has a guarded
  `type_first_scalar_local()` body-loop and scalar handling; new stacked
  `#1301` contributes bounded source-to-IR-to-Clang native guest tests.
  Old divergent `#1266` was closed unmerged; test compiler and linker subprocesses
  are limited to 20 seconds and 1 MiB output each. Readonly assignment and
  duplicate-name rejection require compiler-owned diagnostic wording.
- .NET `oreslang-source.net#282` now admits primitive type-first locals.
  Stacked `#333` adds *distinct* `Readonly` binding metadata and
  structured CFG/CIL execution plus helper-parameter runtime-value tests.
  Previous divergent `#298` was closed unmerged.

**These repairs are source changes and authored tests, not CI passes.**
The current mainline for each backend is unmodified by draft PRs;
full semantic and toolchain parity remains blocked by exact-head executed CI
and the compile-time-`const` vs runtime-readonly HIR mismatch tracked in #204.
