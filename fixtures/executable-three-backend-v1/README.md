# Executable Java / LLVM / .NET corpus v1

This suite uses the **same `.atto` bytes**, including imported files, for all
three frontends. It complements the existing scalar-core and ownership suites;
it is a small executable baseline, not a complete parity claim.

| Case | Required behavior |
| --- | --- |
| `scalar-fnc` | `pub fnc main(): int`, exit 0, empty stdout |
| `scalar` | `pub routine main(): int`, exit 0, empty stdout |
| `imported-foo` | Import a class, construct it, call a public method and private `self` method, concatenate strings, print `hello world\nhiiii 2hiiii` without a final newline, exit 0 |
| `invalid` | Reject malformed syntax with a diagnostic; no execution |

The Foo case preserves the user's program, including its private method's omitted
semicolon. Only the import extension has been migrated from `.ores` to `.atto`.
Backend-specific spelling changes, import rewrites, or source substitutions are
not allowed. Adding a narrower control case never removes the broader case.
`SHA256SUMS` pins every guest file; expected output bytes live in the Rust runner.

Run the [Rust executable runner](../../tools/executable-parity/README.md).
Positive rejection is a **gap**, even when a backend intentionally supports only
a narrow profile. Parse acceptance alone is not execution. JVM, native LLVM,
and emitted .NET CIL are separately labeled; none establishes Native Image or
NativeAOT parity for the other lanes.
