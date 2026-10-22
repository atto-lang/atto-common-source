# Checked exceptional effects v2 — normative language contract

Status: **design/conformance contract, not a claim of executable compiler or runtime support**.
Supersedes the provisional analysis rules in
[Exceptional callable effects v1](../v1/EXCEPTIONAL_CALLABLE_EFFECTS.md)
for strict Oreslang source. See the implementation/admission notes below.

## Rule

Every function, routine, instance method, static method, constructor, callable
value, interface/trait method and exported callable signature has three
separate **may-effect sets**: Throws, Raises and Panics.

A call is legal only when each possible callee effect is either (a) discharged
by a statically proven *permitted* local handler, or (b) covered by the
corresponding effect category of the enclosing callable or a recognized
terminal supervisor/process boundary. The compiler MUST reject missing or
unknown coverage in strict mode, not merely warn.

No local source handler can discharge a panic. Try/catch, trap, recover,
on_throw/on_raise, generic Error handlers and Result/Option wrapping do not
consume Panics. A panic travels to the actor's supervisor CONTROL boundary,
or a declared process-fatal boundary. Cleanup may run but MUST NOT turn a
panic into success.

## Source declarations

Canonical source clause order is throws, raises, panics. Clauses appear after
the return type and before the body/terminator. The examples use the
Java draft's colon-return and unparenthesized type-list spelling:

~~~ores
fnc parse(input: string): int throws ParseError {
    // ...
}
routine authorize(input: string): int raises AuthError {
    // ...
}
fnc commit(input: string): int
    throws ParseError
    raises AuthError
    panics InvariantError
{
    // ...
}
define class Service as
    handle(input: string): int
        throws ParseError
        raises AuthError
        panics InvariantError
    {
        // ...
    }
end
~~~

The earlier v1 design uses arrow returns and parenthesized effect lists.
Formatter/parser compatibility with those spellings is **unresolved**;
backends MUST NOT silently accept one spelling then discard its effects.
The exact canonical grammar must be unified in parser, formatter, docs and
the shared contract before admission. Empty clauses, duplicates, non-Error
effects and unbound effect types are invalid.

Each named error must be a statically proven subtype of std/error.Error.
Permissible effect bounds may include Error itself as the explicit,
conservative catch-all. A bare keyword without a type does not count as a
complete strict-mode contract. User-defined Error descendants require
immutable/owned, bounded and serializable payload proofs before crossing
actor, FFI or hot-reload boundaries. This is stricter than the temporary
scalar/record payload admission in Java draft PR #1290.

A *pure* callable may omit all three effect clauses; omission means an empty
declared checked-effect set **only when the compiler proves that the body
and every dependency are effect-free**. Omission is never permission to
perform untracked effects. Unknown external/FFI, reflective, dynamically
loaded or generically erased callees are NOT treated as effect-free.
They require a verified manifest/declaration, or fail closed in strict mode.

## Static checking

For each category K separately, after all overload, generic substitution,
dynamic dispatch and imported-interface resolution:

  escaped_K(body) = direct_K(body) UNION effects_K(calls) MINUS handled_K(body)

The compiler validates: escaped_K(body) is a subset of declared_K(callable).
For Panics, handled_Panics(body) is always the empty set. A throw is
discharged only when every possible thrown concrete type is covered by a
reachable, typed catch or a verified trap conversion. A raise is discharged
only by a proven eligible direct-defer recover boundary (once raise recovery
lowering is implemented). Catch and trap never discharge raises.

The formula describes sets of **may** effects, not an assumption that effects
necessarily occur. Multiple callee error types are unioned. Unmatched throw
types remain visible after partial matching. A local catch/recover handler's
own effects and all finally/defer effects are added to the result.

Illustrative checked caller rules:

~~~ores
fnc leaf(): int panics InvariantError { return 1; }

// Compile error: neither catch nor trap absorbs a panic.
fnc unsafe(): int {
    try { return leaf(); } catch (e) { return 0; }
}

// OK as a *static effect declaration* once panic execution is supported.
fnc propagates(): int panics InvariantError {
    return leaf();
}
~~~

- A direct panic statement must be declared as panics T.
- A direct throw statement must be declared throws T unless statically caught.
- A direct raise statement must be declared raises T unless provably recovered.
- A caller must propagate residual effects in the same category: declaring
  throws T cannot discharge raises T or panics T.
- No declared category can be erased by assignment to a function value,
  closure capture, method reference, generic instantiation, trait object,
  RPC/FFI boundary, module structural view or hot-reload generation.
