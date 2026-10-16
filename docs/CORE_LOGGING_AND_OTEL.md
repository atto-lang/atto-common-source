# Core logging and application observability contract (v1 proposal)

Status: **cross-backend target contract, not an assertion of implementation parity**. Audited 2026-10-16.
Scope: `oreslang-source.java`, `.llvm`, `.net`, `.forge`, `.wasm`, and `oreslang-otel`.

## Separation of concerns

1. **Core diagnostics** belong to the compiler, runtime, scheduler, actor/supervisor, GC, borrow checker, stdlib native implementations and host I/O. No core path imports or implicitly initializes `oreslang-otel`. Core events use **fixed numeric IDs and bounded primitive payloads**. They contain no guest objects, strings, request bodies, headers, source text, filesystem paths, or credentials. Core diagnostic policy is host/CLI owned.
2. **Application observability** belongs to user Oreslang code importing `oreslang-otel` explicitly. Its logs, metrics, and spans are application-owned. They must never be generated implicitly from a core recording operation, nor control the runtime's diagnostic level.
3. **Program output and errors** retain their functional semantics regardless of diagnostic flags. Disabling diagnostics must not hide compiler errors, uncaught program failures, stderr needed for correctness, or ordinary guest stdout. A guest-facing stdlib logging facade, if supported, must have separately documented evaluation and permission semantics; it must not expose runtime-only event IDs or control flags.

## Required fast-path properties

- Default core mode **off**. Disabled call sites take a cheap host-policy branch with zero event allocation, zero timestamp sampling, zero formatting, zero environment reads, no locks, no blocking I/O, no network exporter, and no invocation of guest code.
- Enabled core mode reserves one slot in a **preallocated bounded** recorder (or an equivalently bounded per-thread/actor shard). Do not allocate per event or wait on output pressure. Saturation increments or records a bounded drop/saturation signal; it cannot stall actor mailboxes, schedulers or I/O.
- Call sites must guard construction of expensive arguments *before* evaluation. A `log(level, expensive())` API that evaluates arguments first is **not** a zero-cost disabled call site.
- Use monotonic clocks for intervals, with backwards/overflow rejection. Validate fixed event IDs before writing. A failed diagnostic record must not change guest-visible execution or cancellation outcomes.
- Emit diagnostics to a host-owned sink, default **stderr**, only outside the hot path. Do not place diagnostic JSON on guest stdout. Crash-safe flushing is not promised by a shutdown hook; fatal/crash telemetry must be specified separately.
- Per-actor/supervisor ownership and immutable context IDs are required at actor boundaries. No unsynchronized global guest span registry, no thread-local assumption for suspended actor continuations.
- Caps apply to event count, payload size, queue memory, exporter CPU and flush work. Sensitive field redaction is mandatory at any boundary that admits dynamic values.

## Canonical CLI policy (target; not all backends implement)

| CLI switch | Environment input | Default | Semantics |
| --- | --- | --- | --- |
| `--core-log-level=off|error|warn|info|debug|trace` | `ORES_CORE_LOG_LEVEL` | `off` | Host-owned fixed-ID diagnostic severity threshold |
| `--no-core-log` | — | — | Explicitly force `off` |
| `--core-debug` / `--no-core-debug` | `ORES_CORE_DEBUG` | false | Existing bounded numeric diagnostic recorder, independent of level policy |
| `--core-perf` / `--no-core-perf` | `ORES_CORE_PERF` | false | Existing bounded numeric duration recorder, independent of level policy |

For options actually implemented, explicit CLI arguments override environment values. Unknown levels and malformed CLI values fail at the CLI boundary with an ordinary usage error; the logging hot path never parses configuration. The first two switches are **implemented in Java PR #1076** and remain reserved targets for the four other backends; the existing Java `--core-debug` and `--core-perf` switches retain their independent behavior. Existing `--core-debug` and `--core-perf` flags must keep their meaning during migration.

The `oreslang-otel` library is imported in userland and chooses its own caller-owned severity threshold and exporter. It does **not** read the above CLI switches by default. No `--core-otel` or automatic OTel exporter is implied.

## Export and interoperability

