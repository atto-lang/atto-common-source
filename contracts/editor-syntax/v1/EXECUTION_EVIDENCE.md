# Editor lexical contract v1 — execution and promotion evidence

As of **2026-10-31**. This document is an audit snapshot, not a claim that
the compiler or all backends accept the source constructs in the JSON contract.

## Immutable source of truth

- Contract data: `contracts/editor-syntax/v1/editor-lexical-contract.json`
- Immutable contract Git blob: `e9dbf3b6fad5562b7ca6df631ab3c45f478480ba`
- Historical Java lexer Git blob pinned **inside** that contract:
  `bba9e091c0ad1c9b75e0c61e9dd173fcc18a236a`
- The pinned Java lexer hash describes **the historical snapshot**, not the
  modified Java candidate in PR #2379. Do not rewrite v1 in place.
- All lexical and editor preview fixtures are **not** parser, typechecker,
  native runtime, or cross-backend acceptance.

## Actual execution evidence

| Surface | Exact candidate HEAD | Executed evidence | Scope |
| --- | --- | --- | --- |
| VS Code editor PR #14 | `04e88fca2708436260a34d2d5373f82cdd3429c2` | [Actions #41254157707](https://github.com/ores-truffle-oreslang/vscode-plugins/actions/runs/41254157707): 80/80 tests; 34-case synthetic oracle and TextMate/Oniguruma | Editor scanner / grammar only |
| Web highlighter PR #9 | `ecde34edb83be861533bef9cd5fc8aba210b3f58` | [Actions #41254044515](https://github.com/ores-truffle-oreslang/html-js-css-syntax-highlighter/actions/runs/41254044515): 59/59 tests, including 34-case oracle and anti-fake-receipt gate | Web highlighter / schema only |
| Sublime PR #11 | `cecbe33cf1b67378bfae52dc17862403054844f5` | [Native Sublime #41253509349](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41253509349) and [package CI #41253509382](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41253509382): both success | Sublime syntax engine build 4215 / package only |
| Java compiler PR #2379 | `81e28c9a863a940fa32959f32dd2152b8ab98fc1` | [Focused JUnit #41253982123](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41253982123): **NOT_EXECUTED**, job `124693137523`, zero steps | 21 JUnit methods implemented, including 34-case exact oracle; **no compiler result** |
| Common-source PR #201 | `c26516afa49fe69f6f59ef993a44598fe408d301` (before this evidence note) | Private Actions admission blocked | Manifest/fixture validation pending private run |

All editor test cases are *independently executable evidence about their editor implementation*. They do **not** prove production parser/compiler behavior. Java test source is the only candidate containing the actual `Lexer.scan()` / `Parser.parse()` checks, and remains unexecuted.

## Discovered and fixed parity gap

Java `Lexer.isIdentStart(char)` accepts BMP Unicode letters via
`Character.isLetter(char)`. An earlier VS Code ASCII-only identifier scanner
and JS web highlighter's ASCII-style `\\b` word boundaries could incorrectly
treat `éreturn`, `returné`, `中eq`, `eq中`,
`πpanic`, or `gpuα` as containing a reserved keyword/operator.
Updated VS Code and web tests now verify full Unicode identifier opacity,
and separately verify that `return` after a space still tokenizes normally.
Native Sublime syntax tests also verify the boundary.

### Additional executed negative test: escaped UTF-16 Symbol pairs

