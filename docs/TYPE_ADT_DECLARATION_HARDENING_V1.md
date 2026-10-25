# Oreslang type and ADT declaration hardening (v1)

**Status (2026-10-23): cross-backend language contract and source-free adversarial oracle, NOT guest execution evidence.**

Authoritative machine-readable inventory: [declarations.v1.json](../contracts/v1/type-adt/declarations.v1.json).
Read with the existing Java [grammar](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/grammar.ebnf), [ADT limits](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/ADT_TYPE_SYSTEM.md), and [LLVM README](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/blob/main/README.md). The grammar and actual compiler may differ; neither design documentation nor a CI workflow with no executed steps is release evidence.

## Terminology and namespace discipline

A named declaration can (a) introduce a nominal or structural **type**, (b) introduce a **value**, (c) define a runtime value **constructor**, (d) introduce a namespace, or (e) introduce a type-level proof. These are independent properties.

* `define class`, `define actor`, `define supervisor actor`, `define proxy actor`, `define model`, `define enum`, `define struct`, and `define newtype` introduce types with potentially constructible *instances*. The name of the type is **not** automatically a first-class reified `Type<T>` guest object.
* `define record` names a **structural schema**; records are products with known fields, **not** dynamic Maps, and the declaration must not invent a new nominal class ID.
* `define interface`, `define trait`, and `define contract` define obligations/proofs, not runtime objects. Contracts apply to modules, while interfaces/traits apply to nominal types subject to explicit conformance rules.
* `define type` creates an **alias**. A transparent alias neither allocates an object nor changes the identity of its target; a nominal wrapper must be `define newtype`. Do not conflate an alias with an instance. The current Java grammar uses bare `type Alias = T;`; the `define type` spelling remains a compatibility integration target.
* `define pattern` is a checked compile-time pattern alias, not an extensible dynamic constructor. `define symbol` binds an immutable `Symbol` value/identity, not a new type. `define module` introduces a namespace, not a module instance.
* Variants such as `abstract`, `sealed`, `final`, `shared`, `pub`, `pub(file)` and `pub(pkg)` are modifiers/visibility, NOT additional data-type categories. `fnc`/lambdas are callable values and function types, not an additional `define` aggregate family.
* No user-declared kind has automatically reified type-object authority. Any future `Type<T>` reflection must be explicitly proposed and capability-gated.

### Forward declarations (Java source implementation exists; cross-backend execution not verified)

```ores
declare type UserId;
declare pub type PublicId;
declare trait Printable;
declare pub trait PublicPrintable;
declare interface Named;
declare pub interface PublicNamed;
```

Java mainline already parses, resolves and has JUnit source tests for same-file `declare [pub] type|trait|interface`; current runner execution has **not** been verified. `declare` reserves an **unresolved compile-time type-level name**, never a runtime object or a default/zero value. It is allowed **only** for `type`, `trait`, and `interface` in v1. No `declare class`, `declare enum`, `declare actor`, `declare newtype`, `declare supervisor`, or `declare model` until a separately reviewed ABI/forward-construction RFC. Multiple compatible references to one declaration may coalesce, but every reachable exported declaration must resolve exactly once to a definition with identical fully qualified identity, visibility, generic arity/variance, bound signatures and module authority. Reject ambiguous or missing resolutions, circular aliases with no productive indirection, imported shadowing, or visibility widening. Never permit a declaration to satisfy an implementation or serialization requirement.

For the **eventual** unified syntax, accept `define pub TYPE` and, where a legacy compiler supports it, `pub define TYPE` as equivalent, with formatter canonicalization to `define pub TYPE`. This is *not* a claim the Java parser already accepts these forms. Existing `define interface` and `define contract` stay type-only even if introduced with `define`; the keyword does **not** imply runtime instantiability.

## Nominal identity, structural products, and refinement

1. Each nominal declaration receives a stable **origin-bound identity** from linked package/code-unit identity, definition ID, generic substitution and ABI generation, not just an unqualified spelling or Java class name. A subtype or alias cannot forge nominal membership via matching field shapes.
2. An ordinary `record{...}` is a closed, width-compatible **readonly structural view**. A concrete `struct` has exact closed shape, explicit ownership and storage. Do not implicitly erase structs to records, invent fields at runtime, or conflate either with `Map<K,V>`.
3. `newtype` is **opaque and nominal** outside its defining authority. Only checked constructors, e.g. `try_from`, can establish validated refinements. Neither decoding, `any` boxes, FFI, imports, `as` casts, JSON, nor wildcard reflection may bypass it.
4. Type refinements must be enforced on every ingress, mutation, ownership transfer, return, actor message and serialization boundary that can invalidate the predicate. If a backend cannot prove that, reject; do not silently erase the constraint.
5. `any` may carry an explicitly authenticated dynamic payload; `unknown` requires validation before trusted typed use. Neither allows nominal fabrication, hidden property access, forged method dictionaries, or unchecked ownership weakening.
6. Generic instance identity and bounds survive imports; variance defaults to **invariant** where mutability/ownership makes variance unsafe. `Option<T>` and `Result<T,E>` are not automatically sendable/serializable if their active payload is not.
7. Recursive types require finite-by-value layout: an unboxed `Node(Node)` cycle is invalid unless broken by a proven indirect owner/reference with defined lifetime. Static structural aliases must not bypass this check.


Type and generic declaration binders must never use `_`, which is an inference/wildcard placeholder; see Java draft compiler hardening PR #1974. Only actual declared names can establish nominal or generic identity.