- An override/implementation may narrow each effect set but cannot widen
  any category. A polymorphic/dynamic call uses the effect bound promised by
  its interface; unresolved dispatch joins possible implementations or
  fails closed. Contravariant effect erasure is forbidden.
- Constructors, generated serializers, property getters, implicit coercions,
  callbacks, Task/Future continuations, actor sends and std/core operations
  must have checked effects, including allocation/resource failures where
  modeled as source-level errors.
- Suspension preserves the effect across await, select, cancellation races
  and continuation migration. The type of Future<T> or Task<T> must carry or
  constrain the effect of awaiting/executing it; creation alone must not
  silently swallow effects.
- Recursive call graphs converge to a fixed point or are rejected if the
  analyzer cannot find a sound finite bound. No runtime reflection fallback.

## Distinct handling and boundaries

| Source effect | Can catch? | Can trap? | Can recover? | Terminal boundary |
| --- | --- | --- | --- | --- |
| throw T | yes, matching type | yes (Result/Option contract) | eligible direct defer | unhandled actor error policy |
| raise T | no | no | eligible direct defer only | actor failure escalation |
| panic T | **no** | **no** | **no** | actor supervisor CONTROL or process-fatal |

- On throw, lexical typed catches handle only matching Throws effects.
- Raise skips catch/trap, allows only explicitly proven raise-recovery as a
  separate capability; its recovery mechanism must not catch Panic.
- Panic never executes user catch/recover. It performs only bounded,
  non-consuming runtime cleanup. Exactly one immutable supervisor CONTROL
  failure receipt is required; it is separate from the actor mailbox.
- A supervised actor dispatch boundary terminates its actor invocation:
  it may record/route the panic, never resume the failed call stack. The
  actor supervisor may choose restart/stop/escalation as a *new* action.
- Main/process boundaries need an explicit terminal policy so a panicking
  main can be declared without requiring an impossible local catch. Until
  implemented, compilers reject this combination instead of inventing safety.
- Host fatal errors, forced cancellation, invariant failure and source panics
  have distinct metadata; do not convert unknown host errors to declared
  guest errors without a verified mapping.
- A finally/defer may run resource reclamation without swallowing panic.
  Cleanup failures add bounded suppressed metadata, preserve original failure
  priority and do not double-send supervisor receipts.

## Compiler and ABI conformance

Represent EffectSet as three disjoint, deduplicated, typed sets in the parser,
AST, HIR/MIR, function type, overload identity, method/virtual-table contract,
export/import ABI, generic instantiation, source maps and hot-reload metadata.
Use nominal Error-subtyping coverage once the Error hierarchy is proved, not
string names or a structural record coincidence.

Suggested stable diagnostics:
- E_EFFECT_UNDECLARED_THROW
- E_EFFECT_UNDECLARED_RAISE
- E_EFFECT_UNDECLARED_PANIC
- E_EFFECT_PANIC_UNCATCHABLE
- E_EFFECT_UNKNOWN_CALLEE
- E_EFFECT_OVERRIDE_WIDENS
- E_EFFECT_ERASURE
- E_EFFECT_UNSAFE_PAYLOAD

No strict-mode success is reported from syntactic hints alone. The existing
Python oreslang-test.cli --effects checker remains advisory.

## Admission gates and current limitations

1. Shared fixtures and canonical parser/formatter agreement for function,
   routine, static/bare/explicit method, constructor and callable types.
2. Strict compilation of direct and transitive source call effects, including
   source throw/raise/panic statements and category-specific diagnostics.
3. Proven handling subtraction for typed catch/trap, direct defer recover and
   finally/defer effects. **Never** subtract panic.
4. Effect-safe interfaces, overrides, higher-order values, generics,
   recursive calls, module ABI, generated code and hot reload.
5. Checked actor/Task/Future boundaries and fatal main/root policies,
   with exactly-once supervisor CONTROL tests.
6. Differential Java/Graal, LLVM and supported .NET/JS/Wasm source tests,
   including exception type identity, scheduler races, forced cancellation,
   cleanup precedence and no-local-panic-consumption regressions.
7. Executed, exact-head CI and independent review before changing any
   current fail-closed compiler gate.

Java draft PR #1290 currently implements a restricted signature-only direct
call propagation slice: no source throw/raise/panic execution, no verified
method/higher-order/async effect propagation, and no Error-only nominal
proof. LLVM does not have executable guest exceptional effects. This
document does not claim those gates are met.
