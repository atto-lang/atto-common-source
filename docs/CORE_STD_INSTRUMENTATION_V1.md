# AttoLang core/std instrumentation API v1 (proposed)

**Status: API and cross-backend conformance proposal only.** The compiler/runtime implementation, new guest module, automated hooks, W3C propagation and OTLP transport described here are **NOT IMPLEMENTED** by this document. Nothing in this proposal certifies guest execution, native AOT, or parity.

## Existing foundations and non-replacement rule

- Java/Graal main contains **stdlib/trace.ores** (module Trace): allocation-free/clock-free disabled timing via start_ns(false), duration_ns, immutable Event and bounded actor-owned Buffer (max capacity 65,536, no I/O in record).
- oreslang-otel provides native guest-language explicit spans, logs, metrics and JSONL schema oreslang-otel.v1. It is currently a separately pinned source module, not a W3C trace-id or OTLP exporter.
- Canonical .atto source-migration work for the Trace module is pending; do not silently rename existing module keys, .ores imports or ABI/source identities.
- Runtime CorePerf is a distinct fixed-phase diagnostic profiler, not a user-visible distributed tracing SDK.
- Do not add new guest algorithms primarily in Java. Implement public composition in .atto; keep host code to minimal scheduler, clock, wire I/O, secure entropy and capability-enforcement primitives. Rust is preferred for tooling; do not introduce Python.

The new API should be a coherent facade/adaptor above these pieces, not an incompatible recorder.

## Modules and API

### Pure core: core.instrumentation

Contains no I/O or exporter:

- TraceContext: immutable, Sendable, typed 16-byte trace_id, 8-byte span_id, trace_flags and validated bounded tracestate; an optional, explicit parent relationship. It must never reference mutable actor state or a raw heap/arena pointer.
- SpanKind: INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER. SpanStatus: UNSET, OK, ERROR.
- AttributeValue: bounded typed scalar values (String, bool, int, finite float where supported) with explicit limits, no arbitrary object-to-string, no guest closure/function serialization.
- SpanContext.is_valid(), is_sampled(), parse_traceparent(String) and format_traceparent(TraceContext) as pure functions. Invalid remote identifiers are rejected. An absent/invalid traceparent starts a fresh locally generated context at the admitting server layer, not here.
- No mutable global tracer, thread/carrier-local ambient context, reflection, dynamic class creation or runtime code generation.

### Standard library: std.instrumentation

Proposed public operations, names to be proven by compiler-backed guest tests:

| Surface | Contract |
| --- | --- |
| trace.start(name, kind, parent?) -> Span | Start an actor-owned local span; no mandatory export. Parent defaults to execution-context current trace when safe. |
| trace.current() -> Option<TraceContext> | Copy/share *immutable* context from logical execution, not OS thread/carrier. |
| span.context() -> TraceContext | Immutable propagatable identity; a live Span is never mailbox-sendable. |
| span.is_recording() -> bool | Cheap guard for expensive attribute construction. |
| span.attribute(key, value), span.event(name, attributes?) | Typed, bounded and filtered; unavailable after end. |
| span.record_error(error), span.set_status(status) | Preserve the original error and application result. |
| span.end() -> bool | Idempotent, exactly-once end timestamp/duration and release; false for repeated end. |
| trace.inject_http(context, mutable_header_writer), trace.extract_http(headers) | W3C Trace Context, trust- and size-checked, no general header capture. |
| metrics.counter(name, delta, labels?), gauge(name, value, labels?), histogram(name, sample, unit, labels?) | Stable metric identity, bounded label cardinality; never a per-request ID label. |
| log.emit(level, message, attributes?) | Structured log correlated to current immutable context; privacy policy applies. |
| instrumentation.configure(config) | A privileged supervisor/startup operation, not a per-call mutable global or guest escape hatch. |

API examples below are **illustrative expected syntax**, NOT current executable fixtures:

~~~atto
// Proposed, not compiler-verified. New module implemented primarily in .atto.
import module instrumentation from "std/instrumentation";

