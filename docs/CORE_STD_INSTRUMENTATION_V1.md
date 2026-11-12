# AttoLang automatic compiler/runtime/core/std instrumentation API v1 (proposed)

**Status: API and cross-backend conformance proposal only.** The compiler/runtime implementation, new guest module, automated hooks, W3C propagation and OTLP transport described here are **NOT IMPLEMENTED** by this document. Nothing in this proposal certifies guest execution, native AOT, or parity.

## Existing foundations and non-replacement rule

- Java/Graal main contains **stdlib/trace.ores** (module Trace): allocation-free/clock-free disabled timing via start_ns(false), duration_ns, immutable Event and bounded actor-owned Buffer (max capacity 65,536, no I/O in record).
- oreslang-otel provides native guest-language explicit spans, logs, metrics and JSONL schema oreslang-otel.v1. It is currently a separately pinned source module, not a W3C trace-id or OTLP exporter.
- Canonical .atto source-migration work for the Trace module is pending; do not silently rename existing module keys, .ores imports or ABI/source identities.
- Runtime CorePerf is a distinct fixed-phase diagnostic profiler, not a user-visible distributed tracing SDK.
- Do not add new guest algorithms primarily in Java. Implement public composition in .atto; keep host code to minimal scheduler, clock, wire I/O, secure entropy and capability-enforcement primitives. Rust is preferred for tooling; do not introduce Python.

The new API should be a coherent facade/adaptor above these pieces, not an incompatible recorder. The established public tiers remain `ores.core` (freestanding) and `ores.std` (hosted); proposed ergonomic `core.trace` / `std.telemetry` spelling must respect trusted resolution and legacy aliases.

## Modules and API

### Pure core: core.trace (canonical ores.core.trace)

Contains no I/O or exporter:

- TraceContext: immutable, Sendable, typed 16-byte trace_id, 8-byte span_id, trace_flags and validated bounded tracestate; an optional, explicit parent relationship. It must never reference mutable actor state or a raw heap/arena pointer.
- SpanKind: INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER. SpanStatus: UNSET, OK, ERROR.
- AttributeValue: bounded typed scalar values (String, bool, int, finite float where supported) with explicit limits, no arbitrary object-to-string, no guest closure/function serialization.
- SpanContext.is_valid(), is_sampled(), parse_traceparent(String) and format_traceparent(TraceContext) as pure functions. Invalid remote identifiers are rejected. An absent/invalid traceparent starts a fresh locally generated context at the admitting server layer, not here.
- No mutable global tracer, thread/carrier-local ambient context, reflection, dynamic class creation or runtime code generation.

### Standard library: std.telemetry (canonical ores.std.telemetry)

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
| telemetry.configure(config) | A privileged supervisor/startup operation, not a per-call mutable global or guest escape hatch. |

API examples below are **illustrative expected syntax**, NOT current executable fixtures:

~~~atto
// Proposed, not compiler-verified. New module implemented primarily in .atto.
import module telemetry from "std/telemetry";

