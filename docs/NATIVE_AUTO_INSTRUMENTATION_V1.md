# AttoLang native automatic instrumentation v1 (proposal)

**Status: DESIGN/CONFORMANCE TARGET ONLY — no backend parity or working automatic instrumentation is claimed.**
Date: 2026-11-12. Target: Java/GraalVM, LLVM, Wasm, Forge and .NET Native AOT.

## Decision

Provide **zero-application-code tracing** for supported Atto-owned HTTP, network/I/O,
actor, scheduler, database and messaging libraries. No monkey patching, reflective
agents, bytecode rewriting, source-level wrappers, dynamic method replacement,
runtime generated code, or user-installed decorators. Instrumentation is an
independently switchable compiler/runtime capability, **disabled at runtime by
default**. The public implementation, formatting and exporter composition should
live in native `.atto` whenever the language can safely express it.

This is a **new application-instrumentation plane**. It does not change the
independent host-owned `CorePerf`, `CoreDebug`, `CoreLog` or `ores-core-log.v1`
diagnostic semantics in [CORE_LOGGING_AND_OTEL.md](CORE_LOGGING_AND_OTEL.md).
Core diagnostic recorders do not start spans, import `oreslang-otel`, read guest
objects, or export OTLP. `oreslang-otel` remains an explicit legacy/userland
library and is *not* silently initialized. Exporting auto spans requires an
explicit host-controlled tracing/export policy, not merely core diagnostic flags.

## Architecture and placement

1. **Semantic compiler pass**: register immutable, build-time descriptors for
   typed callable entry/exit, async suspend/resume and selected boundaries.
   The pass inserts probe calls before backend lowering or in equivalent verified
   typed IR. Static IDs map to symbol/source location/operation descriptions in
   cold-path metadata. AOT sees all probes, metadata and context slots in advance.
2. **Trusted runtime boundary probes**: actor spawn/admit/dequeue/dispatch/end,
   supervisor CONTROL, Future/continuation transitions, HTTP route handler,
   HTTP outbound attempt, TCP connect, nonblocking read/write completion,
   datastore driver command, and std messaging send/receive. Emit semantic
   spans for logical operations, **not a new span per socket byte/readiness event**.
   Low-level socket/readiness counters belong primarily to metrics/diagnostics.
3. **Context carrier**: immutable TraceContext travels with an actor/message
   envelope and continuation frame, not guest payload, mutable globals or a
   carrier-thread local. On cross-domain transport, explicitly validate
   propagation authority; attach no capabilities, pointers or private state.
4. **Native collection**: bounded per-actor/per-worker shards with a nonblocking
   offer, monotonic timing, drop accounting, capped attributes and memory,
   no synchronous exporter and no guest callbacks from probes. A separate
   stdlib collector/exporter drains asynchronously; never while holding an actor
   critical loan, mailbox lock, I/O reactor, or supervisor priority path.
5. **Interoperability**: W3C Trace Context `traceparent` / `tracestate` for
   trusted HTTP/network boundaries; OpenTelemetry-compatible spans/attributes
   and OTLP export via a hosted `ores.std.telemetry` adapter. OTLP is opt-in
   and independent of vendor-specific SDKs and the existing local JSONL format.

## Build and runtime policy (target CLI surface, NOT implemented)

| Policy | Default | Semantics |
| --- | --- | --- |
| Build `--instrument=none\|boundaries\|functions` | `boundaries` | `none` emits no probes; `boundaries` emits known std/runtime probes; `functions` also emits callable/continuation probes |
| Runtime `--trace=off\|on` | `off` | Off never records, reads a clock or exports; on enables sampling and collection only for probes compiled into this artifact |
| `--trace-sample-rate` | policy-set (e.g. 1%) | Bounded root sampling; honor remote sampling policy through an explicit trust decision |
| `--trace-exporter=none\|otlp\|file` | `none` | No network or file egress without distinct host permission |
| `--trace-max-buffer-events` | bounded (e.g. 8192) | Preallocated capacity; overflow increments drop metric, never stalls guest execution |

A **runtime-off capable** build still pays a predictable branch/probe-site code
size cost. It cannot truthfully claim *zero CPU instruction overhead*. A build
with `--instrument=none` removes instrumentation entirely but **cannot turn
tracing on without recompilation**. Strict hard-real-time profiles should use
`none` or separately certify bounded probes and export isolation. Configuration
is parsed once using the project's approved CLI policy, not at every hook.

## Public API target (illustrative; not compiled)

- `ores.core.trace`: `TraceId` (128-bit), `SpanId` (64-bit),
  immutable `TraceContext`, `SpanKind`, `SpanStatus`, and no-op span interface.
  Freestanding: does not import `ores.std`, transport, clocks or exporters.
- `ores.core.instrumentation`: compiler/runtime-only fixed hook IDs,
  typed context handoff and a bounded, capability-controlled recording ABI.
  It is **not** a guest escape hatch for core diagnostics.
- `ores.std.telemetry`: `start_span`, `with_span`, `current_context`,
  `is_recording`, `add_event`, `set_attribute`, `record_error` and an
  idempotent, scope-bound `finish`, implemented in .atto where possible.
