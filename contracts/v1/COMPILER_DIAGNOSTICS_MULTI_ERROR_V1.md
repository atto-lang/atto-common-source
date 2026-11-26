# Oreslang compiler diagnostics v1: five independent errors and actionable source traces

**Status: proposed shared compiler/CLI contract; NOT implemented or backend-certified.**
**Scope:** source compilation, `oreslang check`, `oreslang build` and editor/CI diagnostic presentation.
This document does not change guest runtime exception or actor-hop tracing; see the independent bounded causal runtime tracing program.

## Existing protocol compatibility

- The canonical public CLI is **`oreslang`**, not `ores`. The CLI is a process/IDE interface; real diagnostics originate in backend lexers, parsers, import resolvers, type/effect and ownership checkers.
- Preserve the CLI's existing diagnostic JSON **`version: 1`** envelope: `{version,ok,diagnostics}`, 1-based source line/column, and existing `path`, `range`, `severity`, `source`, `message` fields. `code` is already optional.
- Existing JSON/JSONL clients must continue to parse outputs. Additional structured trace metadata is optional/additive in JSON v1; do not change JSONL record shape or add novel record types without a negotiated protocol version.
- Never synthesize extra diagnostics by dividing, duplicating, or reinterpreting a single error string in the Rust CLI. Backends own recovery, independence, source spans, and error codes.

## Public behavior (target, not current implementation)

```sh
oreslang check app.ores                       # up to 5 independent primary errors
oreslang build app.ores                       # same default for compiler failures
oreslang check --max-errors=1 app.ores        # 1 primary error
oreslang check --max-errors=10 app.ores       # up to 10
oreslang check --max-errors=0 app.ores        # all feasible, with protective resource caps
oreslang check --format=json app.ores         # same v1 JSON envelope, array of diagnostics
oreslang check --format=jsonl app.ores        # same per-diagnostic v1 JSONL contract
```

The flag examples are **future syntax**, not a claim that the current CLI accepts them. Canonical CLI argument ownership and `flags-2-env` schema require integration review; do not read ambient inherited configuration as a permission grant. An omitted flag defaults to **5 primary, independent errors per invocation**. The setting counts `severity=error` **primary diagnostics**, not notes/help/related spans or warnings. Warnings do not consume the error budget; warnings and related metadata have separate resource caps. Invalid, negative, noninteger, overflowing or excessive flags fail with a usage error; enforce a documented administrator-adjustable maximum (suggested 1000), also for `0`. A `0` request means no user-selected count cap but **never disables hard time, memory, depth or output-size budgets**.

Every build with one or more primary errors fails atomically: no runnable binary, no claimed successful guest compile, and no publication of partial artifacts. Do not execute guest code during `check`. Runtime/external-tool/infrastructure failures are distinct from guest-source diagnostics and must not be disguised as compiler rejects.

## Source provenance and traces

Each diagnostic must have:
- a stable **category/code** (e.g., `ORES-TYPE-001`, `ORES-IMPORT-001`, `ORES-BORROW-004` below are illustrative, not allocated registered IDs), severity, source file, half-open source range, and human message;
- zero or more ordered **related source ranges** and explanations, referencing *actual* compiler-owned facts: import declaration -> referenced module; binding declaration -> conflicting use; borrow origin -> suspension -> use; effect declaration -> callsite -> propagation; actor state declaration -> escaped reference;
- optional **help** and concrete **suggestion/replacement** only when the source edit is mechanically justified. Unsafe or speculative fixes are text help, not auto-applicable edits;
- an explicit indication when any trace, import chain, related-location list, or output was truncated.

Trace edges are provenance, **not invented synchronous stack frames**. Compilation-source traces must not be conflated with existing runtime `await`/actor/RPC causal error stacks. Compiler internal panics are a separate `INTERNAL` category with a reproducible crash ID, safe high-level location and opt-in sanitized internal tracing; never present a Java/C++ host stack as an Oreslang source stack. Preserve actual guest Unicode/UTF-8 offset semantics, correct CRLF and tabs, and convert to 0-based UTF-16 only at the LSP boundary. Redact secrets and absolute internal build paths when exporting diagnostics or CI artifacts.

**Illustrative** backward-compatible JSON v1 diagnostic with optional fields:

```json
{
  "version": 1,
  "ok": false,
  "diagnostics": [
    {
      "path": "src/worker.ores",
      "range": {
        "start": {"line": 28, "column": 3},
        "end": {"line": 28, "column": 21}
      },
      "severity": "error",
      "source": "oreslang",
      "code": "ORES-BORROW-004",
      "message": "mutable loan remains live across await",
      "related": [
        {
          "path": "src/worker.ores",
          "range": {
            "start": {"line": 25, "column": 9},
            "end": {"line": 25, "column": 16}
          },
          "message": "loan originated here"
        }
      ],
      "help": "end the mutable loan before suspension"
    }
  ]
}
```

Optional `related` and `help` are **candidate extensions**; implementations must confirm acceptance with current CLI/LSP readers. Exact code allocation requires a single registry with immutable meanings and known backend support. If the compiler lacks a reliable end span, return a defensible point range rather than guessed text widths.

## Recover and keep checking — without cascaded nonsense

