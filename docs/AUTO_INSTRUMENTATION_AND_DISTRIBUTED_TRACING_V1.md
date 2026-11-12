# AttoLang zero-code instrumentation and distributed tracing v1

**Status: proposed, not implemented.** This refines [Instrumentation API v1](INSTRUMENTATION_API_V1.md) and the machine-readable `contracts/v1/instrumentation-api-v1.json`. The manual `Trace.begin_span/finish_span` additions in Java PR #2989 are **not** automatic instrumentation. Real Atto guest execution, backend parity, export and distributed traces remain **NOT EXECUTED / NOT IMPLEMENTED** until separately proven.

## Decision: automatic, AOT-safe and off by default

AttoLang applications must require **no tracing imports, decorators, middleware, annotations, application hooks, custom source transformation or calls**. All auto-instrumentation is installed before or during compilation and follows typed, ownership-checked execution semantics.

**No monkey patching, runtime reflection, Java agents, bytecode rewrite, linker interception or arbitrary host callbacks.** The target is one compatible semantic contract across Java/Graal, LLVM, Wasm, Forge and .NET AOT; implementation and host mechanisms remain backend-specific.

Three trusted producers cover distinct events:

1. **Compiler:** insert typed no-effect, compiler-internal probe intrinsics at selected callable entry and *every* normal/exceptional/async exit. Select call sites from module/canonical symbol metadata in the compiler, not application annotations. Lower the same probe ABI on every target.
2. **Runtime:** use internal actor/mailbox/task/channel/scheduler/supervisor/critical-section state machine boundaries, carrying context with logical continuations rather than host carrier threads.
3. **Native std-lib:** instrument built-in HTTP SERVER/CLIENT, nonblocking TCP, filesystem, DB-driver and messaging semantics at their actual Atto-owned implementation boundaries. Unknown FFI/native driver internals are **not** auto-instrumented; integrate only explicit approved adapters.

Call-site and runtime events may feed the same **versioned bounded observation transport**, but **do not collapse the security boundaries**: core-only fixed numeric diagnostics must stay host-owned and must not automatically instantiate or import `oreslang-otel`. A privileged, explicitly enabled, sanitized translator may emit approved semantic spans to a separate hosted telemetry-export actor. This preserves [core logging and observability policy](CORE_LOGGING_AND_OTEL.md).

## Build profiles and operator controls

| Build profile | Instrumentation sites in binary | Runtime startup default |
| --- | --- | --- |
| `--instrument=none` | None of the optional sites: stripped AOT | off, cannot enable absent sites |
| `--instrument=boundaries` | HTTP, TCP, files, actors, tasks, channels and other known semantic boundaries | off; can turn on boundaries |
| `--instrument=calls` | Boundaries plus selected Atto function/method entry/exit sites | off; runtime can select boundaries or calls |
| `--instrument=full` | Diagnostic sites including detailed queue/critical/async events, subject to safety budgets | off; runtime can select any compiled subset |

**Recommended release default:** *trace-capable* with `--instrument=boundaries` baked in, but collecting/exporting **off at runtime**. The separate `--instrument=none` profile removes all optional probes for embedded/hard-real-time or the lowest overhead builds. Runtime cannot add call sites which were never compiled.

Proposed `.ores.pkg.toml` (not yet a recognized implementation):

```toml
[telemetry]
enabled = false
mode = "boundaries"
sampling_rate = 0.05

[telemetry.auto]
functions = false
http = true
network = true
database = true
actors = true
tasks = true
channels = true
filesystem = true

[telemetry.export]
protocol = "otlp"
```

Operators can opt in with proposed `--telemetry=boundaries|calls|full` and a sampling flag. The entrypoint reads config once through the existing permission-aware CLI; malformed config is a startup error, not an error on the hot path. Compile-time coverage is the **upper bound**. Runtime policy is hot-reloadable only if a generation-safe implementation is explicitly added; startup enablement alone already needs **no application code change**.

Support standard OpenTelemetry config inputs including `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_SDK_DISABLED`, `OTEL_PROPAGATORS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and per-signal traces endpoint. **OTEL environment variables never grant filesystem/network/exporter permissions.** Explicit SDK disabling prevents recording/export; independently enabled propagators can still preserve an incoming valid context in accordance with OpenTelemetry. Distinguish *telemetry disabled* from *valid unsampled remote parent*: when propagation is enabled by policy, a nonrecording span still carries a `SpanContext`.

## Internal AOT probe ABI (illustrative, NOT guest syntax)

```text
call_site_id := stable compiler numeric identity from namespace + symbol + kind
decision := trace.should_record(call_site_id, logical_context)
if decision.record:
    token := trace.enter(call_site_id, span_kind, logical_context)