- `ores.std.telemetry.propagation`: validated `inject`/`extract`,
  header-byte/count caps and W3C IDs; no arbitrary header, cookie or baggage
  capture. Cross-service policy must distinguish incoming untrusted contexts
  from local application authority.
- `ores.std.telemetry.otlp`, `ores.std.metrics`, `ores.std.logging`:
  opt-in exporter, metrics and trace-correlated logs respectively. Exporters
  are never part of `ores.core` and require egress capabilities.

Function and method names are snake_case. No new language keyword is required.
Manual spans add **semantic business events**; automatic stdlib spans never
require manual API calls or attributes in userland.

## Span semantics

- HTTP inbound: a `SERVER` span at request admission, ending at defined
  response-completion/error boundary. Route template and method are low-
  cardinality names; do not use raw URLs, query strings or body content.
- HTTP outbound: a `CLIENT` span per actual send attempt and its failure/status;
  explicit retries and redirect attempts follow current OTel HTTP conventions.
- Database: a `CLIENT` span at a known std driver execute/transaction boundary.
  Vendor SQL parsers or arbitrary FFI calls are **not** magically instrumented.
  Do not capture query text, bind values or credentials by default.
- Actors: admission/enqueue/dequeue and handler execution correlate to the
  currently active context; immutable message metadata preserves causality
  through move/borrow-checked transports without serializing capabilities.
  For fan-out/batching/multi-parent messages, emit `SpanLink` relationships
  according to applicable OTel messaging conventions rather than inventing
  a single parent. Never block a supervisor CONTROL path.
- Futures/async: a continuation resumes with its captured trace context even
  on a different OS carrier; cancellation, `throw`, `raise`, `panic`, timeout,
  and restart/generation fencing conclude affected spans **exactly once** and
  cannot change failure propagation. Queue wait, execution and I/O time should
  be distinguishable.
- Functions: optional compiler-selected entry/exit spans using stable logical
  callable IDs (including error/defer paths). Inlining and tail calls may retain
  a logical probe only when stated by the profile; no exhaustive stack tracing
  in the default `boundaries` profile. Exclusion lists prevent recursion into
  collector, allocator, clock, sanitizer, scheduler and exporter internals.

## Safety and privacy

- Do not record raw HTTP bodies, cookies, tokens, Authorization, SQL bind data,
  guest objects, payload bytes, addresses/paths or arbitrary stack/local values
  by default. Use vetted low-cardinality attributes with length and count caps.
- Remote trace headers are untrusted identifiers, never security capabilities.
  Validate exact size/format, reject all-zero IDs, bound `tracestate`, and never
  let a remote sampling hint bypass local budgets or export permissions.
- Per-domain telemetry authority must forbid cross-tenant leaks. Hot reload,
  actor restarts and retired actor generations cannot publish stale contexts.
- Monotonic time for intervals; timestamp correlation uses a separately
  calibrated wall-clock origin. No elapsed-time arithmetic on wall-clock time.
- Off means no event allocation, formatting, timestamp reads, locks, I/O,
  guest callbacks or changes to observable results. A saturated collector must
  drop records, never wait.
- In native AOT/Wasm no dynamic code generation, reflection search, JS patching,
  host agent or unapproved import is allowed. A no-import Wasm profile must fail
  closed rather than gain network/clock imports from tracing configuration.

## Coverage limits

Automatic visibility is guaranteed only at **compiler-instrumented functions and
Atto-owned/registered runtime or stdlib boundaries**. Arbitrary third-party
native libraries, embedded DB engines, syscalls bypassing the trusted provider,
and external services cannot be traced without a verified adapter. Those gaps
must appear explicitly in capability reports; do not claim 'all calls' coverage.

## Conformance gates

The machine-readable companion is
[`contracts/v1/native-auto-instrumentation-v1.json`](../contracts/v1/native-auto-instrumentation-v1.json).
Required backend evidence includes:

1. Source-only contract validation **separately** from actual .atto compilation,
   function lowering, generated artifact inspection and guest execution.
2. Off/none/capable/on matrix: off has no events, no timing or per-event
   allocation; none has no inserted probes; on generates correctly nested spans.
3. HTTP server/client and actor/Future parent/links across suspend/resume,
   cancellation, panic, restart, retries and multiple concurrent workers.
4. Strict W3C IDs, header limits, untrusted provenance, HTTP route-cardinality
   limits, redaction and permission denial without behavior changes.
5. Backpressure: bounded memory, nonblocking hot path, counted drops and
   exactly-once teardown; exporter failure cannot affect guest outcomes.
6. Target-specific real guest execution: GraalVM JIT and native image, LLVM O0/O2
   plus sanitizers, actual Wasm worker, Forge, and .NET Native AOT. Include
   compiler/source SHAs, artifact digest, exact commands and stepful test logs.
   Host-only tests and synthetic traces are NOT EXECUTED backend evidence.

## Upstream references

- [OTel tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OTel tracing SDK and sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/)
- [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [OTel messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