1. **Lex/parse:** recover at *grammar-aware* declaration/statement boundaries and balanced delimiters, preserving source spans; avoid scanning into quoted strings/comments/templates and fabricating later statements. Use explicit invalid AST nodes to mark recovery.
2. **Imports:** traverse reachable modules in a deterministic, canonical order; report the actual import site, cycle edge or missing module, with bounded chains. Independently compilable modules can continue. A broken import must not produce hundreds of missing-symbol diagnostics in importers.
3. **Type/effect/ownership:** propagate a typed poison/unknown result only as an **error-suppression token**, not as the language's semantic `any`/`unknown`; suppress dependent diagnostics but continue checking sibling subtrees, declarations, modules and independently resolved callsites. Ownership and effect checks must **never** be skipped in valid regions just because another region failed.
4. **Deduplicate:** define root-cause identity by actual compiler node/symbol and category, not message text alone. Related locations are attached to the primary issue instead of becoming extra primary errors. Identical text on separate independent sites remains separately reportable.
5. **Budget:** deterministically order primary errors by canonical source order and stable category tie-breaks; use deterministic compilation traversal and bounded buffering so `--max-errors=5` yields the same five for identical source/config/toolchain. Stop emitting at the count limit, but do **not** claim the total number of hidden errors without finishing discovery. Display **"5 errors reported; additional errors may exist"** when the budget stops discovery. Preserve a reliable exact total only if actually counted.
6. **Fatal boundary:** unrecoverable lexer/input/dependency corruption or compiler-internal failure may abort early, with a distinct honest reason. Never invent five errors to meet the default.

Hard bounds should cover parser synchronization work, recursion depth, import graph cycles/size, max diagnostics, related spans per error, message bytes, output bytes and trace depth. Limit exceeded produces a clear truncation/limit marker without turning source errors into success. Normal source failures remain nonzero and never emit artifacts.

## CLI, editors and CI

- CLI formats: compact text with source excerpt/caret, stable diagnostic ID, "why"/"where"/"help", plus bounded related-location arrows; existing versioned JSON and JSONL; optional SARIF mapping in a separate compatible release.
- CLI must pass the requested limit to the selected compiler. It **cannot** recover additional errors by re-invoking the compiler on mutated source or by parsing stderr heuristically.
- `oreslang check` must remain free of guest execution and guest side effects.
- LSP reuses compiler data, preserves per-document grouping and stale-result/version fencing, converts 1-based compiler coordinates correctly to 0-based UTF-16, and publishes no bogus locations.
- Keep compiler-source diagnostics separate from CLI discovery failures, GitHub Actions **zero-step runner admission** failures, linker/Clang/Maven failures and actual source-check failures. Attach source Git tree/fixture identity, selected backend, compiler SHA and toolchain for parity gates.
- No Python tooling: use Rust for common harnesses, backends' implementation languages for compiler code.

## Acceptance tests (real compiler, exact source, not fixture-only)

| Case | Expected result |
|---|---|
| 6 independent errors across 3-4 imported files, default | 5 real primary errors, stable order; nonzero, no guest execution/artifact; honest truncation |
| Same fixture with `--max-errors=1` | 1 real primary diagnostic |
| Same fixture with `--max-errors=10` | All 6 real independent diagnostics |
| Missing imported symbol causing many dependent uses | 1 root-cause issue plus related locations; no cascade spam |
| Bad syntax in one function with good unrelated functions | Recovery allows independently valid siblings to be checked |
| Two true independent errors on same line | Both are counted; not deduplicated by text/line only |
| Mutable borrow crossing `await` | Origin and suspension positions from actual static analysis |
| Actor-private state escape | Source owner/escape provenance; ownership denial still enforced |
| Import cycle + unrelated type error | bounded import path/cycle diagnostics; independent error survives if safely recoverable |
| UTF-8, Unicode supplementary code point, CRLF, tabs | Correct compiler ranges and LSP UTF-16 conversions |
| Identical source under two runs/paths/hash seeds | Stable error category, ordering, related ranges and normalized JSON |
| Incomplete/malformed source stressing recovery | No hang, crash, runaway memory, or false acceptance |
| Internal compiler crash / missing compiler / zero-step runner | Distinct failure classes, never reported as passed rejection |
| Valid program with warnings | Build/check succeeds; warnings do not consume error count |

Each backend (Java/Graal, LLVM, .NET, Wasm, JS, Forge) reports **supported/pending** per tested check instead of silent skip/pass. The conformance harness should execute byte-identical multi-file fixtures against pinned real compilers and compare stable error categories and independence, not backend-specific message punctuation.

## Implementation rollout

1. **Shared contract and fixtures:** review stable codes, v1 additive field compatibility, limits, ordering, source range/trace semantics and 3-4 imported-file corpus.
2. **Java/Graal pilot:** introduce backend-native `DiagnosticCollector` and phase-aware parser/import/type/borrow/effect recovery; preserve existing compiler behavior when `--max-errors=1` and test real `--check`.
3. **Rust CLI/LSP:** plumb `--max-errors` and optional trace presentation through actual compiler output while retaining v1 JSON/JSONL contracts, no separate source parser.
4. **LLVM pilot, then .NET/Wasm/JS/Forge:** independent frontend implementations emitting compatible categories and source trace semantics, with explicit unsupported status where needed.
5. **Gate promotion:** exact-head compiler execution, cross-module negative/positive fixtures, JUnit/native build/Cargo execution receipts, correctness and resource limits. Source-only contract tests do not certify compiler functionality.
