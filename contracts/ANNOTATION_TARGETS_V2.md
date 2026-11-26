# AttoLang annotation targets and fail-closed admission — proposal v2

**Status:** proposed, portable contract and reference tests only. This document does not claim parser support, AOT execution, actual sandbox enforcement, or conformance in any backend.

The legacy v1 annotation-admission draft is in `ores-truffle-oreslang/oreslang-source.java` PR #2275, with companion PRs LLVM #1173, Wasm #176, Forge #133, and .NET #247. The v1 corpus has 17 phase-scoped vectors. Do not replace those cases or mislabel their parser acceptance as guest execution.

## Coverage

The registry in `contracts/annotation-targets-v2.json` describes 26 potential annotation targets, including canonical `@Throws`, `@Raises`, and `@Panics` (legacy lowercase spellings also registered) for callables. These are distinct AST node kinds: package, module, import, class, struct, record, interface, trait, enum, enum variant, actor, actor handler, actor message, free function (`fnc`), method, constructor, field, property, parameter, return type, type alias, type use, generic type parameter, local binding, closure, and macro definition.

Examples (DESIGN INTENT; **do not assume the current compiler accepts these programs**):

```atto
@Deprecated("Use NewWorker")
@NoCopy
define class OldWorker as
    @FromJson("request_id")
    final string request_id

    @Pure
    process(int value): int {
        return value + 1;
    }
end

@ActorMaxThreads(1)
@MailboxCapacity(64)
define actor Worker as
    @Critical(250000)
    receive(Message msg) as
        // Runtime constraints must be proved, not assumed from annotations.
    end
end

@Repr(c)
define struct Header as
    int tag
end

@Derive(Serializable)
define enum Status as
    @SerialName("ready")
    Ready
end

@Ret(int)
fnc main(): int { return 42; }
```

`@Repr`, `@Critical`, `@Derive`, thread counts and other compiler-affecting examples are specifically **not available by default**: they must fail closed until verified for each backend. The examples illustrate desired declaration placement only, not a frozen user-defined annotation declaration grammar.

## Canonical @Override and callable target mapping

The canonical override marker is the **case-sensitive, zero-argument** `@Override`, placed before visibility and method modifiers:

```atto
define class Left extends Root as
    @Override
    pub describe(): string { return "left"; }
end
```

`pub override describe()` is a legacy spelling, not the preferred source format.
If migration compatibility accepts it, the formatter should normalize it to the annotation; writing both forms is an error. `@Override` must resolve to the compiler-owned `atto.core.Override` identity and must not be shadowed by user-defined annotations.

**Declaration-to-target mapping:**

- `define class` → `class`; `define actor` → `actor`.
- An inline instance method or out-of-line `mtd (self: T)` → `method` (owner `T` must resolve).
- A free `fnc` and a direct-call `routine` → `function`; routine-ness is retained independently and is never erased by an annotation.
- An actor `receive(...)` handler → `actor_handler`; ordinary actor-owned methods map to `method`. Annotation placement cannot bypass sealed state or mailbox rules.

`@Override` applies only to an instance method with a matching inherited overridable declaration: reject a missing target, incompatible signature, final/sealed parent, ambiguous inherited slot left unresolved, duplicate annotation, static method, field, free `fnc` or `routine`, and actor instance methods without a verified inheritance/override contract. Implementing only an abstract interface requirement is **not** an override of an existing concrete implementation in the current diamond-inheritance subset. Parent-order preference is prohibited.

The reference admission model validates **placement and schema only**. It cannot establish inheritance, dispatch, metadata retention, or backend execution. A compiler must retain a typed override marker through semantic checking and prove the inheritance contract before lowering; otherwise it fails before producing any artifact.

