# AttoLang class, method and `fnc` annotation audit (2026-11-17)

**Status: DRAFT / REFERENCE-ONLY.** This adds checked contextual admission *in the Python reference model*. Neither the model nor these examples constitutes compiler-backed proof, working macros, Wasm/JVM/LLVM/.NET/Forge codegen, or AOT conformance.

## Source placement and declaration identity

Annotations attach to the next declaration, before visibility/modifiers. Whitespace and comments do not change attachment. A dangling annotation or one attached to the wrong AST target must be diagnosed at its `@` span, not silently carried onto a later declaration. Multiple annotations are allowed when each is registered and valid for that target. Duplicate nonrepeatable annotations are an error, including qualified aliases resolving to the same declaration identity. Annotation arguments use bounded compile-time constants, with positional or named forms per the schema; runtime expressions and side-effecting evaluation are forbidden.

```atto
@Deprecated("Use Replacement")
define pub class Legacy as
    @Override
    pub render(int n): int { return n; }
end

@Ret(int)
@Pure
pub fnc checked_add(int x, int y): int { return x + y; }
```

These are *design-intent* examples. In particular, `@Ret`, `@Pure` and `@Deprecated` remain unverified in actual compiled programs. Compiler-owned `@throws(Error)`, `@raises(Error)`, and `@panics(Error)` are proposed equivalent spellings of typed trailing failure-effect clauses, not passive metadata. They normalize into the same checked effect record; an annotation cannot erase other declared or inferred effects. A duplicate same-kind trailing clause plus annotation must be rejected. A `@Pure` callable cannot declare escaping failures under this strict zero-effect reference contract. The formatter must not silently normalize a previously rejected source program into an accepted one.

## Class annotations

* `define class` maps to `class`; `define actor` maps to `actor`, **not** `class`. Structs, interfaces, traits, and enums have their own targets.
* `@Deprecated`, `@Doc`, and `@Since` are metadata; `@NoCopy` and `@Sendable` require genuine ownership/graph proof; `@Repr` and `@Align` require verified target ABI and layout. Metadata cannot grant privileges.
* Annotation inheritance is **not** implicit: subclass metadata may inherit only under an explicit future policy. For semantic annotations, inherited restrictions/effects/capabilities must be revalidated when overriding or specializing. An annotation on a class does not decorate every method automatically.
* A serial actor must retain its single typed `receive` entrypoint and mailbox invariants; annotations cannot relax sealed state, serialization, tenant isolation, or supervisor CONTROL handling.

## Instance methods, out-of-line methods, static methods

* Instance methods include inline class methods and out-of-line `mtd (self: T)` methods; their owner must resolve. Static methods remain methods where permitted, but `@Override` **requires** a non-static concrete inherited class instance-method slot.
* `@Override` is compiler-owned, case-sensitive, zero-argument and nonrepeatable. `pub override` is legacy; writing both is a duplicate. Reject constructors, actor methods (until that contract is implemented), free functions/routines, trait/interface members, missing concrete base implementations, final/sealed bases, signature/arity mismatches and narrowed visibility.
* Diamond inheritance must not select a parent by declaration order. Distinct concrete origins require explicit resolution; sharing one original declaration does not create ambiguity.
* A real compiler must derive override facts from the resolved inheritance graph, not accept user-provided flags. The reference `admit_scoped_declaration` exercises fail-closed rules on *supplied resolved facts only*.

## Free functions, routines and typed effects

* Free `fnc` and direct-call `routine` declarations both map to `function`; the routine/direct-call property must survive to typed IR. An annotated closure has a separate `closure` target, not `function`.
* `@Ret(T)` must equal the **compiler-resolved** return type and may not override a signature, inference proof, generic substitution, or ABI. `@Pure` requires completed effect analysis of the whole call graph and all reachable paths; `throw`, `raise`, `panic`, I/O, actor sends and suspension are not permitted by the strict zero-effect reference proof. Unchecked calls are not pure by assumption.
* `@Inline` must not erase errors/effects, violate suspend/critical boundaries, or bypass sandbox/ownership proof. `@Test` and `@Benchmark` do not grant hidden runtime authority.
* `@RequiresPermission` is a checked requirement, **never a grant**. Privileges remain controlled by runtime capability and permission policy. Override implementations must not silently weaken enforcement or strengthen caller preconditions without verified call-site compatibility.

## Compile-time and backend admission gate

1. Lex/parse: preserve `@` source spans, comment attachment, qualified identities, target kind, order and argument AST; reject malformed/dangling/unknown annotations.
2. Symbol/type resolution: exact annotation declaration identity, closed schema, named/positional collisions, repeatability and bounded constants. `@Ret` must match resolved callable return type.
3. Semantic proof: resolve inheritance for `@Override`; calculate transitive effects for `@Pure`; enforce ownership and actor state/permissions for compiler-affecting annotations.
4. Typed AST/HIR/MIR: record each annotation as consumed metadata/proof/transform with traceable identity. Rerun borrow/effect/security checks after any expansion; no silent dropping.
5. Backend: refuse unlowered semantic/ABI annotations **before** emitting IR, CIL, Wasm, machine code, sidecars or generated caches. Include annotation identity/version/args/proofs in incremental, AOT and hot-reload fingerprints.
6. Evidence: exact source/head SHA, real compiler execution, positive behavior and negative no-artifact fixtures on each backend. Python reference-only passes never count as guest conformance. Zero-step GitHub Actions runs are `NOT_EXECUTED`.

## Reference tests

```sh
python3 -m unittest discover -s reference -p 'test_annotation_admission.py' -v
```

The new scoped test matrix covers class vs method vs free function placement, legacy/duplicate override, actor/static/constructor override rejection, missing/final/sealed base slots, signature/visibility proof, matching return annotations, effect-proof requirements for throw/raise/panic/I/O/actor/suspend, schema corruption, and hard ceilings on annotation budgets. It does **not** prove source parsing or executable code.
