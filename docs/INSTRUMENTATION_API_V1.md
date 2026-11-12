# AttoLang core / standard-library instrumentation API v1

**Status:** contract + first Java/Graal guest-facing manual span boundary PR; actual guest execution, full suite, Native Image and cross-backend parity are **NOT EXECUTED**. Do not interpret this document as shipping distributed tracing. Authority: `contracts/v1/instrumentation-api-v1.json`.

## Goal and layering

Expose a small, stable, **native AttoLang** instrumentation surface for function calls, HTTP/TCP, file I/O, and actor send/receive/suspension. Reuse existing `ores.std/trace` (`std/trace` legacy alias); do not introduce a Java-centric public API, a new core keyword, or a mandatory third-party dependency.

| Layer | Responsibility | Export policy |
| --- | --- | --- |
| Runtime / `ores.core` internal diagnostics | Scheduler, mailbox, allocator, compiler and privileged kernel primitive counters with fixed numeric IDs | Host-owned bounded recorder, cold-path only; never implicitly sends OTel |
| `ores.std/trace` | Guest-facing timing, opt-in bounded observations, later `Tracer`, `Span`, `Context` and context propagation | Actor-owned, no blocking I/O or exporter in a hot path |
| `oreslang-otel` | Explicit application logging/metrics/tracing export adapter | Opt-in; existing JSONL is **not** OTLP and has no W3C propagation yet |

The supported manual first slice uses numeric phase IDs and same-process monotonic durations. It deliberately does **not** call a numeric `correlation_id` an OpenTelemetry `trace_id`.

## Manual v1 API (Java/Graal proposal)

Existing functions remain compatible: `Trace.start_ns(enabled)`, `Trace.duration_ns(started_ns)`, `Trace.event(correlation_id, phase_id, elapsed_ns)`, `Trace.buffer(capacity)`.

Added native guest functions on the feature branch:

- `Trace.begin_span(enabled: bool): int` returns **0 when off**; no allocation, formatter, clock read or I/O in the disabled branch.
- `Trace.finish_span(buffer, correlation_id: int, phase_id: int, started_ns: int): bool` records a completed interval into its actor-owned bounded buffer. False indicates disabled, malformed inputs or capacity exhaustion. This wrapper does **not** own the timer's lifecycle or prevent repeated completion: each call is a separate observation.
- The following fixed-ID functions name well-known operation classes without dynamic hot-path strings.

| API | ID | Operation |
| --- | ---: | --- |
| `phase_function_call()` | 100 | annotated or manually wrapped callable |
| `phase_http_client()` / `phase_http_server()` | 200 / 201 | HTTP boundaries |
| `phase_tcp_connect()` / `phase_tcp_read()` / `phase_tcp_write()` | 300 / 301 / 302 | socket phases |
| `phase_file_read()` / `phase_file_write()` | 400 / 401 | file I/O |
| `phase_actor_send()` / `phase_actor_receive()` / `phase_actor_await()` | 500 / 501 / 502 | actor and task phases |

Example of an **actually representable manual boundary** (illustrative; not an executed receipt):

```atto
import module Trace from "ores.std/trace";

pub routine main(): void {
  val events = Trace.buffer(128);
  val int started = Trace.begin_span(true);
  // Your application work here; the owner finishes in every exit path.
  stdio.println(Trace.finish_span(events, 7, Trace.phase_function_call(), started));
  stdio.println(events.count());
  return;
}
```

Use one single-writer collector per actor/supervisor; never mutate a `Buffer` concurrently, transfer it across actor domains, or hold a `critical-read`/`critical-write` loan while exporting. Capacity is 1–65,536; drops are observable through `dropped_count()` and saturate rather than overflow. The manual start token is process-local; never pass monotonic timestamps between processes. Do not use it after restart without generation checks. Applications are responsible for paired completion on normal returns, errors, panics and cancellation until compiler-verified scoped spans exist.

## Next: typed spans, propagation and automatic hooks

Define `Tracer.start_span(name, parent_context, kind, attributes)`, `Span.end()`, `Span.add_event()`, `Span.record_error()`, and a separate activation/scope operation. Span creation alone must **not** implicitly make the span active. Resource, instrumentation scope, status, event and attribute policies should align with OpenTelemetry. A live mutable `Span` is actor-owned; only its immutable `SpanContext` may cross actor/task boundaries. Generate 16-byte cryptographically secure trace IDs and 8-byte span IDs (nonzero); local numeric correlation IDs and `oreslang-otel` UUID-like identifiers do not meet this requirement.

For async propagation, capture `Context` in each **logical continuation** when an `await` suspends, then restore it only for the same generation on resumption. Actor send envelopes contain immutable tracing metadata separate from payload and user mail; producers and consumers should normally be connected via producer spans, consumer spans and optional span links. Actor restart/replay requires incarnation/generation fencing; stale callbacks cannot resurrect old context. Never use Java thread-local context as the source of truth.