**Canonical spelling update:** `@Throws(IOError, ParseError)`, `@Raises(RecoveryError)`, and `@Panics(FatalError)` are the PascalCase, compiler-owned callable forms. They allow zero or more positional Error type arguments; empty `@Throws()` / `@Raises()` / `@Panics()` are statically checked **empty permitted effect bounds**, not unspecified exceptions. Legacy lowercase `@throws(Error)` / `@raises(Error)` / `@panics(Error)` stay registered as migration aliases with one required Error type. The aliases resolve to a single canonical identity, so mixed spellings on one declaration are duplicate errors. Java-style trailing unparenthesized `throws IOError, ParseError` and `raises RecoveryError` are specified in [atto-spec's checked-failure grammar](https://github.com/atto-lang/atto-spec/blob/feature/pipeline-effect-proof-v1-20261117/language/checked-throws-annotation-v1.md). All are proposed until a backend proves actual parsing/effect lowering.

For class, method and `fnc` proof requirements and negative test cases, see [ANNOTATION_DECLARATION_AUDIT.md](ANNOTATION_DECLARATION_AUDIT.md). The compiler-owned lowercase `@throws(Error)`, `@raises(Error)` and `@panics(Error)` markers are intended to be exact effect-clause equivalents for typed callables (not grants or metadata), subject to verified Error subclasses and duplicate-clause rejection. Their Rust implementation is an independent unmerged draft, [atto-source.rs #301](https://github.com/atto-lang/atto-source.rs/pull/301); this reference does **not** claim compiler execution.

## Annotation phases

| Phase | Intended behavior | Admission obligation |
|---|---|---|
| metadata | Documentation, deprecation, tooling and source mapping | Resolve exact registered annotation identity; preserve typed metadata; never treat it as executable permission |
| expand | `@FromJson`, derive, serialization adapters, opt-in compile-time transformations | Compile-time deterministic hygienic expansion, then re-run type, ownership, effect and authorization checks |
| proof | `@Ret`, ownership, Sendable/Serializable, actor limits, critical deadlines and permission requirements | Compiler-owned typed evidence; reject unverified claims or weaker annotations than required |
| abi | Layout, alignment, inlining, FFI symbol binding, hot reload | Verify exact target ABI and codegen; reject before IR when unavailable |

An annotation's **package-qualified declaration identity**, allowed targets, argument schema, phase and repeatability are part of its ABI-facing meaning. The formatter may normalize whitespace, but cannot change that meaning.

## Security and correctness invariants

1. Resolve the annotation declaration before interpreting its arguments. Reject unknown names even when they look like harmless metadata. Exact qualified identity is required; no case folding or Unicode confusable matching.
2. Reject wrong targets, duplicate nonrepeatable annotations, malformed delimiters, missing or unknown named arguments, repeated names, positional/named collisions and type mismatches.
3. Inputs are bounded compile-time constants; no runtime reflection, I/O, network, clocks, randomness, actor invocations, or mutable state in constant evaluation.
4. Preserve semantics in AST and HIR; a backend must consume a proof/IR transform or report an error before emitting any executable output. Dropping unknown annotations is not allowed.
5. Macro expansion must be deterministic and hygienic, respect size/depth/step budgets, and never bypass private members, sealed actor state, borrow checking, ownership transfer, scoped permissions, supervisor CONTROL or tenant isolation.
6. Annotation labels do not grant privilege. In particular `@Trusted`, `@Unsafe`, `@AllowAll` and `@Untrusted` are not recognized authorization mechanisms. A future `@RequiresPermission` is a checked requirement, **not a permission grant**.
7. Affects-to-cache fingerprints include resolved annotation version, arguments, generated AST, effect/borrow proofs and target ABI; changing an annotation invalidates dependent caches/hot-reload artifacts.
8. AOT backends must work without runtime annotation lookup, reflection or a dynamic compiler. Java/GraalVM Native Image and LLVM full AOT are first-class requirements; LLVM zero-GC and GraalVM low/zero-GC design budgets must not be invalidated by implicit allocation or generated caches.
9. Security-sensitive source rejection is necessary but insufficient: each backend needs exact-head compiler/guest execution and negative evidence of **no IR, CIL, Wasm, object files or sidecar artifacts** on denied cases.

## Backend implementation distinction

Current legacy drafts describe limited Java/GraalVM parser/expansion paths (`@Ret`, `@BuildMetadata`, `@FromJson`), a restricted LLVM native actor annotation path, and fail-closed source rejection on Wasm, .NET and Forge. No new backend is marked passed in v2. The reference model checks a pre-resolved use structure; it is **not** a lexer, type checker, macro expander, borrow checker, compiler or runtime.

The proposed target registry makes clear what the language should eventually accept, but `implementation: PROPOSED_OR_LEGACY_UNVERIFIED` does **not** imply that any entry works today. New backends (.rs, .js, Cranelift and others) must opt into explicit conformance; they do not inherit support from the five legacy backends.

## Staged implementation sequence

1. Unify tokenization, error locations, target AST attachment and annotation declaration resolution. Every node must retain source span and exact fully qualified annotation type. AttoLang source conventions still use `fnc` for free functions and snake_case for function/method names.
2. Add a registry-driven type checker for argument defaults, uniqueness, constant evaluation, repeatability and target matrix. Every malformed or unsupported annotation must get a stable diagnostic code.
3. Preserve typed annotation records into HIR and MIR, then audit each transform for correct consumption, proof invalidation, capability boundaries, actor state and serialization invariants.
4. Implement small positive feature slices rather than enabling everything at once (for example: metadata; callable return contracts; `@FromJson`; ABI layout; actor admission). For each slice, create valid and invalid guest programs and verify exact machine-code/AOT effects across backends.
5. Prove formatter parse/format/reparse equivalence, module imports, incremental compilation, hot reload and compiler cache invalidation under annotation changes.
6. Only promote backend statuses with pinned compiler SHA, test SHA, exit code, diagnostics, runner step evidence, output artifact hashes and known unsupported cases. A zero-step GitHub Actions job is **NOT_EXECUTED**.

## Running the reference tests

```sh
python3 -m unittest discover -s reference -p 'test_annotation_admission.py' -v
```

Those tests cover 26 target kinds, 43 provisional registered annotations and fail-closed invalid-use vectors, but **only** for the independent reference model. CI must never report them as compiled AttoLang guest or five-backend parity tests.