Native Sublime [run #41253306962](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41253306962) **reproduced** four failures: the grammar incorrectly applied valid Symbol scope to `#"\\uD800"`, `#"\\uDE00"`, `#"\\uDE00\\uD83D"`, and `#"\\uD83D\\u0061"`. These are not accepted by the pinned Java Symbol normalization contract.

The revised regex pairs a high-surrogate escape (`D800..DBFF`) immediately with a low-surrogate escape (`DC00..DFFF`), or accepts a nonsurrogate `\\uXXXX` escape. It rejects escaped lone/reversed/incorrect half-pairs. A first revision passed the native engine but failed the static package validator because the static validator did not expand Sublime variables; the final rule inlines the same expression in both quote forms, and the static Node tests also cover all six new positive/negative inputs.

At exact candidate head `cecbe33cf1b67378bfae52dc17862403054844f5`, the [native syntax run #41253509349](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41253509349) executed 6 successful steps and [package CI #41253509382](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41253509382) executed 11 successful steps.

The grammar is still an editor preview and **cannot** prove NFC normalization or decoded UTF-8 size admission without compiling through the authoritative Java frontend.

Java draft #2379 now has 21 JUnit methods; it cannot be marked
passed until a GraalVM JDK25 execution run produces a nonzero-step Surefire receipt.

## Differential source and evidence gate (new)

The shared \`compiler-lexical-differential-v1.tsv\` contains exactly **34
synthetic source cases**. Each source is represented as UTF-16 code-unit hex,
so malformed input can be carried unambiguously. The pinned Git blob SHA
is \`eeed64b7d33c262b35120662386435575982a9bc\`, verified byte-for-byte
in the Java draft JUnit resources, VS Code, and the web highlighter.

- Real public execution: web CI run 41254044515 **59/59** pass and VS Code
  run 41254157707 **80/80** pass, each with actual CI steps and logs.
  These test lexer-*adjacent* editor properties, not full compiler token types.
- Java PR #2379 has a **21st JUnit method** that loads the same exact corpus,
  checks its Git blob, and compares actual Java \`Lexer.scan()\` types,
  normalized Symbols, and exception fragments for 23 valid / 11 negative cases.
  It **has not executed**: the latest private Actions focused run 41253982123
  ended at job 124693137523 with zero executed steps.
- \`backend-lexical-admission-v1.json\` declares the five backend identities
  and tracks **lexer, parser, runtime** independently. Each is deliberately
  \`NOT_EXECUTED\`; none is represented as unsupported or passed without
  checked evidence.
- \`scripts/validate-backend-lexical-admission.mjs\` checks the exact corpus
  SHA, backend inventory, status vocabulary, and execution-receipt structure.
  Its anti-fabrication tests were actually run by the public web job above.
  It is a **structural guard**, not cryptographic authentication of a CI run.
  Independent review must verify actual GitHub job logs and source SHAs.
- The private common-source CI itself also remains **NOT_EXECUTED**:
  [run 41254180721](https://github.com/ores-truffle-oreslang/oreslang-common-source/actions/runs/41254180721)
  failed pre-runner at job 124693729567, with zero steps.

## Case-level receipts and LLVM native-front-end gap (2026-10-31)

- The shared \`scripts/compare-lexical-case-receipts.mjs\` enforces exactly
  34 distinct results, the fixed corpus Git blob, Java-v1 token vocabulary,
  NFC Symbol name hex, and exact diagnostic substrings. It produces only
  \`UNTRUSTED_COMPARISON_ONLY\`, never a verified backend \`PASS\`.
- The \`scripts/llvm-lexical-probe-adapter.mjs\` is a bounded, shell-free
  subprocess transport. It requires a native CLI capability handshake and
  per-case UTF-16-hex JSON responses from the production compiler. If the
  interface is absent it reports \`INTERFACE_UNAVAILABLE\` with **zero**
  executed cases; no fallbacks or synthetic native token dumps are counted.
- Real public CI [web run 41262379199](https://github.com/ores-truffle-oreslang/html-js-css-syntax-highlighter/actions/runs/41262379199)
  actually executed **67 tests, 67 pass, 0 fail** for the parser/editor
  fixtures, case comparator, native-probe transport with a separately labeled
  **mock**, and negative evidence-forgery checks.
- The **test-plan** matrix verifier now rejects every \`PASS\` or \`FAIL\`
  claim regardless of how plausible its GitHub URL, SHA and receipt hash look.
  Native execution promotion requires a *separate authenticated* evidence
  schema and independent verification of GitHub CI logs. The static plan
  cannot certify its own execution.
- Native LLVM [draft PR #1251](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1251)
  now pins the exact shared fixture and documents production lexer gaps
  confirmed by source inspection: ASCII-only identifier lexer,
  coarse native token kinds, \`nb-select\` tokenization difference,
  missing Java-equivalent hash Symbol NFC source admission, and no lexical
  JSON CLI. Its integration document explicitly requires a genuine native
  driver before testing or claiming LLVM lexical parity.
- LLVM source CI job 124717820873 (run 41262286636) did get a runner,
  checkout, configure, and native compile step; its overall result was
  still pending when this evidence snapshot was authored. Those job steps
  are *not lexical-protocol execution*. Java and common-source private
  Actions still have zero-step admission failures.

## Promotion gates

1. Recover private-repository GitHub Actions admission:
   `oreslang-source.java#963`. Require runner assignment, real steps, and logs.
2. Keep the private-source transfer security gate
   `oreslang-source.java#962` enforced. The protected source policy currently
   approves **zero** cross-organization carrier repositories. A token-free
   Git-tree mirror is **still a transfer** and cannot bypass source-policy review.
3. Execute Java PR #2379 on its exact HEAD with GraalVM JDK25, retain
   `target/surefire-reports/dev.oreslang.parser.EditorLexicalParserAdmissionTest.txt`,
   and require `Tests run: 21, Failures: 0, Errors: 0, Skipped: 0`.
4. Execute common-source contract verifier at the candidate source SHA and
   retain its own nonzero-step result.
5. Separately collect LLVM, WASM (with exact LLVM compiler artifact), .NET
   Native AOT, and Forge support/admission receipts. Mark unsupported or
   unexecuted cases explicitly; do not infer parity from an editor pass.
6. Obtain independent code-owner review and satisfy applicable branch
   protection before merging the editor and compiler PRs.

No private compiler source was exported to another organization and no
repository was merged as part of this evidence snapshot.