suspends fnc get_profile(String id): String {
  val span = instrumentation.trace.start("profile.get", "INTERNAL");
  // Compiler/runtime will eventually guarantee end on success/error,
  // cancellation, STOP and panic. Until then callers use try/finally.
  try {
    val result = await http.get_text("https://api.example.test/profiles");
    span.set_status("OK");
    return result;
  } catch (err) {
    span.record_error(err);
    throw err;
  } finally {
    span.end();
  }
}
~~~

No new keyword is required. An opt-in compile-time annotation such as @trace may be considered later; it must lower to static AOT probes and real cleanup edges, not reflective wrappers. Blanket per-function spans are OFF by default because they amplify overhead and cardinality.

## Logical context, actors and suspends/await

1. Context is a field of the *logical execution/continuation*. Save/restore with every suspends/await continuation and task handoff; never key it to a Java virtual thread, kernel thread or reusable scheduler carrier.
2. New child tasks inherit an immutable context snapshot by policy. A detached task requires explicit propagation; it cannot implicitly borrow an owning actor's mutable Span.
3. Actor mailbox ingress carries optional validated immutable trace metadata in an envelope. No functions, Span handles, raw pointers or mutable cross-arena aliases cross the mailbox. Check sender generation/epoch, supervisor authority and destination lifecycle before admission. Dropped/expired messages cannot resume a stale span.
4. Actor send yields a PRODUCER context; receive/process creates CONSUMER with a **link** to creation context by default (single-message parent relationship may be opt-in). Batched fan-in uses multiple bounded links; never invent a unique parent.
5. A suspended actor remains non-reentrant. Telemetry cannot itself suspend while holding critical, a mailbox lock, an actor carrier or an exclusive borrow. Critical/state.write effects retain normal checking; instrumentation has no privileged access to actor state.
6. Actor STOP, cancellation, restart, hot upgrade and tenant shutdown must close/abandon local spans once, fence generations and never block reclamation on exporter acknowledgement. Quiescence and in-flight immutable context borrows remain respected.

## Automatic I/O instrumentation (opt-in; no duplicate spans)

- Inbound HTTP: SERVER span after request admission and validated traceparent extraction, finish on response completion/cancellation; use route template, method, status and bytes counts only where permitted. Never record raw URL query/body, headers, cookies or credentials.
- Outbound HTTP: CLIENT span for each actual wire attempt, including retries, avoiding a duplicate wrapper span. Inject context only to allowlisted/trusted destinations. Redirects follow existing destination admission policy.
- TCP connect, DNS, TLS, async filesystem and socket reads/writes: bounded logical-operation spans/metrics at the privileged I/O boundary, never blocking actor carriers or capturing payloads/file contents. Mask paths, user data, IPs and endpoints by policy.
- Actor send/receive, task spawn/await, queue/dispatch and pubsub: low-cardinality phase metrics by default. Full spans behind an explicit sampler. Keep existing CorePerf numeric phase probes independent.
- Stdio and the exporter itself must be recursion-guarded, not auto-instrumented through themselves.

Follow OpenTelemetry semantic conventions where applicable: stable operation names, SpanKind, status/exception semantics, HTTP client attempt rules and messaging links. A library and its transport must not both report the same wire operation.

## Wire and trust boundary

- W3C traceparent version 00: 2-char version, 32 hex trace-id, 16 hex parent-id, 2 hex flags, separated by '-'; reject all-zero IDs, malformed hex, unexpected bytes/length and unsupported version forms. Future-version handling must follow W3C parsing rules, not treat arbitrary tails as trusted.
- Tracestate is optional, bounded, normalized and rejected/stripped according to origin trust policy. Do not accept unbounded baggage, tenant IDs, log labels or attacker-controlled sampling as privileged authorization.
- Keep ores_trace_id (application correlation string) separate from standard W3C trace_id/span_id. Never cast the existing ores-trace-* or UUID IDs into W3C IDs by truncation or string mangling. A migration can attach sanitized legacy IDs as explicit attributes when authorized.
- Trust-restart at external and tenant boundaries as policy demands. Malformed inbound headers must not crash a request or disclose state. Trace context is *not* an authentication credential.

