// Source-free verification of actual externally captured OTLP/JSON data.
// DOES NOT create spans, run Atto, attest compiler evidence, or send telemetry.
// This checker must be paired with independently recorded actual guest/CI steps.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const TRACE_ID = /^[0-9a-f]{32}$/i;
const SPAN_ID = /^[0-9a-f]{16}$/i;
const SHA = /^[0-9a-f]{40}$/;
const HEX_ZERO_TRACE = '0'.repeat(32);
const HEX_ZERO_SPAN = '0'.repeat(16);

export function parseTraceparent(input) {
  if (typeof input !== 'string') throw Error('traceparent must be a string');
  // Version 00 is fixed-width; reject unknown version here until version-aware
  // parsing rules are separately reviewed.
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(input);
  if (!match) throw Error('invalid v00 traceparent syntax');
  const [unused, traceId, spanId, flags] = match;
  if (traceId.toLowerCase() === HEX_ZERO_TRACE || spanId.toLowerCase() === HEX_ZERO_SPAN) {
    throw Error('zero trace/span ID in traceparent');
  }
  return {traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase(), flags: flags.toLowerCase()};
}

function ensure(test, message) {
  if (!test) throw Error(message);
}

function parseNano(value, label) {
  ensure(typeof value === 'string' && /^\d{1,20}$/.test(value),
      label + ' must be a decimal int64 string');
  const parsed = BigInt(value);
  ensure(parsed > 0n && parsed <= 18446744073709551615n,
      label + ' outside uint64 range');
  return parsed;
}

function flattenSpans(data) {
  const out = [];
  ensure(data && Array.isArray(data.resourceSpans) && data.resourceSpans.length > 0,
      'missing OTLP resourceSpans');
  for (const resource of data.resourceSpans) {
    ensure(Array.isArray(resource.scopeSpans), 'missing scopeSpans array');
    for (const scope of resource.scopeSpans) {
      ensure(Array.isArray(scope.spans), 'missing spans array');
      out.push(...scope.spans);
    }
  }
  return out;
}

export function validateCapture(capture) {
  ensure(capture?.schema === 'attolang.trace-e2e.v1', 'wrong capture schema');
  ensure(['java', 'llvm'].includes(capture.backend), 'unexpected backend');
  ensure(typeof capture.source_sha === 'string' && SHA.test(capture.source_sha),
      'missing exact source_sha');
  ensure(capture.execution?.compiler_exit_code === 0, 'compiler did not succeed');
  ensure(Array.isArray(capture.execution?.executed_steps)
      && capture.execution.executed_steps.length >= 3
      && capture.execution.executed_steps.every(s => typeof s === 'string' && s.trim()),
      'no independently auditable executed steps');
  ensure(capture.execution?.real_guest_server_started === true, 'not a real guest server');
  ensure(capture.execution?.real_http_round_trip === true, 'no real HTTP round trip');
  ensure(capture.receiver?.content_type === 'application/json', 'not OTLP JSON');
  ensure(capture.receiver?.path === '/v1/traces', 'not OTLP traces endpoint');

  const incoming = parseTraceparent(capture.wire?.incoming_traceparent);
  const outbound = parseTraceparent(capture.wire?.outbound_traceparent);
  ensure(incoming.traceId === outbound.traceId, 'lost distributed trace ID');
  const spans = flattenSpans(capture.otlp);
  ensure(spans.length >= 3 && spans.length <= 2000, 'wrong number of captured spans');
  const ids = new Set();
  const byId = new Map();
  for (const span of spans) {
    ensure(span && typeof span === 'object', 'invalid span object');
    ensure(typeof span.traceId === 'string' && TRACE_ID.test(span.traceId)
            && span.traceId.toLowerCase() !== HEX_ZERO_TRACE,
        'invalid traceId');
    ensure(typeof span.spanId === 'string' && SPAN_ID.test(span.spanId)
            && span.spanId.toLowerCase() !== HEX_ZERO_SPAN,
        'invalid spanId');
    ensure(Number.isInteger(span.kind) && span.kind >= 0 && span.kind <= 5,
        'invalid OTLP span kind (must be integer, not name)');
    ensure(span.traceId.toLowerCase() === incoming.traceId,
        'unexpected trace id in batch');
    const id = span.spanId.toLowerCase();
    ensure(!ids.has(id), 'duplicate spanId');
    ids.add(id);
    byId.set(id, span);
    ensure(parseNano(span.endTimeUnixNano, 'endTimeUnixNano')
            >= parseNano(span.startTimeUnixNano, 'startTimeUnixNano'),
        'negative span duration');
    ensure(Array.isArray(span.attributes ?? []), 'invalid attributes');
    for (const attr of span.attributes ?? []) {
      ensure(typeof attr.key === 'string' && attr.key.length <= 100,
          'invalid attribute key');
      ensure(!/(authorization|cookie|password|secret|token|http\.target|url\.full|url\.query|db\.statement|request\.body)/i.test(attr.key),
          'forbidden sensitive attribute ' + attr.key);
    }
  }

  const servers = spans.filter(s => s.kind === 2);
  const clients = spans.filter(s => s.kind === 3);
  const internal = spans.filter(s => s.kind === 1 && /actor/i.test(s.name ?? ''));
  ensure(servers.length >= 1, 'missing auto SERVER span');
  ensure(clients.length >= 1, 'missing auto CLIENT span');
  ensure(internal.length >= 1, 'missing auto actor INTERNAL span');
  const server = servers.find(s => s.parentSpanId?.toLowerCase() === incoming.spanId);
  ensure(server, 'SERVER not parented to remote traceparent');
  const actor = internal.find(s => s.parentSpanId?.toLowerCase() === server.spanId.toLowerCase());
  ensure(actor, 'actor span not propagated from SERVER');
  const client = clients.find(s => s.parentSpanId?.toLowerCase() === actor.spanId.toLowerCase());
  ensure(client, 'outbound CLIENT not parented to actor');
  ensure(outbound.spanId === client.spanId.toLowerCase(),
      'outbound traceparent does not identify CLIENT span');
  ensure((Number.parseInt(outbound.flags, 16) & 1) === 1,
      'outbound sampled trace required for captured proof');

  // Only source-free payload consistency is established. Separate trusted CI
  // identities, real execution logs, actual wire PCAP and provenance are needed
  // before any implementation claims an end-to-end PASS.
  return {
    status: 'CAPTURE_SHAPE_CONSISTENT_NOT_EXECUTION_ATTESTED',
    backend: capture.backend,
    trace_id: incoming.traceId,
    spans: spans.length,
    server_span_id: server.spanId.toLowerCase(),
    actor_span_id: actor.spanId.toLowerCase(),
    client_span_id: client.spanId.toLowerCase()
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    process.stderr.write('usage: node verify-otlp-capture.mjs <actual-capture.json>\n');
    process.exitCode = 2;
  } else {
    try {
      const file = readFileSync(process.argv[2]);
      if (file.length > 1048576) throw Error('capture exceeds 1 MiB');
      const capture = JSON.parse(file.toString('utf8'));
      process.stdout.write(JSON.stringify(validateCapture(capture)) + '\n');
    } catch (error) {
      process.stderr.write(String(error.message) + '\n');
      process.exitCode = 1;
    }
  }
}
