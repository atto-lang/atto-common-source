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
| VS Code editor PR #14 | `121f2cb99f6696570ad82332780f05d94efe3e00` | [Actions #41252055310](https://github.com/ores-truffle-oreslang/vscode-plugins/actions/runs/41252055310): 77/77 tests; TextMate/Oniguruma | Editor scanner / grammar only |
| Web highlighter PR #9 | `255c47fe3aa0d90b4a88b41235fc6818a9f2c125` | [Actions #41252065486](https://github.com/ores-truffle-oreslang/html-js-css-syntax-highlighter/actions/runs/41252065486): 52/52 tests | Web highlighter / shared manifest only |
| Sublime PR #11 | `41933563c90cd0bacd5cdcfb6ae2d0f979000bed` | [Native Sublime #41252130006](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41252130006) and [package CI #41252130015](https://github.com/ores-truffle-oreslang/sublime-text-plugins/actions/runs/41252130015): both success | Sublime syntax engine build 4215 / package only |
| Java compiler PR #2379 | `ef4345e30ced0b4e9e1322f6f67ee46bae0d8159` | [Focused JUnit #41252087086](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41252087086): **NOT_EXECUTED**, job `124687528469`, zero steps | 20 JUnit methods implemented, **no compiler result** |
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

Java draft #2379 has a matching twentieth JUnit test; it cannot be marked
passed until a GraalVM JDK25 execution run produces a nonzero-step Surefire receipt.

## Promotion gates

1. Recover private-repository GitHub Actions admission:
   `oreslang-source.java#963`. Require runner assignment, real steps, and logs.
2. Keep the private-source transfer security gate
   `oreslang-source.java#962` enforced. The protected source policy currently
   approves **zero** cross-organization carrier repositories. A token-free
   Git-tree mirror is **still a transfer** and cannot bypass source-policy review.
3. Execute Java PR #2379 on its exact HEAD with GraalVM JDK25, retain
   `target/surefire-reports/dev.oreslang.parser.EditorLexicalParserAdmissionTest.txt`,
   and require `Tests run: 20, Failures: 0, Errors: 0, Skipped: 0`.
4. Execute common-source contract verifier at the candidate source SHA and
   retain its own nonzero-step result.
5. Separately collect LLVM, WASM (with exact LLVM compiler artifact), .NET
   Native AOT, and Forge support/admission receipts. Mark unsupported or
   unexecuted cases explicitly; do not infer parity from an editor pass.
6. Obtain independent code-owner review and satisfy applicable branch
   protection before merging the editor and compiler PRs.

No private compiler source was exported to another organization and no
repository was merged as part of this evidence snapshot.
