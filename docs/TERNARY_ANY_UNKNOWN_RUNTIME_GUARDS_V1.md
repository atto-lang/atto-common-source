# Conditional expressions, opaque types, and narrowing — language contract v1

Status: proposed cross-backend specification; **not a passing-test or backend-parity claim**. Java draft [#1176](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1176) has a first parser/checker/runtime slice, but its GitHub Actions jobs failed before executing any steps. The spec remains broader than that implementation.

## Surface

```ores
pub fnc foo(any v): int {
    return Integer.is_int(v) ? v : 0;
}
```

Reserve `any` and `unknown` as lowercase type-only keywords. During migration, map legacy source `Any` and `Unknown` to the same distinct types, while not conflating either with the compiler's internal inference-hole sentinel. Preserve `AnyCallable <: any` as a future *type relation*, but reject implicit callable-to-`any` boxing in the initial backend slice until ownership, captured capabilities and effect witnesses are reified; a hidden callable must never gain invocation permission by erasure. Reserve names in type, import, alias, class, and generic declaration positions.

`any` holds a validated Oreslang value with hidden static type; `unknown` is untrusted/opaque input and may not silently flow into `any` or a concrete type. No unchecked property access, call, arithmetic, indexed access, or transport on either. Admission from unknown must be explicitly validated and respect capability, ownership, actor, borrow, generic reification and transport rules.

## Grammar and precedence

```ebnf
conditionalExpression = logicalOrExpression ( "?" expression ":" conditionalExpression )? ;
```

Conditional expressions are right associative; precedence lower than `||` and higher than assignments. Condition must be `bool`, with no truthiness coercion. Parse in all value-expression positions including `return`, args, initializers, and lambda bodies. Parentheses disambiguate nested conditions. Coexist with postfix `value?` propagation by grammar/lexer lookahead without changing its semantics; document whitespace and boundaries explicitly. Preserve ternary across formatting round-trips.

Evaluate condition once, then exactly one branch, retaining source order, effects, exceptions, defer/finally, borrow lifetimes, and ownership moves. Infer a safe common result type under contextual expected type; never silently widen to internal Unknown sentinel. Both branch types must be compatible with return target. Reject conditions that are not statically bool.

## Optional nested false-arm inheritance — proposed v1 subfeature

Nested, parenthesized *true-branch* ternaries may omit their own `:`
false arm only when an enclosing conditional supplies one:

```ores
a ? (b ? x) : y      // a ? (b ? x : y) : y
a ? (b ? (c ? x)) : y // a ? (b ? (c ? x : y) : y) : y
```

The inheritance is lexical and limited to a direct nested conditional
expression along the true-arm chain, including redundant parentheses.
The immediate enclosing complete conditional's false expression supplies the
missing arm. Each condition executes at most once and **only the selected
leaf expression evaluates**; shared fallback syntax must not cause repeated
evaluation on a single path. A bare `a ? x`, an omission in an enclosing
false arm, or an omission buried inside arithmetic, assignments or call
arguments is a syntax error. The parser must fully desugar the shorthand
into ordinary three-arm AST nodes before checking ownership, effects,
flow refinements, suspension, lowering, formatting or AOT compilation.
Do not represent a missing false arm as runtime `null`, `None`, `void`
or compiler Unknown. A malformed/incomplete AST must fail closed.

A trusted scalar predicate can refine only a stable, plain source `any` or
`unknown` binding, or preserve an already-matching plain scalar binding,
in this first-stage implementation. A `borrow any`, generic `T`,
pointer, ownership wrapper, union, callable or actor capability must not
be silently converted into a bare scalar type by removing its declared
ownership/effect metadata. More general refinements require a separately
proven representation- and capability-preserving narrowing rule. Type-only
imports, value imports and renamed imports all reserve their exposed
names, and none may be mistaken for compiler-trusted scalar predicates.

The fallback must be type-checked independently in **every execution
environment where it may run**. E.g. `a ? (b ? x) : y` checks `y` both when
`a` is false and when `a` is true but `b` false. It must not inherit a
negative type refinement from the outer false branch when executed inside
the true branch. Ownership borrows/moves and cleanup must obey the same
branch-local rules as an explicitly written full conditional.

`Double.is_double(v)` is a trusted runtime guard for Oreslang 64-bit
floating-point values, with a true-branch refinement to the current
`float` static type (eventually `f64` if represented distinctly).
Its provenance rules match `Integer.is_int`: no user namespace, import,
class, callable or local shadow may forge a trusted refinement.
The Java interpreter recognizes a Java Double value, not a string or
integral value; native/AOT targets require exact runtime type tags.
Returning a float/double from a declared `: int` callable remains a type
error: no implicit narrowing, truncation or floating-point-to-integer
conversion is introduced by this shorthand.

The Java stacked implementation on
[oreslang-source.java nested ternary draft](https://github.com/ores-truffle-oreslang/oreslang-source.java/tree/feat/nested-ternary-inherited-else-20261017)
must execute parser, guest runtime, Native Image and cross-backend gates
before the feature is considered certified; this text is a proposed contract,
not verification evidence.

## Conditional joins and capability-safe top normalization

A conditional whose branches have distinct, fully known types produces their
explicit union/sum type rather than the compiler-internal incomplete-inference
sentinel. For example, `flag ? 7 : "seven"` has type `int | string`.
An actually unresolved compiler type remains unresolved and must not be
manufactured into a union proof.

Union normalization to `any` or source `unknown` is permitted only when
**every** alternative can independently widen to that top type without losing
ownership/effect/capability evidence. Thus `any | int` may normalize to
`any`, while `any | borrow int` and `any | Channel<int>` must remain
explicit unions until a future reified top-value representation preserves the
relevant authority.

Writable structural record members are invariant. A writable
`{value: int}` must not become writable `{value: any}`, because the latter
would allow a non-int write through an alias. Readonly structural views retain
safe width/covariant reads.

These rules apply equally to ordinary and inherited-fallback ternaries and are
part of the capability-safety contract, not backend-specific Java behavior.

## Runtime type guards and narrowing

Recognize built-in `Integer.is_int(v)` as a trusted narrowing intrinsic (or an explicitly compiler-verified predicate annotation), not by ordinary function-name matching or arbitrary user method spoofing. The true successor flow environment refines stable `v` to `int`. The false successor refines `v` to an appropriate complement only where representable; otherwise retains the prior type. Apply it to `if`, `&&`, `||`, `!`, and `? :` consistently.

Do not narrow mutable/reassigned or aliased locations across potentially mutating calls, suspension, actor boundaries, callbacks, or parallel effects. For an unstable expression evaluate once to a compiler temporary before testing and subsequently reading it. Preserve definite assignment and nonescaping ownership requirements. Do not treat general user-defined Boolean functions as guards without a separately verified predicate contract.

`typeof expression` is a **compile-time static type query** in type position. `typeof v == int` is not a runtime test and must not be accepted as one. If an expression-level dynamic type-test syntax is added later, specify it separately from static `typeof`. Existing expression-level `typeof fnc(...) => T` callable-type syntax must be reconciled, not silently broken.

## AOT representation

For `any`, use a typed runtime value/tag or canonical descriptor (with precise type identity) in Java/Graal, LLVM, .NET, WASM, and Forge. `Integer.is_int` can lower to a tag check or compiled descriptor check in closed-world AOT. Optimization may eliminate check when statically proven, but must not change semantics. Cross-module ABI must specify tag/descriptor identity, boxing/unboxing, signed integer widths, nullable values, structural/generic reification limits, and metadata stripping behavior. Non-reifiable type tests fail closed at compile time. Distinguish compiler static type queries from runtime admission/type recognition.

## Required cross-backend tests (no passes claimed)

1. Positive: `return Integer.is_int(v) ? v : 0;` returns input for int, otherwise zero, in interpreter/JIT/AOT.
2. Negative: `return v;` from `any` to `int` rejected; `return Integer.is_int(v) ? v + 1 : 0;` accepted only when true-side narrowing proves numeric.
3. Negative: `typeof v == int ? v : 0` must not be misinterpreted as dynamic test.
4. Nested right-associative expressions, precedence with `||`, assignment, `?:` and postfix `value?`, formatter stability.
5. Condition and selected branch each execute once; unselected branch never executes (including throw/raise/panic).
6. Unknown cannot smuggle borrowed/native handle/actor/callable/capability values across validation or message boundaries.
7. Predicates cannot be spoofed; mutation, callback, alias, suspension, actor boundary invalidate refinements.
8. Type-sensitive lambda return contextual typing, unions/optionals, ownership moves, deterministic drops and defer/finally.
9. AOT descriptor equivalence between Java native-image, LLVM, .NET NativeAOT, WASM and Forge where supported; explicitly document missing profiles.
10. Verify exact source-tree SHA of CI runner; failing-before-steps is not test evidence.

## Rollout

1. Reconcile Java PR #844 (Any/Unknown), #450 (typeof RFC) and #1020 (postfix propagation) before patching grammar/type checker.
2. Rename source surface to lowercase keywords with compatibility deprecation diagnostics; do not repurpose internal `Unknown.INSTANCE`.
3. Implement trusted predicate provenance, SSA/flow narrowing, ternary typing and runtime tagging in each backend.
4. Add parser, runtime, security, formatter, and AOT test fixtures; use funded exact-tree mirrors only if provenance is demonstrated.
5. Do not call this feature implemented or parity achieved until backend tests execute and pass.
