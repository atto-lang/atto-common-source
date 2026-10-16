# Value pipelines and Option/Result combinators — v1 candidate

**Status:** language contract proposed for compiler adoption; not a release or parity certification.

## Grammar and precedence

```ebnf
assignment = pipeline [ "=" assignment ] ;
pipeline = conditional { "|>" pipeline_stage } ;
pipeline_stage = IDENT [ "(" [ argument_list ] ")" ]
               | ( "Option" | "Result" ) "." IDENT "(" [ argument_list ] ")" ;
```

`|>` is one contiguous token, left associative, binds weaker than a conditional and more strongly than assignment. It is unrelated to bitwise `|`, logical `||`, function-lambda delimiters or actor message-routing operators. Whitespace within `|>` is not allowed.

For a named function, `x |> f(a,b)` evaluates `x` once before `a` and `b`, and invokes `f(x,a,b)`. `x |> f` invokes `f(x)`. Dynamic, effectful callee expressions are not admitted in v1; do not reorder evaluation to implement a broader syntax. Ordinary qualified stages such as `value |> object.method(arg)` are also rejected until dedicated left-first method receiver evaluation is implemented; they must not be silently rewritten into a conventional method call. A stage's nested arguments follow ordinary expression precedence and left-to-right argument evaluation. Pipelines do **not** imply error propagation, await, actor scheduling, short-circuiting or unwrapping.

`x |> Option.map(g)`, `x |> Result.map_err(g)` and similar named sum-type operations lower to `x.map(g)` and `x.map_err(g)` **without** evaluating a fictional `Option` or `Result` namespace value. Wrong-variant combinators are checked on the value type and rejected. Instance combinators may also be invoked without `|>`.

## Type contracts

| Operation | Input | Output | Callback |
| --- | --- | --- | --- |
| Option.map | Option<T> | Option<U> | T -> U |
| Option.and_then | Option<T> | Option<U> | T -> Option<U> |
| Option.filter | Option<T> | Option<T> | T -> bool |
| Option.ok_or_else | Option<T> | Result<T,E> | () -> E |
| Option.transpose | Option<Result<T,E>> | Result<Option<T>,E> | none |
| Result.map | Result<T,E> | Result<U,E> | T -> U |
| Result.map_err | Result<T,E> | Result<T,F> | E -> F |
| Result.and_then | Result<T,E> | Result<U,E> | T -> Result<U,E> |
| Result.or_else | Result<T,E> | Result<T,F> | E -> Result<T,F> |
| Result.ok | Result<T,E> | Option<T> | none |

Callbacks run at most once and only for the applicable variant. `map_err` is **not** an Option method. `and_then` must preserve the original Result error type rather than implicitly erasing it. `transpose` preserves the None-vs-error distinction. Generic output types must be inferred from callback signatures; `Unknown` is only an implementation bootstrap, **not** the final type contract.

## Ownership, effects, and observability

The first pipe input is evaluated once. Each function invocation obeys the same borrow/move/copy/exclusivity rules as a normal call. `map_err` does not catch panic, raise, cancellation or scheduler errors. Callbacks do not implicitly suspend; their declared effects are checked. Returned owned values cannot alias restricted actor heaps and borrow lifetimes cannot cross suspension or escape callback boundaries. Backends must fail closed if typed Option/Result lowering is unavailable. No silent conversion to bool/null/zero, no implicit copies, no hidden ActorUtils transport, no unnoticed error-type widening.

## Release evidence

All five of `.java`, `.llvm`, `.net`, `.forge`, `.wasm` must pass the same source fixture identities and diagnostic categories before full language parity is claimed. Real compiler acceptance, executed results, ownership/negative cases, sanitizer and runtime evidence (where applicable), pinned commits, and working CI runners are required. A JSON manifest or syntax-only parser test **cannot** prove execution.

Current candidate implementation PRs (unverified):
- Java/GraalVM: [#1073](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1073): operator and sum-type combinators.
- LLVM: [#455](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/455): scalar-only pipe lowering; Result/Option deliberately rejected.
- .NET and Forge: restricted source subsets still lack general named callable expression lowering.
- WASM: guest-host admission is not itself a compiler implementation; parity depends on the exact native source target and real guest execution.

See `cases.json`; *candidate* means code exists but is not certified.

## Verified exact-source CI evidence (2026-10-16)

- [Java + LLVM guest source CI run 38926799818](https://github.com/voxletra/voxletra-e2e/actions/runs/38926799818): source blobs mirrored to a separately authorized **private** organization repository via the GitHub Tree API. Neither hosted job checked out the source organization or required secrets/cross-organization checkout tokens.
- GraalVM 25.3 JVM: **93/93 selected JUnit regressions passed** (0 failures/errors/skips), including the real value-pipeline evaluator, Option/Result variants, borrowing, call argument ordering, and parser cases.
- Native LLVM 18.1.3: the exact shared scalar source fixture was compiled into LLVM IR and host machine code. Executed guest exit code **7** matches the oracle. Noncallable stages and unimplemented native Result operations produced diagnostics and **no IR**.
- Shared canonical scalar fixture Git blob: `1ce089ef1592b2c263a44bb6a71067f5785c6f58`. Invalid-stage fixture Git blob: `7d0bb7f4984f22eb44d6d2c05c8008128aaed15a`.
- Current verified intersection: Java/GraalVM source pipeline + Option/Result interpreter behavior and LLVM scalar-only compiled behavior. **Do not infer LLVM tagged Option/Result support, .NET, Forge or WASM support, a complete Maven suite, Native Image/JIT stress, or full five-backend parity from this evidence.**

