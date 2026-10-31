# Editor lexical contract v1 (compiler-pinned snapshot)

**Scope:** shared source-highlighting evidence, **not** parser acceptance or executed five-backend conformance. The canonical file is [editor-lexical-contract.json](editor-lexical-contract.json). The `reservedWords` inventory was extracted from the pinned Java `Lexer.java` `KEYWORDS.put(...)` table, **not** guessed from prose or editor keyword lists.

Three consumer repos must vendor the **identical Git blob**, pin its Git blob SHA in local tests, and never fetch private source from another organization during CI:

- `ores-truffle-oreslang/vscode-plugins`
- `ores-truffle-oreslang/sublime-text-plugins`
- `ores-truffle-oreslang/html-js-css-syntax-highlighter`

Semantics:
- `lexer-reserved` = current pinned Java lexer emits a reserved token, not that the parser accepts any use.
- `lexer-tokenized-only` = a token exists (`%` and `^` included), not an accepted expression.
- `lexer-split-NB-SELECT` = the source spelling `nb-select` becomes **two** compiler tokens; an editor can color the full spelling.
- `editor-preview-only` = proposed `critical-read`, `critical-write`, `transform-pipe` can be recognized for readability without claiming compiler acceptance.
- `symbol` = `#ready`, `#'with spaces'`, `#"quoted value"`, never `@ready`; quoted bodies remain opaque.
- `runtimeGlobal` = the existing magenta/royal-blue editor style convention treats `recover/defer/throw/raise` as one special scope, even though they are lexer keywords.
- `plain` = must not be incorrectly highlighted as reserved in the fixture (e.g. `owned`).
- `forbidden` = keyword-looking contents of nested comments, strings or templates must not produce tokens.

**Important outstanding mismatch:** the pinned Java compiler lexer reserves `eq/neq/is`, `isoactor`, and `null`, and emits `%` and `^` tokens. Some editor tests previously claimed these were legal identifiers or deleted operators. They must not assert compiler acceptance or removal without a separate parser execution fixture and exact compiler SHA.

## Updating the contract

1. Record an immutable new compiler lexer **blob** SHA, token enum blob SHA, and grammar blob SHA.
2. Derive and sort the actual `KEYWORDS.put` vocabulary, then revise fixtures with a clear lexer-vs-parser evidence level.
3. Run `node tests/verify-editor-lexical-v1.mjs` and the three editor-local test suites on a **byte-identical copy**.
4. For parser acceptance/rejection, run the actual Java compiler and other backends against exact source fixtures and append independently verified evidence; do not upgrade the lexical document into a parity certificate.

All assertions fail closed; missing CI steps, absent compilers, or unsupported backends are **not** passes.
