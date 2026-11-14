# Independent compiler observability contract v1

**TARGET ONLY — no new compiled-guest parity or JIT implementation is certified here.**

The AttoLang language specifies externally observable logging and tracing semantics, but does **not** prescribe a shared compiler, parser, typed MIR, optimizer, runtime code generator or JIT across the repositories. The common-source schema is interchange/evidence, not a shared implementation.

## Invariants shared between independent compilers

- Checked-in, stable `rid_`/`sid_` source IDs (128-bit nonzero lowercase hex) must be distinct from runtime W3C `trace_id` (128-bit) and `span_id` (64-bit).
- Build/source-identity mapping and event semantics must be reproducible and valid across compilers. The internal compact site index, code layout, native PCs, bytecode position and IR representation may differ.
- Runtime trace context flows through the logical task/actor envelope, not only through carrier-thread state.
- The language must work when no JIT is available: compile-time admitted dormant probes can be enabled when present. Deep JIT attach only exists when independently implemented for a runtime that supports it.
- Strict stripped/full guest AOT cannot invent missing function probes without a new validated/precompiled artifact. Host NativeAOT/Native Image alone does not prove guest AOT.
- An explicitly declared source-lowering dependency remains visible in status reports. In particular, current Wasm integration uses an LLVM source compiler bridge; do not describe its source parser as independent.
- Cross-backend CI may share **fixtures, output event schemas, expected diagnostics and provenance requirements**, not evidence of one compiler executing another compiler's source.
- The Rust-owned `oreslang-source.rs` and the separately implemented `oreslang-source.cranelift` must have distinct admission/result ledgers.

See the [machine contract](../contracts/v1/telemetry-independent-backend-evidence-v1.json), [source-only tests](../tests/telemetry-independent-backend-evidence-v1.test.mjs), and [language source-ID amendment #62](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/62).

## Required evidence per backend

The gate is an actual source compiler consuming a canonical `.atto` fixture, validating the checked-in IDs, lowering its own native instrumentation, producing a target artifact, running guest code, and reporting trace/log output and an exact source map. Associate source/compiler/fixture blob SHAs and target digest; verify nonzero executed steps. Keep independent host-only descriptor validation separate from compiler-produced guest instrumentation. JIT compilation must show a compiler-generated new code variant, not merely dispatching existing function pointers.

The candidate Rust [#64](https://github.com/ores-truffle-oreslang/oreslang-source.rs/pull/64) verifies routine IDs against Rust MIR and pairs a Cranelift object with a source-map sidecar, with **no runtime sites**. The LLVM [#1799](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1799) tests a C++17 host-native descriptor-admission substrate, **not LLVM IR lowering**. These are purposefully different implementations and incomplete capability slices.

Run read-only source-only contract validation using:

~~~sh
node --test tests/telemetry-independent-backend-evidence-v1.test.mjs
~~~

This result, even if passing, only validates the common schema's invariants. It does not certify Java/LLVM/.NET/Rust/Forge/Cranelift/Wasm compiled guest execution or OTel transport.

## 2026-11-14 first literal logging candidates and execution boundaries

The first `log.info("fixed literal")` candidate is intentionally a
**backend-owned lowering**, not a shared compiler implementation.

- **LLVM [#1799]:** Its own native frontend parses literal calls, requires exact
  (function, literal) to `rid_`/`sid_` registry coverage, and emits a compiler
  LLVM call to the bounded C11 telemetry ring with two immutable site IDs.
  Codegen rejects missing, wrong-kind, duplicated, foreign or stale site
  bindings, and forbids actor/suspension/Cortex-M/Wasm contexts at this stage.
  The exact native runtime/header/test Git blobs were locally compiled with
  GCC and Clang ASan/UBSan, both PASS. **LLVM SDK compiler IR and linked guest
  native execution are not yet executed**; normal CLI manifest loading is
  still absent. The C11 ring uses a carrier-local span token, not W3C IDs.
- **Java [#3096]:** Its independent Java AST binder maps immutable parsed
  `log.info` `Ast.CallExpr` identities to checked routine/site descriptors
  within non-suspending lexical spans. The existing Java atomic bounded ring
  passed a local JDK21 host stress test, but the parser-to-evaluator event
  lowering, Maven/JUnit execution, and actual guest logging are **pending**.
- **Rust [#64]:** Its own Logos/MIR-validated `atto_telemetry_ids` tool now
  supports review-only `check`, `locate` and Unix CSPRNG-backed scalar routine
  `sync` proposals, with explicit exact whole-file moves and non-overwriting
  output. `sid_` generation and log-guest codegen are not implemented and
  Cargo tests have **not run** in the available toolchain.

No cross-org private source tree was transferred. The protected-source
authorization gate and incidents #22/#77 remain unresolved; an organization
having Actions minutes is not permission to export source. Zero-step Actions
failures are not evidence of compiler test execution.

The promotion order remains **source registry → checked frontend AST/MIR →
compiler-emitted guest IR → linked native/Truffle guest runtime execution →
distinct W3C trace/span correlation → governed JIT/async/actors → authenticated
exact-head CI**. Host-runtime-only success may never skip a stage.

