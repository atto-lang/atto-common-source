# Oreslang dispatch return destinations — v1

This is the canonical shared-language contract for Java/GraalVM and LLVM.
An implementation is conformant only after **the same guest source program**
compiles and executes with the same result in both supported backends.
Parsing a form, emitting IR, running a model, or observing a test runner with
zero steps does not demonstrate executable conformance.

| Source form | Category | `return` in selected arm | Produces expression value? |
| --- | --- | --- | --- |
| `match` | Pattern-based value expression | Complete the nearest match's ARM_RESULT | yes |
| `do match` | Pattern-based procedural statement | FUNCTION_RETURN (enclosing callable) | no |
| `switch` | Scalar case-based value expression | Complete the nearest switch's ARM_RESULT | yes |
| `do switch` | Scalar case-based procedural statement | FUNCTION_RETURN (enclosing callable) | no |

## Canonical value-match arm syntax

For the canonical `match ... over` surface, value arms use one of two explicit forms:

```text
on <pattern> [when <guard>] -> <expression>;
on <pattern> [when <guard>] -> ::
    <statements>
    return <value>;
end
```

The semicolon terminates an expression arm. The `-> ::` spelling opens a statement block that is closed by its own `end`. In a value match, every reachable normal completion of that block must execute an explicit `return <value>;`; the final expression is never an implicit arm result.

That arm-local `return` has typed destination `ARM_RESULT`. If the containing non-`void` callable itself returns the match, it must separately spell `return match ...`, whose destination is `FUNCTION_RETURN`. These two destinations must never be collapsed merely because both are written with the `return` keyword.

Older braced-arm fixtures in this document and the v1 machine-readable corpus are compatibility evidence for historical parser branches; they do not override this canonical arm surface. Backends adopting the canonical syntax must normalize both accepted compatibility forms to the same typed arm-result IR or reject the legacy spelling under strict mode.

## Invariants

1. The dispatch subject is evaluated **once**. No implicit arm fallthrough.
2. An arm-local `return` in a value expression—including a canonical `-> :: ... end` block arm—completes **only its nearest value dispatch** as `ARM_RESULT`, then its containing callable continues unless that callable explicitly returns the dispatch result (`return match` or `return switch`). A trailing expression in a block arm is not an implicit arm result.
3. In a procedural `do` form, `return` exits the enclosing lexical callable.
   Never lower it to a discarded expression or an `ARM_RESULT` signal.
4. A partial `do` form with no matching arm may continue after the statement.
   `return do match` and `return do switch` are **invalid syntax**.
   Use `return match` or `return switch` when returning the result,
   or `do match` / `do switch` for procedural dispatch.
5. All value forms require exhaustive value production (without confusing
   nontermination, nested callable returns, or cleanup with proof of result).
   An unsupported type/pattern/effect must produce a diagnostic **and no IR**.
6. Explicit `match` patterns are checked in source order. A canonical
   designated catch-all (`default`, `on default`, `on _`) is normalized to
   fallback-only after explicit arms; duplicates are errors. `switch` concrete
   scalar cases similarly outrank a `default` regardless of its source position.
7. A pending ARM_RESULT must not skip cleanup or overwrite a function return.
   Lexical defer/finally cleanup executes exactly once on supported exits.
   Cancellation, await, and actor restart cannot publish a stale result.
8. Value-expression and procedural returns use different typed IR
   discriminants: `ARM_RESULT` versus `FUNCTION_RETURN`. Never infer the
   destination from runtime return-value type or whether a caller ignores it.
9. The `match<ret=T>` / `match<T>` contract applies to ARM_RESULT type.
   `do match<ret=T>` constrains enclosing callable returns, not an arm result.
10. Suspension is orthogonal to dispatch return destination. A selected arm may
    contain `await` when the surrounding callable/effect context permits
    suspension; no `nb` dispatch modifier is required. `nb match` and
    `nb switch` are invalid forms. `nb` remains a wait-mode modifier for
    channel/select operations and must never mean "allow async arms".

## Select is subject to the same explicit dispatch rule

