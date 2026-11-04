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

## Portable compiler-lexical differential corpus (v1)

The additional [compiler-lexical-differential-v1.tsv](compiler-lexical-differential-v1.tsv)
is a **synthetic 34-input test plan**, not a backend-pass receipt. Its exact
Git blob is \`eeed64b7d33c262b35120662386435575982a9bc\`. Each noncomment
record is tab-separated:

\`\`\`text
fixture_id  UTF16_HEX  JAVA_TOKEN_TYPES_OR_ERROR  SYMBOL_NAME_UTF16_HEX_OR_DASH  ERROR_FRAGMENT_OR_DASH
\`\`\`

- UTF-16 code units are encoded as exactly four lowercase hexadecimal digits
  each; this represents even malformed input such as a lone high surrogate,
  without corrupting an ordinary UTF-8 Git file.
- The oracle asserts *Java Lexer.scan* token types, an optional decoded and
  NFC-normalized Symbol name, or a required error-message fragment. It does
  **not** assert parser/typechecker/runtime acceptance. Every valid case ends
  in \`EOF\`; 11 cases intentionally fail lexing.
- The corpus is also vendored byte-identically in the Java PR #2379 test
  resources and the VS Code/web editor PRs, with a Git blob assertion.
  Java's **21st JUnit method** runs every case against the actual lexer;
  it remains **NOT_EXECUTED** until a private runner assigns and runs JDK 25.
- The public editors run their own scanner/scope checks on the same inputs,
  but editor tokens are not silently equated with compiler Token.Type.
  Their actual run IDs belong in [EXECUTION_EVIDENCE.md](EXECUTION_EVIDENCE.md).

[backend-lexical-admission-v1.json](backend-lexical-admission-v1.json)
identifies Java, LLVM, WASM, Cranelift, .NET, and Forge as six distinct\nbackends and separately tracks lexer,
parser, and runtime evidence. All entries start \`NOT_EXECUTED\`. No field
is set to \`PASS\` without independently reviewed exact-head CI execution.

The structural validator is
\`node scripts/validate-backend-lexical-admission.mjs contracts/editor-syntax/v1/backend-lexical-admission-v1.json contracts/editor-syntax/v1/compiler-lexical-differential-v1.tsv\`.
It verifies the exact Git blob, complete backend inventory, and mandatory
receipt metadata, and rejects fake green/skip/pending states. **This is only
a schema and consistency guard**: any future receipt link, tested SHA, and
CI steps must additionally be verified against the actual GitHub Actions job.
A plausible-looking receipt JSON alone is not proof of executed conformance.

## Cranelift parity boundary

Cranelift is an independent backend, not an alias of LLVM or Forge. The
admission **test plan** enumerates all six engines, without representing
lexer, parser or runtime support as established. The synthetic 34-case corpus
and its immutable Git blob SHA remain unchanged. Offline Cranelift receipt
comparison is explicitly `UNTRUSTED_COMPARISON_ONLY` and cannot establish
production toolchain execution without independently authenticated CI evidence.
