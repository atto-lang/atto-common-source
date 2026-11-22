# AttoLang HTTP → actor → HTTP OTLP conformance harness (staged)

**Status:** the Node receiver and checker are *real executable harness code*, but they are **not an Atto telemetry exporter**, and the full Java/LLVM guest trace has **NOT EXECUTED**. The synthetic checker tests must never be cited as actual guest evidence.

## Intended first authoritative path

1. Compile an unchanged native `.atto` HTTP handler, with automatic entry/exit and std-lib HTTP server probes enabled by a trusted build/CLI policy. No telemetry imports/decorators in the application.
2. Send an actual loopback HTTP request with a valid W3C `traceparent`, collect an automatic SERVER span with that remote span as parent.
3. Dispatch an Atto actor mailbox message. Carry immutable context in metadata, not in the message value or mutable actor span, and collect an INTERNAL/CONSUMER span under the SERVER.
4. The actor performs one real outbound `await http.request(...)`, which injects valid W3C `traceparent` automatically and creates a CLIENT span. The actual outgoing wire traceparent must identify the CLIENT span, not a random parent or the server.
5. A native actor-owned bounded asynchronous telemetry collector exports a real OTLP/HTTP JSON batch to the external local receiver. No synchronous JSONL, Java-specific guest fallback or pending I/O operation may masquerade as a completed response.
6. Run the same guest source and fixture through LLVM with compiler, runtime, wire and OTLP receipts. This remains blocked by current native guest networking and compiler instrumentation gaps.

## External receiver: Node is a verification tool, not the exporter

```sh
node tools/trace-e2e/otlp-http-receiver.mjs /secure/local/trace-capture.jsonl 4318
# Separate terminal / CI job: start the actual Atto guest app and issue
# an HTTP request with traceparent. The guest must POST application/json
# OTLP/HTTP spans to http://127.0.0.1:4318/v1/traces itself.
```

The receiver binds to loopback only; it accepts bounded JSON POSTs on `/v1/traces`, rejects other paths/content-types, writes captures to an owner-only local file and caps request/body count. These are *test harness* restrictions, not evidence of a security-reviewed production collector. Treat the output as sensitive. It does not invent or synthesize spans.

After independently recording the incoming/outgoing HTTP headers, compiler source SHA, *real* executed CI steps, and receiver payload, assemble one `attolang.trace-e2e.v1` capture JSON with these top-level keys:

- `backend`: `java` or `llvm`
- `source_sha`: exact 40-hex commit from independent compiler checkout
- `execution`: successful compiler exit, auditable non-empty `executed_steps` list, explicit real guest server/HTTP roundtrip indicators
- `receiver`: `content_type: "application/json"` and `path: "/v1/traces"`
- `wire`: actual `incoming_traceparent` and `outbound_traceparent`
- `otlp`: the captured `ExportTraceServiceRequest` JSON object with `resourceSpans` / `scopeSpans` / `spans`

```sh
node tools/trace-e2e/verify-otlp-capture.mjs /secure/local/trace-e2e-evidence.json
node --test tests/trace-otlp-capture-v1.test.mjs tests/trace-otlp-receiver-v1.test.mjs
```

The validator requires valid nonzero hex 128-bit trace IDs and 64-bit span IDs, numeric OTLP span kinds, decimal nanosecond timestamps, actual span parents, HTTP SERVER → actor INTERNAL → outbound CLIENT topology, and outbound traceparent matching the CLIENT ID. The checker also fails on invalid geometry and known sensitive attribute names. OTLP/JSON's hex-ID exception and numeric enums follow the [OTLP specification](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding).

**Critical evidence distinction:** a checker result of `CAPTURE_SHAPE_CONSISTENT_NOT_EXECUTION_ATTESTED` never certifies that an Atto compiler ran, that the guest sent those HTTP requests, that actual wire headers match a packet capture, or that the data were not manually constructed. A synthetic fixture can pass the checker by design. CI must independently attest exact compiler tree, compiled guest, non-empty completed steps, request/network capture, OTLP receiver data and export source provenance before claiming E2E PASS.

## Known blockers

- Java/Graal PR #2989 currently implements a parser-lowered scope and a native no-op `ores.std/telemetry` module; it does not yet implement an automatic semantic span generator or OTLP actor exporter.
- Java/Graal now has an **unwired** per-domain Truffle probe mode gate. A runtime mode change cannot create call sites that did not exist in the compiled image.
- LLVM PR #1713 adds a host-only atomic AOT probe mode gate. Its native compiler still cannot compile/execute the proposed full HTTP→actor→HTTP+W3C guest.
- Actor-envelope immutable context, exact once/cancellation/end-of-span, trusted network injection and real native actor collector remain pending in both backends.
- AOT/Native Image, hard real-time and no-import Wasm profiles need explicit opt-in or fail-closed admission; never perform unauthorized network export.

Shared [instrumentation contract](../../contracts/v1/instrumentation-api-v1.json) and [automatic instrumentation design](../../docs/AUTO_INSTRUMENTATION_AND_DISTRIBUTED_TRACING_V1.md).
