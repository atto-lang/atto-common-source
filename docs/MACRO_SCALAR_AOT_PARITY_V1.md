# Scalar `define macro` AOT guest vectors — shared v1

This is the **backend-neutral AttoLang stage-0 intersection**, not the whole
`oreslang.macro-semantics.v1` language specification. The closed forms are
`Const<int>` `quote(value)` and single-use `Syntax<Expr>` identity.

Seven independent `.atto` programs live in
`fixtures/macro-scalar-aot-v1/`, with expectations and limits in
`manifest.json`. The three accepted cases must each produce the **guest
integer value 42** after actual compiler expansion, type checking, code
generation and executable AOT linking. The four negative cases must reject
*before* runnable code generation, without publishing partial output.

A backend-neutral guest value is **not** necessarily its process exit code:
the .NET Native AOT host prints `42\n` to stdout and exits 0, while the
current LLVM native guest returns exit status 42. Each backend's adapter must
document the value-observation path. Never use host success, parser AST
inspection, or generated IR text as a substitute for an actual executed guest.

The contract test
`node --test tests/macro-scalar-aot-v1.test.mjs` checks only fixture
coverage, stable source structure, bounded size and manifest/evidence flags.
**Passing that Node test does not execute Java/Graal, LLVM or .NET
compilers.**

## Required evidence per exact PR head

1. Record repository, commit SHA, Git tree, source SHA-256 and compiler revision.
2. Compile the exact input source through the production frontend; admit only
   expanded, type-checked, ownership/effect-checked IR.
3. Link the generated program for the backend's actual strict AOT target.
4. Execute each positive fixture and assert the guest integer **42** through
   that backend's established output ABI.
5. Execute all four negative fixtures and prove nonzero compiler failure,
   stable appropriate diagnostics, and absence of published executable output.
6. Run bounded evaluator tests for **511 nodes accepted** and **1023 nodes
   rejected** with a 512-visit limit; depth **64 accepted / 65 rejected**;
   expansion count **128 accepted / 129 rejected**, subject to independent
   parser depth/source-size limits.
7. Attach runner ID, stepful job logs, diagnostic outputs and artifact hashes
   to the PR. Failed workflows with zero steps are `NOT_EXECUTED`.
8. Resolve integration conflicts and obtain independent review before merge.

The expanded Java implementation includes functionality outside this stage-0
intersection. A backend may support more than these seven vectors, but it
must not silently reinterpret unsupported language constructs as runtime
macro calls or invoke a JIT/reflection fallback.

The fixture corpus is compiler source **for tests**, not a transfer permit.
Do not mirror any private compiler tree to another organization based on
these fixtures. Follow each source repository's independently approved
private-CI destination policy.