- Retain stable versioned schemas (`ores-core-perf.v1`, `ores-core-debug.v1`, and Java's `ores-core-log.v1`). Preserve fixed event IDs; map IDs to text only in cold-path export. Other backends must independently implement and verify `ores-core-log.v1` before claiming parity.
- Use numeric timestamps/durations without rounding through a floating-point representation. Enforce numeric and string encoding limits; no user-controlled dynamic payloads in core events.
- Core events are **not** OpenTelemetry/OTLP. An explicit, out-of-process adapter may translate exported core records; never make OTel an unconditional dependency of the runtime.
- Current `oreslang-otel` exports synchronous JSON Lines to stdout and is not OTLP. Callers must guard `should_log` **before** constructing expensive bodies; logging must not execute in scheduler/mailbox/GC critical sections.

## Backend audit snapshot (2026-10-16)

| Backend | Audited implementation | Remaining gate |
| --- | --- | --- |
| Java/Graal | `CorePerf`, `CoreDebug`, `CoreLog`: independent 8192-entry primitive recorders; `--core-log-level` / `--no-core-log` with environment override; stderr on JVM shutdown. Numeric events include async-I/O failures and actor dispatcher initialization failures. | Exact 96-blob production source mirror: JDK 25/Maven 43/43 logging+CLI tests passed; combined guest OTel smoke: 44/44. Full source tree, native-image, allocation/latency benchmarks and all-backend parity remain open |
| LLVM | Experimental compiler/runtime subset, actor tracing tests exist | No parity claim for user logging, core CLI policy or exporter; implement and prove feature admission |
| .NET | Single-function arithmetic compiler bootstrap and mailbox prototype | Core logging + OTel import unsupported; implement Native AOT-safe bounded recorder before enabling |
| Forge | C++ arithmetic compiler bootstrap and mailbox prototype | Core logging + OTel import unsupported; implement native bounded recorder and CLI parsing |
| Wasm | Pure no-import `() -> i64` guest, zero guest I/O capability | Guest logging must fail closed in this profile. Host diagnostics can be CLI controlled, never implicitly grant guest imports |
| oreslang-otel | Explicit user module with `should_log`, spans, metric observations, JSONL | Synchronous stdout and serialization costs; no OTLP/W3C propagation; use only in user code with guard |

## Conformance acceptance

1. **CLI matrix:** off, each threshold, invalid threshold, env-only, CLI override, explicit disable, and unknown option; verify exit codes.
2. **Disabled critical path:** 0 event objects, 0 formatting, 0 clock calls, 0 I/O, 0 guest callbacks, no actor stall or changes to exceptions/cancellation.
3. **Enabled pressure:** capacity and drop accounting under simultaneous producers; no overflow or partially published rows; bounded time/memory and predictable shutdown.
4. **Security:** cannot print guest secrets or user-supplied arbitrary text through core event paths; guest stdout remains clean; disabled diagnostics do not hide real failures.
5. **Backend admission:** unsupported guest stdlib/OTel imports fail closed without host fallback, especially no-import Wasm.
6. **Userland OTel:** the import is optional, logging thresholds are caller-controlled, message construction is guarded, IDs stay actor-owned, and JSON/UTF-8/int64 constraints survive tests.
7. **Performance:** publish microbenchmarks of disabled per-call overhead and enabled single/multithread throughput plus whole-program regressions, with the exact backend tree SHA and CI run attached. Do not declare five-backend parity until all five pass applicable gates.

## Logging-disable lifecycle and Java verification hardening (2026-10-16)

The Java severity recorder now treats `--no-core-log` and `off` as
**export revocation**, not merely a gate on future events: disabling drops the
bounded current buffer and prevents JVM shutdown output from that session.
Re-enabling creates a fresh empty recorder. Numeric fixed-ID data never
crosses into userland `oreslang-otel`.

The verified test sequence is:

- [46/46 Java integration tests after lifecycle hardening](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-web-server.ores/actions/runs/38925225748)
- [47/47 Java integration tests, including disabled-path thread-allocation regression](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-web-server.ores/actions/runs/38926892754)

The allocation regression runs 300,000 disabled record/gate calls with
`ThreadMXBean` instrumentation, calibrating the fixed bookkeeping overhead
of allocation-counter reads. This verifies no **per-event allocation scaling**
on the tested JDK25 HotSpot runner, not a cross-backend microbenchmark.

The mirror verifies 96 exact production/test/stdlib blob SHAs against the
Java PR head, and executes the original 9-line `oreslang-otel` guest smoke.
An attempted full 614-blob Git-tree mirror was not completed because the
connector blocked a batch of source test files. No complete-tree SHA claim,
native-image result or other-backend parity is made.

## Next implementation order

First lock this contract; harden Java's existing recorder and test CLI precedence. Next add isolated native recorders/CLI admission to LLVM, .NET and Forge without implying compiler feature parity. Wasm retains no guest logging until an explicit capability-bearing host ABI is reviewed. Preserve `oreslang-otel` as an opt-in user module throughout.

## Java implementation verification (2026-10-16)

Reference implementation: `ores-truffle-oreslang/oreslang-source.java#1076`.
The severity logger is host-owned, deliberately separate from `CorePerf`,
`CoreDebug`, and from user `oreslang-otel`. Default `off` uses one volatile
state check without event creation, clock reads, formatting or I/O. A bounded
recorder captures fixed names and numeric values only. Guest logger imports
are never injected into the core runtime.

Private fallback Actions evidence:

- [Focused exact-five-blob JDK 25 suite: 18/18](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-web-server.ores/actions/runs/38920090938)
- [Java production module exact-96-blob integration: 43/43](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-web-server.ores/actions/runs/38921595174)
- [Same module + actual `oreslang-otel` guest JSONL smoke: 44/44, 9 JSON records validated](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-web-server.ores/actions/runs/38921925326)

**Important qualification:** the private test repository contains 96 exact
blobs from Java's production module, selected tests and required standard
library files, plus a verification-only OTel guest test. It is not an exact
mirror of Java's entire 614-blob repository, nor evidence for native-image,
actor carrier, LLVM, .NET, Forge or Wasm parity. The JDK test workflow
explicitly disables the native-thread-unix Maven profile because those build
scripts were not included. No native image or throughput benchmark passed by
virtue of these runs. The OTel guest output uses the library's proprietary
`oreslang-otel.v1` JSONL schema, **not OTLP**.