In a statement context, `do select { ... }` is a procedural blocking
operation. A winning arm's `return`, `break`, or `continue` propagates
to its lexical enclosing callable or loop. Never discard a blocking
`do select` return as if it were an arm-local result.

The result-producing `return select from cases` remains an expression
return. A bare `select { ... }` statement is prohibited, as is a bare
`select from cases` expression statement that discards the result.
Standalone nonblocking `do nb select` currently uses a detached actor
continuation and must not be mistaken for an ordinary procedural return;
its future/result semantics require explicit completion tracking.

`return match` and `return switch` denote expression-result dispatch;
`do match` and `do switch` denote procedural dispatch. In all cases the
difference must be represented in typed IR, not inferred from the presence
of a returned value.

## Older PR adoption and compatibility

- Java/GraalVM #404 is an older implementation whose original `do match`
  transformed function returns into discarded expressions; that behavior is
  obsolete and must not be reintroduced.
- Java/GraalVM #634, #661, and integration #722 must preserve the four
  destinations across parser, AST, typechecker, interpreter, suspension, and
  Native Image. In branches lacking value-producing `switch`, fail closed.
- LLVM #46 and stacked #243 implement a **restricted scalar/i64 slice**.
  Older native typed-receive PRs #156, #163, and #180 expose source-specific
  receive pattern constructs; they do not thereby implement ordinary
  `match` value expressions or general procedural `do match`.
- Merged/closed historical PRs are not rewritten; apply follow-up patches to
  active descendant branches. A test that expects a `do` arm's `return` to be
  discarded is a *negative indicator*, not a valid compatibility contract.

## Unresolved legacy statement aliases (strict-mode blocker)

Some older Java branches still accept **bare statement** `match` or
`switch` and interpret an arm's `return` as a function exit. That
historical statement syntax is not the four-form value-expression contract.
It must be migrated to an explicit `do` spelling or rejected under
canonical strict admission. Do not count legacy statement acceptance as
implementation of value-producing `match` / `switch`.

On updated Java branches, `Ast.SwitchStmt.procedural` is set only by
explicit `do switch` parsing. The three-argument compatibility constructor
defaults to `false`. This marker prevents later AST passes from guessing
the return destination, but does not by itself implement the missing
`ValueSwitchExpr`/ARM_RESULT lowering or make bare legacy statements
conformant. The release gate must cover strict admission and AST preservation.

## Current-main implementation audit (2026-10-25)

This contract is the target language surface, not a claim that every backend
currently implements every form.

- Java/GraalVM has a distinct value `MatchExpr` and procedural `MatchStmt`.
  Awaited value-match subject/guard/arm execution has prior exact-tree guest
  evidence. Canonical `do match` and `do switch` are statement forms; the
  current hardening branch preserves an explicit procedural bit for
  `do switch`. Java does **not** yet have a value-producing `SwitchExpr`;
  value `switch` must fail closed.
- Java still accepts legacy bare statement `match`/`switch` during migration.
  That compatibility surface is not evidence for the canonical value forms.
- Current LLVM main does not lower ordinary value/procedural match or switch.
  It must reject all four forms before emitting IR until typed
  `ARM_RESULT`/`FUNCTION_RETURN` lowering exists. Historical native PRs do
  not establish current-main support.
- `nb match` and `nb switch` are invalid on every backend. Suspension in a
  selected arm is governed by the enclosing async/suspending context.

## Evidence gate

Run identical checked-in fixtures under both backends. Record the input
Git blob SHA, exact compiler/merged-tree SHA, typed result or diagnostic,
runner/job IDs, executable guest status, zero skipped tests, and exit/cleanup
trace when relevant. Reject inconsistent `ARM_RESULT` /
`FUNCTION_RETURN` evidence even if the numeric result matches.
For unsupported slices, require nonzero compile failure and empty generated IR.
The Python/model checks in this repository validate the contract metadata,
not guest execution.

See `contracts/dispatch-return-forms.v1.schema.json`,
`contracts/dispatch-return-forms.v1.tsp`, and
`fixtures/dispatch-return-forms.v1.json`.
