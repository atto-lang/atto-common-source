# AttoLang scalar core and checked-i64 parity — v1 target language specification

**Status: proposed normative target, NOT implementation or parity certification.**
The new canonical source extension is `.atto`; explicit legacy `.ores` remains
an independent migration-compatibility decision. This profile complements
immutable-by-default spec PR #203 and critical/suspends spec PR #209.

## Checked scalar semantics

- Under the signed-64 scalar profile, `int` uses checked signed-i64
  arithmetic; `+`, `-`, `*` obey documented precedence, are eagerly
  evaluated, and never silently wrap. Static overflow may be diagnosed at
  compile time; runtime overflow must trap. Neither path may produce a valid
  scalar value or publish a successful executable on a rejected compile.
- Type-first local `int x = expr;` is readonly by default. Literal
  `const int x = 7;` and `const x = 7;` are readonly. Rebinding those
  names is rejected unless an explicitly permitted mutable binding spelling
  exists. This corpus tests only constant literal forms; it does not settle
  the existing Java `const` compile-time restriction on runtime initializers
  or alter actor fields. See PR #203's compatibility appendix.
- Eager local initialization includes unused locals. Statically known checked
  overflow in an unused initializer cannot be deleted just to return 42.
- Pure `fnc` helper calls use value parameters, with explicit returns; there
  is no implicit conversion, no user operator overloading, and no ambient
  global state or reflection in this profile.
- Legacy source operators `%`, `^`, and `^^` are removed: reject them
  fail-closed, not by silently rewriting them into another operation.
- `suspends` and `critical` are separate effects not admitted by this
  scalar subset. Any backend not supporting a case must report
  `NOT_EXECUTED` / `UNSUPPORTED`, never a passing observation.

## Exact source corpus

`contracts/atto-scalar-v1/cases.json` binds **9 positive and 9 negative**
complete `.atto` programs to individually pinned exact Git blobs. Positive
cases cover canonical 42, precedence, grouping, i64 bounds, type-first and
const readonly bindings, and one pure helper call. Negative cases cover
add/sub/mul overflow, readonly rebinding, eager overflow in an unused
initializer, and removed operators.

A **positive** must return its full typed signed-i64 result through the
backend-defined channel (e.g. a Wasm export is not an OS process exit code).
A **negative** may be a compile rejection or a checked runtime trap,
depending on constant evaluation, but cannot publish a false successful
result. Record the diagnostic family and exact execution stage separately.

| Toolchain | Required real compiler/guest proof | Status |
| --- | --- | --- |
| Java/Graal | canonical guest JIT; Graal native AOT separately | NOT_EXECUTED |
| LLVM | frontend, generated LLVM IR, native compiler/linker and native guest | NOT_EXECUTED |
| Wasm | SHA-pinned LLVM frontend, wasm32 binary and isolated guest execution | NOT_EXECUTED |
| .NET NativeAOT | Atto frontend, CIL, published native application and executed guest | NOT_EXECUTED |
| Forge | independent C++ stage-0 parser/IR, native assembly and executed binary | NOT_EXECUTED |

Forge is **not** the independent `oreslang-source.cranelift` project.
The latter JIT may join a separate sixth lane, but its observations cannot
be substituted for Forge or Wasm.

## Acceptance and evidence security

Run `node --test tests/atto-scalar-v1/corpus.test.mjs` and
`node scripts/atto-scalar-v1/verify.mjs` for **source-only** integrity,
never for compiler/guest certification. Every source backend must carry
the same exact `.atto` files locally, execute its own compiler and observe
each case; emit source head/tree, compiler and binary digests, fixture
blob, mode-specific result, negative diagnostic, assigned runner, job ID,
attempt, nonempty ordered job steps, logs and independent review.
`steps=[]` or `steps=null` is runner admission failure, not an
execution result. Private-source cross-org transfer requires explicit
reviewed authorization; no copied source is needed to author this spec.
