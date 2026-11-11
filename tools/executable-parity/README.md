# Three-backend executable runner

Initial local macOS ARM64 runner for the
[shared corpus](../../fixtures/executable-three-backend-v1/README.md), written in
dependency-free Rust. It invokes real compiler tools without a shell and never
rewrites guest source. Build each compiler first and use clean, pinned checkouts.

```bash
cargo run --manifest-path tools/executable-parity/Cargo.toml -- \
  "$JAVA_ROOT" "$LLVM_ROOT" "$NET_ROOT" \
  "$JAVA_BIN" "$DOTNET_BIN" "$CLANG_BIN" "$NEW_OUTPUT_DIR"
```

Required build products:

- Java: `target/classes` and `target/classpath.txt`; launcher `OresMain`.
- LLVM: `build/oreslang-llvmc` and its checkout's native region C runtimes.
- .NET: `compiler/Ores.Net.Compiler/bin/Debug/net10.0/osx-arm64/oresnet.dll`,
  with the .NET 10 SDK for building the small managed launcher.

The .NET lane uses `compile-structured` for scalar syntax and `compile-modules`
for the imported Foo case. It executes the generated CIL's `OresProgram.Run`
through a static host launcher. This is **managed CIL execution**, not a native
AOT claim. The launcher implements no guest behavior.

Output must be a new directory. It contains source snapshots, compiler commit
and tree IDs, binary and Java class hashes, commands, exit/timeout status,
raw stdout/stderr for each stage, LLVM IR and binaries, and `results.tsv`.
Tracked compiler source must be clean and unchanged during execution. Git
identity plus local build hashes records what was used; it does not prove
reproducible builds, CI authenticity, or remote attestation. There are no hosted
receipts or automatic changes to backend support declarations.

Each command has a 120-second deadline and each captured stream an 8 MiB limit.
Stdout/stderr use concurrently drained pipes: the strict-NIO native console
intentionally rejects regular-file stdout. Raw logs are written after capture.
Timeouts, signals, oversized output, failed links, output mismatches, and positive
compile rejections fail the suite. Every positive case requires exit 0 and exact
binary stdout. Negative cases are never executed and require a diagnostic;
LLVM rejection must emit no IR and .NET rejection no output assembly.

The suite returns nonzero until all cases pass all backends. A report with gaps
is useful execution evidence, not a passing parity gate. See the dated evidence
next to the fixtures for the initial measured baseline.
