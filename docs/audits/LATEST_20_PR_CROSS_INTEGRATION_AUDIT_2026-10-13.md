# Oreslang: cross-PR safety audit of the 20 most recently updated open PRs

Date: 2026-10-13. Scope: the top 20 open pull requests returned by the
GitHub org search sorted by most recently updated at audit start.
**This is a source/code-review checkpoint, not proof of an executed build.**
This list is deliberately a snapshot, since branch updates change ranking.

## Audited PRs

| # | Repo PR | Responsibility | Integration warning |
|---|---|---|---|
| 1 | Java [#891](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/891) | procedural `do match` | Parser AST and return destinations must not be replaced by legacy bare `match` |
| 2 | Java [#709](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/709) | serial actor tickets + typed value match | Cleanup, cancellation and result publication must be single-delivery |
| 3 | Java [#815](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/815) | ADT patterns / select destructuring | Shape/ownership projection must not bypass Symbol/enum nominal identity |
| 4 | Java [#722](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/722) | serial actor + suspendable ARM_RESULT | Do not convert lexical arm results to function returns after await |
| 5 | Java [#623](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/623) | nominal tagged ADTs and exclusive match | Qualified enum identity, payload ownership and guard coverage must survive dispatch |
| 6 | Java [#296](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/296) | value-producing match expression | Reconcile with `return match` syntax and typed ARM_RESULT, not MatchStmt |
| 7 | formatter [#42](https://github.com/ores-truffle-oreslang/oreslang-format/pull/42) | select/match destructuring arrows | Preserve `do`, `return`, and typed projection delimiters |
| 8 | common [#24](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/24) | inert imports, static consts, Symbol-match fixture | Model checks are not cross-backend runtime evidence |
| 9 | common [#20](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/20) | dispatch return destination contract | ARM_RESULT and FUNCTION_RETURN are distinct typed outcomes |
| 10 | Java [#857](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/857) | circular imports and lazy init | Static reads must never enter `init()`; explicit calls must honor the barrier |
| 11 | Java [#884](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/884) | const/parser/visibility/ABI | Requires #857 runtime and resolved-value constant lowering |
| 12 | Java [#886](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/886) | blocking `do select` returns | Must propagate RETURN to caller, not discard in winning arm |
| 13 | Java [#634](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/634) | typed match and finally cleanup | Return-escape and finally precedence must be preserved |
| 14 | Java [#404](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/404) | older `do match` and select | Obsolete arm-local discarded returns conflict with #886 and #20 |
| 15 | common [#22](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/22) | canonical Symbol identity / wire keys | No Symbol-to-String coercion; all actors use canonical logical identity |
| 16 | Java [#877](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/877) | Symbol typecheck + actor snapshot hardening | Admission after immutable transport snapshot; no untrusted bypass |
| 17 | Java [#893](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/893) | tagged Symbol/String property key codec | Preserve key domains, exact scope, NFC, duplicate/byte budgets |
| 18 | Java [#892](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/892) | Java integrated const/import/symbol-match draft | Must integrate typed value dispatch before release |
| 19 | formatter [#43](https://github.com/ores-truffle-oreslang/oreslang-format/pull/43) | slim-arrow match/select formatter | Do not synthesize invalid bare dispatch or collapse `on _` |
| 20 | Java [#823](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/823) | source continuation single-delivery | Merge against #709/#722/#892 with no replay/double completion |

Related (outside this exact 20): [Java #887](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/887)
specifies future value-producing and nonblocking select semantics; it is **not**
implemented by the current static-select statement AST.

## Normative dispatch matrix

| Form | Admission | Result destination |
|---|---|---|
| `do match` | procedural statement | arm `return` exits enclosing callable |
| `return match` | value-dispatch target syntax | arm `return` completes ARM_RESULT, then outer return |
| `do switch` | procedural statement | arm `return` exits enclosing callable |
| `return switch` | value-dispatch target syntax | arm `return` completes ARM_RESULT, then outer return |
| `do select` | blocking procedural statement | winner `return` exits enclosing callable |
| `return select` | value-dispatch target syntax | winner returns typed ARM_RESULT |
| bare statement `match` / `switch` / `select` | invalid | reject at parse |
| `return do ...` | invalid | reject at parse |
| detached `do nb select` | legacy pending deprecation | **never** claim ordinary function return from callback |

**Fail-closed release rule:** If a backend does not represent a value-dispatch
arm result separately from a function return, reject `return match`,
`return switch`, or static `return select` rather than silently lowering
to procedural MatchStmt/SwitchStmt/SelectStmt. Java #892 now makes this
admission choice; #296/#634/#709/#722 are the independent typed-value
integration tracks. Never call this an implemented user-level value form
until actual executable conformance proves ARM_RESULT vs FUNCTION_RETURN.

## Cross-PR invariants

1. **Zero user execution at import.** Parse/link/ABI/static-key lookup and
   loading cycles never call guest hooks, invoke user functions, construct actors,
   or run Java host class initializers. An explicit function/constructor call
   enters the safe first-use READY barrier. Initializer reentrancy fails closed.
2. **Bounded static values.** Const graph and file import graph are separate:
   import SCC cycles may be legal while value dependency cycles are rejected.
   Reject unsupported expressions without evaluating guest code, including
   hidden short-circuit calls, integer overflow, private named-module reads,
   nonfinite floats, and unbounded aggregates. Public value hashes must cause
   transitive dependency invalidation; snapshots remain generation-stable.
3. **Canonical Symbol identity.** `#ready`, quoted literal Symbols, and
   static `Symbol.for("ready")` are nominal. String `"ready"` differs from
   Symbol `#ready` even as a record/map/class key or match/switch case.
   Duplicate logical symbol arms and keyed payloads are rejected.
4. **Actor transport.** Validate a detached snapshot after copying; enforce
   the authenticated receiver's exact tenant/endpoint/protocol export scope.
   No guest-provided scope, mutable alias, type erasure, or map-key text can
   bypass untrusted actor Symbol/enum visibility.
5. **One completion only.** For synchronous and suspendable dispatch, preserve
   typed ARM_RESULT vs FUNCTION_RETURN, defer/finally ordering, single
   continuation publication, cancellation poison, and scheduler loan expiry.
6. **Formatter roundtrip.** Formatting must preserve the explicit dispatch
   prefix (`return` or `do`), quote/escape canonical Symbols, and not rewrite
   match `on _` into a switch `default` or alter record/tuple projection.
7. **Tests are source revision specific.** Prior passing CI for an earlier
   branch head is not validation of these revisions. A failing workflow with
   zero executed steps is an infrastructure blocker, neither proof of
   compilation nor a test failure.

## Concrete hardening added to Java integration #892 during this audit

- Rejected unlowered `return match`/`return switch`/blocking
  `return select` rather than co-opting procedural RETURN semantics;
  preserved `do` dispatch, including Symbol patterns, and dynamic
  `return select from cases` as a result-bearing expression.
- Reconciled docs and tests so they do not claim a value result where
  the Java AST is only a statement; guest procedural regression remains.
- Converted signed-i64 unary overflow to language diagnostics (no host
  ArithmeticException escape); checked UTF-8 concat budget before allocating
  the result; rejected zero-divisor remainder explicitly.
- Denied sibling-module qualified access through a private named module,
  even if the nested field itself has `pub`, and added negative tests.

## Merge and verification gates

**Do not merge or set auto-merge** until the exact candidate merged tree
passes: Java/GraalVM full tests; runnable select and Symbol match/switch
fixtures; Graal Native Image + AOT/hybrid; LLVM native conformance; formatter
idempotence and parser roundtrips; actor restart/race/transport tests; static
import side-effect tests; and executable formal model/negative-mutant gates.
For `ARM_RESULT`, prove nested expression completion, await+cleanup,
finally failure precedence, and cancellation single-delivery.

Recommended coordination order:
1. Land/reconcile canonical shared dispatch #20 and Symbol contract #22/#24,
   keeping the contracts' **target** status distinct from implementation.
2. Integrate typed value match #296/#634 into actor stacks #709/#722 with
   continuation hardening #823, preserving each overlapping runtime edit.
3. Merge the blocking `do select` fix #886, ADT patterns #623/#815 and
   compile-time import/symbol-key work #857/#884/#877/#893 into #892 or a
   new tested integration head.
4. Run Java + LLVM conformance corpus and formatter roundtrip; only then
   consider rebasing/merging branch stacks individually.

CI limitation at audit time: the latest observed Java PR #892 Actions
workflow failed **with zero job steps**, and the previously available
independent source mirror did not match this PR's entire source tree.
Consequently **no newly patched revision has a verified JVM pass**.