execute_original_guest_function()
on_return_or_throw_or_raise_or_cancel: trace.exit(token, outcome, duration)
on_suspend: trace.suspend(token, logical_continuation_id, actor_generation)
on_resume: trace.resume(logical_continuation_id, actor_generation)
```

This is a description of the intended typed HIR/MIR transformation, not an existing runtime API. It must be optimized into a cheap enable-bit branch at disabled call sites. No guest callback is invoked, and dynamic string/attribute construction, clock reads, spans, allocations, locks and I/O do not occur when disabled. A selected/recording path writes only fixed-size or bounded fields to a preallocated shard, with stable numeric labels resolved **after** recording in the cold exporter. The bytecode/LLVM/native output may differ, but visible behavior cannot.

The compiler must prove all return/throw/raise paths preserve the exact original effect: `panic` sends the CONTROL notice and cannot be intercepted by a recorder; fatal process termination is not guaranteed to flush a completed span. `trap` results, timeouts, mailbox admission, actor priorities and ownership must remain equivalent. **Tracing itself is neither a guest-visible effect nor a new capability grant.**

## Semantic span taxonomy, not duplicate low-level spans

| Boundary | Span kind | Detail policy |
| --- | --- | --- |
| HTTP receive and complete | SERVER | One span per request; route template, HTTP method/status |
| HTTP outgoing request | CLIENT | One span per logical request, not one per partial TCP write |
| DB query | CLIENT | Driver operation, target semantic identifiers; never raw credentials or statements |
| Message produce / consume | PRODUCER / CONSUMER | Use span links for fan-out and batches where needed |
| Actor receive/dispatch | INTERNAL / CONSUMER as appropriate | Actor identity is privacy-safe and bounded; never message payload |
| TCP / file I/O | INTERNAL events, duration histograms | Avoid duplicate CLIENT spans for the same higher-level request |
| Task suspend/resume | INTERNAL event or metric | Separate waiting time from CPU service time |
| Function entry/exit | INTERNAL, selected only | Call filters + sampling + recursion and event-count budgets |
| Critical section | metric/event | Contention/hold duration, no waits or exporting while loans are held |

Each operation has **one authoritative semantic owner**. HTTP protocol layer owns HTTP spans, socket layer records supporting I/O; a DB adapter does not double-create the underlying HTTP CLIENT span unless there are truly distinct operations.

## Logical context and safety

- `SpanContext` = immutable 16-byte trace ID, 8-byte span ID, trace flags, bounded `tracestate`; IDs generated from secure entropy at roots. Do not equate existing numeric correlation IDs or the `oreslang-otel` local `ores-trace-...` identifier with W3C span/trace IDs.
- Attach context to **logical execution and actor-envelope metadata**; capture/restore on await/suspend/resume, enforce actor generation and task incarnation on late callbacks, and never use Java thread locals as the canonical authority.
- Cross-process HTTP uses validated W3C `traceparent` and `tracestate`, with per-tenant trust and sanitization. Optional baggage is separately allowlisted. No raw auth, path/query, headers or bodies in core diagnostic records.
- Producer-to-consumer inheritance and links must survive unsampled spans. Record creation and propagation are distinct: **unsampled is not contextless**. OTel nonrecording spans preserve propagation without attributes/events.
- Sampling is decided before expensive argument construction. A parent-based root trace decision keeps distributed traces coherent; rate limits and size caps protect fan-out and hot functions.
- Events cannot contain mutable guest objects, pointer capabilities or actor state; exporter cannot read actor private memory. Trace buffers are owned by an actor/scheduler and bounded by profile. Export drops never block `critical-read`, `critical-write`, CONTROL messages, scheduler or I/O.

## Required executable proof (not achieved by this document)

1. Identical byte-pinned uninstrumented Atto application source must compile in `none` and `boundaries` modes; disabled/uninstrumented application stdout, errors, network bytes and actor ordering must match.
2. Run a real guest HTTP request and actor chain **without any telemetry import**, start with recording off, then enable externally without rebuilding to produce correctly parented SERVER/INTERNAL/CLIENT spans.
3. Instrument entry/exit for selected functions and all normal, raise, throw, panic (where recoverable), await, cancel and supervisor restart cases. Prove exception/control notices and return types remain unchanged.
4. Force bounded buffer overflow and OTLP connection loss under concurrent load; core mailboxes, tasks, critical sections and request tails must remain safe; never turn dropped telemetry into an application error.
5. Execute strict W3C good/bad headers, sampled and unsampled remote parents, actor migration, fan-out, replay, hot-reload generation revocation and multi-tenant isolation tests.
6. Run actual Java/Graal JIT and Native Image, LLVM, Forge, Wasm and .NET AOT guests with source/commit SHA and nonempty test steps. Source-free checker output is **not** backend evidence.
7. Compare stripped/off/boundaries/calls/full measured per-operation CPU, allocation, memory, latency and bounded pressure; make no zero-overhead claim until measured.

Authoritative references: [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/), [SDK configuration](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/), [W3C Trace Context](https://www.w3.org/TR/trace-context/) and the existing [core logging contract](CORE_LOGGING_AND_OTEL.md).