## Recording, bounds and exporter policy

- Disabled default: no record allocation, string formatting, clock read, network activity, extra actor wakeup or payload materialization. is_recording guards costly attributes. Sampling decision must be stable through child continuations; nonrecording context can still propagate.
- Fixed actor-/tenant-owned budgets: bounded records, attributes, span links, values, queue bytes, metrics cardinality, samples and exporter batches. Deterministic drop-newest or specified drop policy with saturating dropped telemetry counters. No unlimited queue/caches; record() cannot block.
- Clock: monotonic duration, wall time only for export timestamp; guard overflow, clock skew and negative durations. Use static numeric phase IDs for extremely hot runtime paths.
- Exporter: trusted supervisor/collector worker only; capability-checked outbound OTLP/gRPC or HTTP/protobuf exporter (later milestone), off the actor carrier, bounded asynchronous batches, retry ceiling, controlled shutdown flush. No implicit network permission, host SDK imports or cross-tenant trace mixing.
- Existing oreslang-otel.v1 JSONL remains a distinct optional development/compatibility adapter, **not OTLP**. No claim of wire interoperability without decoding an actual OTLP capture.
- Instrumentation must not change app return values, cancellation arbitration, FIFO fairness, actor isolation or I/O errors. Export/config authorization failures are reported to the supervisor; ordinary telemetry drops do not fail app requests.
- Redact by allowlist: credentials, auth/cookie headers, request/response bodies, filesystem paths and user-provided SQL are not captured by default. Prevent high-cardinality attributes by schema; tenant quotas apply even to untrusted code.

## Conformance and release gates

1. Pure context vectors: valid/invalid W3C traceparent, future version handling, zero IDs, uppercase/canonical lower case, tracestate bound, malicious carrier strings, IDs of correct cryptographic uniqueness.
2. Manual span nesting/status/end idempotence and error propagation; ensure no telemetry after end; monotonic, saturated durations and bounded events.
3. Real guest HTTP server -> CLIENT request with actual propagation and **no** duplicate client spans; retry, redirect-denial, error, cancellation and HTTPS handling.
4. Real guest actor send/receive, batch fan-in links, task child/detach, suspends/await across carrier migration; lifetime, sender epoch, stop/restart/generation fences.
5. Resource abuse: per-actor and per-tenant caps, overflow/drop telemetry, malicious headers/attributes, disabled profiler no-clock/no-allocation, exporter recursion, no I/O under critical.
6. Security: no unauthorized network exporter, no secret/body/cookie leakage, no tenant ID spoofing, no cross-arena Span pointer, no forged trace header elevating privileges.
7. Backend matrix: Java/Graal guest JIT and full guest AOT, LLVM native, .NET NativeAOT, Wasm worker, Forge/Cranelift and JS. Every backend must execute the same .atto fixture and negative mutations. Unsupported features fail closed with diagnostics.
8. Evidence: exact source HEAD/tree/fixtures, compiler SHA, nonzero CI steps, guest stdout + OTLP bytes and trustable run receipts. Host-only or source-only tests are labeled separately; never infer five-backend parity from one host.

## Implementation order

P0: Approve versioned API, pure context data model and W3C parser/vector contract; keep Trace and oreslang-otel compatibility.

P1: Add core execution-context continuation capture/restore and immutable actor envelope metadata; prove cancellation/STOP and generation fencing.

P2: Implement .atto-facing std instrumentation facade, bounded actor buffers, manual spans/logs/metrics, and HTTP client/server hooks on the Java reference lane. Execute real .atto positive and negative fixtures.

P3: Add off-carrier, authorized OTLP exporter, scope sampling, privacy controls, metrics label budget and failure/drop receipts.

P4: Port and prove LLVM/.NET/Wasm/Forge/JS, sealed full guest AOT, and steady-state/disabled-path benchmarks; only then promote cross-backend production claims.

References: https://www.w3.org/TR/trace-context/ ; https://opentelemetry.io/docs/specs/otel/trace/api/ ; https://opentelemetry.io/docs/specs/semconv/http/http-spans/ ; https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/ .