suspends fnc get_profile(String id): String {
  val span = telemetry.trace.start("profile.get", "INTERNAL");
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

No annotation, new keyword or manual span call is required for compiler-selected function instrumentation or built-in I/O boundaries. The existing `using` keyword MUST support `using telemetry.span(...) as span { ... }` as official scoped-resource syntax. The feature still requires compiler/parser/type/ownership/lowering implementation and verification. `@trace` can optionally serve as a compile-time selection hint but must never be mandatory. Blanket per-function tracing stays disabled by default.

## Automatic instrumentation from compiler, runtime and standard library

AttoLang should generate AOT-compatible, fixed, typed probes at **compiler-known call sites, runtime lifecycle boundaries and standard-library I/O adapters**. Ordinary application code is unchanged. There must be no arbitrary monkey patching, reflection, Java agent, dynamic proxy, unsafe in-place machine-code patching or untrusted runtime source compilation. An explicitly authorized JIT-enabled execution profile MAY compile a fresh immutable code version with probes from retained, verified typed IR.

| Operation | Probe owner | Default signal |
| --- | --- | --- |
| Selected function/method enter and exit | Compiler HIR/MIR or backend-equivalent lowering | INTERNAL span, Calls mode |
| Async suspend, resume, completion; task spawn | Continuation compiler and scheduler | Wait/resume timing, Boundaries mode |
| Actor mailbox send/receive, STOP, restart | Runtime and supervisor | Message PROCESS link, queue and lifecycle metrics |
| Channel and pub/sub delivery, select handoff | Runtime | Queue/wait metrics and optional span link |
| Critical section acquire/contention/release | Runtime and effects engine | Wait/hold duration metrics; never block tracing |
| HTTP client/server, TCP, filesystem, DNS, TLS | Standard library at actual privileged boundary | SERVER/CLIENT spans, I/O metrics |
| Database and Kafka/NATS/RabbitMQ-style drivers | Trusted implementation adapters | DB CLIENT, message PRODUCER/CONSUMER |
| Scheduler internals, allocator, hot paths | Separate CorePerf or fixed numeric diagnostic probes | Full diagnostic events |

### Compiler probe ABI (v1 proposal)

Use versioned, statically emitted `probe_id` and metadata (`symbol_id`, kind, source location, optional build/source identity). Probe sites have a fixed signature conceptually equivalent to:

~~~text
probe_enter(probe_id, logical_execution_id) -> opaque_scope_slot
probe_suspend(scope_slot, suspension_id)
probe_resume(scope_slot, suspension_id)
probe_exit(scope_slot, outcome)
~~~

These are *conceptual internal ABI calls*, not guest API or implemented functions. The opaque slot is a stack or continuation field; do not allocate a heap span object on the disabled path. Probe IDs and names come from compiler metadata rather than runtime reflection or request-derived strings. A runtime policy switch changes compiled dormant probe guards and never patches AOT code. Separately, a privileged opt-in JIT-enabled profile may publish a newly compiled immutable instrumented code generation from pinned typed IR.

The compiler must insert exactly **one entry and one eventual exit per logical invocation**, not one per carrier turn. At `suspends` / `await`, retain the immutable context and slot in the continuation. Restore them at resume before guest execution, even after carrier migration. Optional suspension and queue events are not new function spans. Preserve nested spans, child task inheritance, detached-task explicit propagation, non-reentrant actor execution and per-actor lifetime ownership.

All normal returns, propagated errors and cancellation/unwind paths must be modeled, including deterministic `using` and `finally` cleanup. Do not catch uncatchable panics, change application result/error, alter evaluation order, break `routine` direct-call requirements, or silently disable compiler-mandated tail-call optimization. A fatal process kill cannot guarantee an end event. A compiler that cannot preserve semantics must diagnose unsupported instrumentation rather than silently change the program. Compiler-inserted probes are trusted nonblocking bookkeeping, **not** user-visible effect grants or new capabilities.

Static call-site selection is by bounded build-time filters, stable symbol identities and function kinds. Default production coverage is **boundaries**, not every function. Full-call/recursive instrumentation needs sample, depth, cardinality, memory and per-tenant quotas. FFI and third-party native internals can only be observed through AttoLang ABI adapters or an explicit native adapter.

### Required compiler-owned scoped resource semantics

This extends AttoLang's **existing** `using` keyword instead of creating a second keyword or conflating namespace imports (`use`), function effect declarations (`with`), and lexical state loans (`using state.read/write`). Existing state loans grant explicit critical read/write authority and prohibit suspension while a live non-suspendable state loan exists. A tracing span guard has different lifetime and may cross `await`, but it cannot authorize state access or privilege escalation.

Proposed grammar target (not a claim of current compiler admission):

~~~ebnf
UsingSpan ::= "using" TelemetrySpanExpr "as" Identifier Block
TelemetrySpanExpr ::= "telemetry" "." "span" "(" Expression ["," Expression] ")"
Block ::= "{" Statement* "}"
~~~

Resolve the resource through trusted typed symbol identity, **not textual spelling**: an arbitrary user method named `telemetry.span` must not forge privileged cleanup. A sealed, statically verified scoped-resource descriptor/admitted type guarantees the guard is non-Sendable, nonescaping, owned by its lexical continuation/actor, cannot be double-ended, and can release without user I/O, arbitrary destructor code, or a new host capability. Nested guards restore the parent logical context.

Conceptual lowering, not AttoLang source:

~~~text
guard = internal_span_enter(name, current_logical_execution)
register_guard_in_continuation(guard)
try: execute_block()
finally:
    internal_span_end_once(guard, terminal_reason)
    restore_previous_context()
~~~

On `await`, store the live guard in the actor-owned continuation; resume on any carrier without starting a second span. Wall duration includes suspension. On normal exit/return/error/cancellation/STOP/restart invoke nonblocking terminalization exactly once *if the runtime can execute cleanup*; sudden process death is not recoverable. A matching `using state.write` loan cannot remain live across the same await. Cleanup cannot block a carrier, release a foreign actor's resource, or affect the function's result. Disabled telemetry creates no heap allocation, reads no clock and exports no record.

Require compiler-backed positive/negative tests for early return, exception, nested spans, child tasks, await/resume on a different carrier, cancellation race, actor STOP/hot upgrade, explicit `span.end()` before scope exit, resource escape/alias, forged `telemetry.span`, invalid effect grants, and state.write loan live across await.


### Two-axis build and activation model

| Compile-time `--instrument` mode (proposed) | Coverage available in AOT artifact | Default runtime state |
| --- | --- | --- |
| `none` | Optional probes stripped, cannot be enabled later | Off |
| `boundaries` | HTTP/network/files/database, actors/tasks/channels/critical hooks | Off |
| `calls` | Boundaries plus statically selected guest function/method probes | Off |
| `full` | Broad call probes and detailed runtime diagnostics, strongly bounded | Off |
| `adaptive` (JIT-only) | Trusted typed IR and JIT retained; trace-selected code versions compiled on demand | Off |

A production trace-capable artifact should use `--instrument=boundaries` with `[telemetry].enabled=false` by default. Operators can activate dormant compiled sites without rebuilding; explicit `--instrument=adaptive` may instead generate probes with a resident trusted JIT compiler, subject to authorization. A strict `none` build remains uninstrumentable at runtime. Context-only propagation is independent and not free.

**Example proposed package configuration; not accepted by a verified compiler:**

~~~toml
[telemetry]
enabled = false
instrumentation = "boundaries"
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
~~~

The build flag is the maximum coverage; package policy can select a subset; runtime policy can only activate already compiled sites. Sampled span collection must distinguish OpenTelemetry `IsRecording` from the propagated `Sampled` trace flag: recording-but-unsampled is allowed; **sampled-but-nonrecording is not allowed** by the SDK. A nonrecording context can still propagate. Read supported `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SDK_DISABLED` at trusted initialization, tenant-scoped and capability-checked; never on the probe hot path. Untrusted remote trace flags are not authorization.

### Opt-in live JIT re-instrumentation (no redeploy on supported runtimes)

An authorized **JIT-capable** AttoLang runtime MAY recompile selected already deployed AttoLang functions from retained, immutable, source-hash-pinned and compiler-validated typed IR into new instrumented code. This is **not** the same as modifying an existing function object in place, injecting a Java agent, reflecting over user objects, patching machine bytes or executing new untrusted source. It is controlled-dynamism code-generation governed by tenant policy, ownership, effects and actor-generation fencing.

GraalVM Truffle exposes first-party dynamic instrumentation, including execution listeners and dynamically enabled Bytecode DSL instrumentation. Its generic listener path can insert AST wrappers and force deoptimization. Prefer an **Atto-owned static probe/JIT code-versioning path** for the production ABI; do not equate generic Truffle attachment with proven AttoLang span, effects or continuation correctness. Source references: https://www.graalvm.org/truffle/javadoc/com/oracle/truffle/api/bytecode/Instrumentation.html ; https://www.graalvm.org/truffle/javadoc/com/oracle/truffle/api/instrumentation/Instrumenter.html .

Proposed `--instrument=adaptive` (JIT-capable only) is an **explicitly allowed fifth coverage profile**: no call tracing active initially, but the build retains signed/hash-pinned typed IR, a trusted resident runtime compiler, and a capability-scoped control path. `none` remains strict: all probes stripped and **no** dynamic re-instrumentation. For hard realtime or full guest sealed AOT, use precompiled dormant probes (`boundaries` / `calls`), not a resident JIT.

An operator-only example (control-plane pseudocode, not guest API):

~~~text
telemetry.trace.enable(
  target = "InventoryService.*",
  sampling_rate = 0.1,
  duration = "60s"
)
~~~

Protocol:
1. Authenticate operator and tenant, check code-image ID, generation, target-function allowlist, budget, source hash, compiler version and JIT permission. No arbitrary source/code injection or cross-tenant attachment.
2. Produce fresh immutable instrumented code from *the same* typed IR and semantics; preserve effects, borrow constraints, method identity/ABI, tail calls, state/stack layout and cancellation. Bound compilation time, code-cache bytes, frequency and number of instrumented functions.
3. Publish a new versioned callable/dispatch target atomically after runtime admission/fencing. **New invocations** use traced code; old active/suspended frames continue using old code and context without retroactive span injection. No speculative on-stack replacement without a separate safety proof.
4. On disable/TTL expiry, publish the baseline target for new calls. Reclaim retired code only after active and suspended frames quiesce; guard identity and exact-once exit remain tied to their original code generation.
5. Log bounded administrative receipts (source/compiler/code-generation identities, who enabled, which functions, effective epoch, TTL, number of affected new calls, drops, quota hits) without leaking request payloads.

Limitations: A sealed LLVM/native AOT executable or Graal Native Image without guest JIT/retained IR cannot synthesize missing function probes just by changing configuration. The existing **JVM/Truffle** profile may be able to do so once integrated; the mere fact a host is built with GraalVM does not establish live JIT support. Dynamic compilation requires host executable-memory permission and has unpredictable recompilation/deoptimization costs. Hard realtime deployments should prefer fixed dormant probes. Mark unsupported profiles `JIT_REINSTRUMENTATION_UNAVAILABLE` rather than claiming zero-redeploy tracing.


### Automatic span lifecycle and de-duplication

An HTTP client instrumentation owns the one logical HTTP CLIENT span per documented operation/attempt; underlying TCP/read/write may add nested diagnostic spans or simple metrics, not duplicate HTTP CLIENT spans. Keep end-to-end wall duration (includes awaits) distinct from active CPU time, queue delay and I/O time. Instrument actual retries without counting them twice. Message creation/send and processing contexts should follow OTel messaging conventions, with links for batching, fan-in and non-parent message relations. No automatic recording of body, cookie, auth header, raw URL, query, customer payload or arbitrary SQL.

The exporter itself must be excluded from auto-instrumentation to avoid recursive tracing. A privileged telemetry-collector actor (or supervisor-owned exporter when needed) drains bounded actor/scheduler buffers and exports asynchronously with explicit endpoint permissions, no synchronous request-path output. On saturation it drops telemetry, increments saturating counters and preserves application progress.

### Required scoped `using telemetry.span(...) as span { ... }` API

**Normative language requirement:** AttoLang `using` MUST bind the lexical `telemetry.span(name)` resource with `as span { body }`. This is required language semantics, distinct from optional use in an application. Current compiler/guest execution acceptance is **NOT EXECUTED**; do not claim the parser already supports this exact form.

~~~atto
use std.telemetry as telemetry;
pub fnc checkout(Order order): Result {
  using telemetry.span("checkout") as span {
    span.attribute("order.type", order.kind);
    return process_order(order);
  }
}
~~~

`using` span guards MUST be exactly-once closed while the owning runtime remains alive across normal return, early return, exception, cancellation, STOP, generation retirement and async suspension. A fatal process kill cannot guarantee delivery. Guards stay actor/execution-owned and non-Sendable; only immutable context crosses mailboxes. A disabled span uses a nonrecording zero-allocation guard; there is no blocking I/O or guest callback in cleanup. Existing state-loan `using state.read/write` remains non-suspendable. Syntax is required but **not yet implemented**.


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

P0: Approve versioned API, fixed compiler/runtime probe ABI, build-coverage/runtime-enable policy split, pure context data model and W3C parser/vector contract; keep Trace and oreslang-otel compatibility.

P1: Add Java compiler-generated call enter/exit/unwind probes, `using telemetry.span(...) as span { }` parsing/type/lowering, core execution-context continuation capture/restore and immutable actor envelope metadata; prove await/suspension, cancellation/STOP and generation fencing.

P2: Implement .atto-facing std.telemetry facade, bounded actor buffers/collector, required scoped spans/logs/metrics, and automatic HTTP client/server hooks on the Java reference lane. Execute real .atto positive and negative fixtures.

P3: Add off-carrier, authorized OTLP exporter, scope sampling, privacy controls, metrics label budget and failure/drop receipts.

P4: Prototype/validate privileged JIT-adaptive compiler versioning and prove LLVM/.NET/Wasm/Forge/JS, sealed full guest AOT with dormant probes, and baseline/traced/adaptive performance under stress; only then promote cross-backend production claims.

References: https://www.w3.org/TR/trace-context/ ; https://opentelemetry.io/docs/specs/otel/trace/api/ ; https://opentelemetry.io/docs/specs/semconv/http/http-spans/ ; https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/ .