For HTTP, support strict W3C `traceparent`/`tracestate` parse/inject (length, hex, version, zero ID, allowed characters, duplicate headers, total size bounds, trust policy); never trust a malformed incoming header. Baggage is explicit allowlisted only; reject unauthorized tenant or cross-isolate metadata. Only include normalized route templates, method, status and permitted server/network metadata, not raw headers, authorization, query strings, bodies, URLs or filesystem paths.

For **zero-code automatic tracing**, instrument selected functions and methods at compile time by default where compiled coverage permits—**no `@trace` annotation or userland code is required**. The compiler produces typed internal probe intrinsics around verified callable bodies, including normal/throw/raise/panic/cancel exits and suspend/resume. Runtime actor/task/mailbox hooks and native standard-library HTTP/TCP/file/DB/messaging hooks publish bounded semantic observations using the same internal ABI, without exposing core-only diagnostic data or importing userland `oreslang-otel`. Build-time `--instrument=none|boundaries|calls|full` controls which probes are emitted, while **runtime collection starts off** and is operator-enabled without a rebuild only for probe sites already compiled in. Function names remain canonical snake_case, sampling precedes dynamic argument evaluation, and recursion/rate caps prevent event storms. See [zero-code AOT instrumentation and distributed tracing](AUTO_INSTRUMENTATION_AND_DISTRIBUTED_TRACING_V1.md) for the detailed versioned design. Network hooks belong at capability-checked nonblocking `std/net`/`std/http` boundaries; Java-only host wrappers cannot be the portable API.

Do not confuse *one logical operation's active span* with *each suspended fragment's CPU timing*. An awaited I/O span measures end-to-end latency while optional child events distinguish queue wait, readiness, dispatch, service time, partial reads/writes and bytes transferred. One underlying HTTP operation should not produce duplicate CLIENT spans from multiple wrappers.

## Collection, export and cost budgets

Default instrumentation is off. When disabled, a compiler/runtime hook must avoid guest expression evaluation, string formatting, storage, timestamp sampling, object allocation, locks and I/O. Guard expensive arguments **before** computing them. Enabling it must not change program return values, exceptions, mailbox ordering, actor isolation, cancellation or authorization.

Enabled hot paths only write bounded data to actor-owned shards or a nonblocking try-send collector. The exporting actor batches on a separate asynchronous, capability-checked path; no blocking calls, synchronous JSONL, retry loops, waiting for exporter acknowledgments, or unbounded buffers on request/scheduler paths. Report drops, queue saturation and exporter errors as independent bounded counters. OTLP/HTTP and/or OTLP/gRPC adapters are future optional modules, not supplied by the manual primitive. Core diagnostics stay independent of all exporters.

Use monotonic time for durations and timestamp origin correlation only for same-process clock domains; epoch timestamps require a separately sampled wall-clock mapping for distributed export. Enforce an attribute byte budget, maximum span events and links, histogram buckets, deterministic head sampling, exporter rate limits, and a tested privacy allowlist. For hard real-time and freestanding Wasm profiles, fail closed if the profile cannot prove bounded memory/execution and required capabilities.

## Conformance and rollout gates

1. Java/Graal: compile and **execute** the new `.atto` smoke and negative cases; preserve the legacy `std/trace` API, run full Maven/JDK 25 tests, Graal AOT where supported, and prove clock-free disabled path. Source-only tests do not count.
2. LLVM, Forge, Wasm and .NET: compile/execute identical byte-pinned source fixtures, or emit an explicit unsupported-profile diagnostic. Do not map a missing guest capability to hidden Java, POSIX or JS interop.
3. Context: test nested spans, lossless `traceparent` roundtrip, malformed/oversize headers, sampled/unsampled, remote parent, sibling links, actors across awaits, restart, cancellation, panic and mailbox saturation; test cryptographically secure IDs with native entropy primitive.
4. Security: no secrets, headers, raw URLs, path names, guest objects or actor payloads in runtime events; no unsanctioned cross-tenant correlation or external export from a sandbox; no deadlock in critical regions.
5. Pressure/performance: run disabled/enabled heap allocation and monotonic-clock probes, fixed-memory stress, drop-counter overflow, tail latency/throughput versus no-instrumentation controls with warmup and matched requests; do not claim zero-overhead merely from source review.
6. Promotion: attach exact source-tree Git SHA, executable target/mode, nonempty actual CI steps, command/exit, tests, error counts and independent run URL. `NOT_EXECUTED` is not `PASS`.

References: [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/), [W3C Trace Context](https://www.w3.org/TR/trace-context/), [OpenTelemetry HTTP conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/), [messaging conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/), and local [core logging boundary](CORE_LOGGING_AND_OTEL.md).