## Tagged sums and exhaustive matching

1. Product (AND) = tuple/struct/record with all fields; sum (OR) = one **nominally tagged** case with one active payload. Transparent `A | B` is a type union, **not** a new tagged enum.
2. Emit one canonical `EnumDecl` with private-by-default/exported visibility, validated generic binders, stable case identity, payload type, explicit wire tag (positive 32-bit and unique), declared owner and ABI fingerprint. The compiler **must reconcile** incompatible Java enum AST proposals before exposing executable constructors. For exported serialized enums, require explicit stable tags; local inferred tags may never silently become a wire contract.
3. Nullary, scalar and record payload cases all require exact constructor arity and checked payload type. Reject duplicate case IDs/tags, forged tags, unknown cases, invalid visibility and implicit conversion of an unrelated class/trait into a constructor.
4. A match is exhaustive only when **every active payload** is covered recursively, with guards contributing no unconditional coverage. Thus `Some(0), None` does not cover `Option<int>`; `Some(true), Some(false), None` covers `Option<bool>`. `Ok(0), Err(_)` does not cover `Result<int,E>`. Distinguish exhaustive coverage, arm reachability and deliberate `match first` ordered semantics.
5. Runtime membership must use **exact nominal tags** and compatible payload types, not assignment conversion: widening `int` to `float` for assignment does not make `on float` match an integer.
6. A move consumes the entire active variant/payload exactly once. Trace/drop **only** the active arm. No inactive tag memory reads, double drop, dangling borrowed projections, mutable sharing, or escape across suspension/actor boundaries.
7. Unknown enum wire tags, unknown schema generations, oversized recursive graphs, forged actor/source identities and noncanonical serializers fail closed. Runtime case IDs may be internally optimized independently from **versioned wire tags**.
8. The uninhabited `Never` and inhabited `Unit` algebra must be decided explicitly; do **not** implicitly promote `void` to a first-class `Unit`.

### Finite-algebra source-free regression targets

* `bool * bool = 4`; tagged `bool + bool = 4` with disjoint case identity;
* `Option<bool> = 3`, `Result<bool,bool> = 4`, `Option<Result<bool,bool>> = 5`;
* Nonexhaustive `Some(true),None`; exhaustive `Some(true),Some(false),None`;
* Nonexhaustive `Some(Ok(true)),Some(Err(_)),None`; exhaustive iff `Some(Ok(false))` (or wildcard equivalent) is added;
* Reject unknown/duplicate/zero/overflowed case wire tags;
* Reject arm shadowing/dead arms and guard-only coverage;
* A generic or unbounded payload can be covered by an irrefutable binder/wildcard, never by an arbitrary finite list of literals.

The source-free oracle under `tests/type-adt-contract.test.mjs` checks **only the contract and finite/symbolic model**. It does not parse or execute Oreslang, prove source/typechecker integration, or replace fuzzing/model checking.

## Observed cross-source contradiction: plain `match` ordering

The Java language document describes ordinary `match` as **exclusive-by-default**, with `match first` as an explicit ordered escape hatch. Current Java `TypeChecker.checkMatch` instead states that "Match is ordered. Overlap is valid" and its existing test corpus admits guarded overlaps in plain `match`. This is an observed **spec/compiler disagreement**; the source-free oracle does not settle it. Do not silently change existing guest behavior or claim exclusive matching. Reconcile the grammar, parser AST flag, arm-ambiguity analysis, docs, formatter and actual guest execution in a migration PR; add negative overlapping-arm tests for the eventual exclusive mode and positive ordered tests for `match first`. Keep the gate open until compiled source tests confirm the chosen semantics.

The reference oracle's descriptor identity checks are plain **data comparison**, not cryptographic provenance or unforgeable compiler-origin authority. Runtime constructor authenticity still requires trusted linker/runtime tags and boundary checks.

## Compile/release gate — fail closed per backend

For each declaration family, use the matrix `source syntax => parsed AST => resolved identity => typed HIR => ownership/effects => guest construction => pattern and serialization => AOT/native parity`. All gates default to NOT VERIFIED, separately for Java/Graal JVM, Native Image/hybrid, LLVM/native, WASM, .NET, Forge and JS. Merely finding a prototype runtime type does not pass a source gate.

Required execution receipts include exact source-tree SHA, compiler/fixture SHA, toolchain, actual executed test steps, guest stdout/exit, diagnostics and sanitizer evidence. If source transfer to another organization's runner is required, **obtain explicit private-source export authorization and protected destination allowlisting** first; having unused Actions minutes and creating a tokenless mirror do not authorize private code export. No unauthorized copies.

## Integration blockers / ownership

* Java tagged enums: [#1269](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1269) and [#813](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/813). Select one AST and land guest constructor/exhaustiveness/ownership tests.
* LLVM source ADT: [#314](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/314) and [#317](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/317). Add source compilation, not merely wire-codec tests.
* Supervisor/proxy actor: [#641](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/641). Runtime CONTROL and supervision identity are not ordinary actor/class values.
* Model graph: [#1332](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1332). Draft model construction must retain graph identity, independent ownership and effect bounds.
* Record/struct: [#821](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/821). No implicit conversion between distinct storage/shape models.
* Nominal wrappers/opaque: [#248](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/248). No forgeable structural safe-markup.
* Future typestate/GADT units: [#1392](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1392), explicitly later than sound basic closed sums and declarations.
