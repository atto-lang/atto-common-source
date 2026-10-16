# Shared source: imported compile-time constants and Symbol dispatch

**Status:** staged cross-backend guest source fixture, NOT executed parity
evidence. Track common-source PR #24 and Java integration PR #892.

Entry: `main.ores`. Imported dependency: `constants.ores`.
Expected exact stdout: `match-1|match-2|42|init|called`.

Important invariant: `init|` must appear only **after** `match-1|`,
`match-2|` and `42|`. Module import and public constant access
must NOT trigger `init`. The explicit `Z.trigger()` invocation may
cause the first initialization.

Both backends must reject changes that:
- silently convert Symbol to String;
- fail to fold `base + 2` and `Symbol.for("abc")`;
- allow private named-module export bypasses;
- run guest code during imported constant lookup.

Do not mark conformance green until actual Java/GraalVM and LLVM
binaries execute this exact source and compare output.
