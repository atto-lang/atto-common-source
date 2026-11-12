import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTraceparent, validateCapture} from '../tools/trace-e2e/verify-otlp-capture.mjs';

// Synthetic test data ONLY. Passing these tests does not attest an Atto guest.
const TRACE = '0123456789abcdef0123456789abcdef';
const REMOTE = 'aabbccddeeff0011';
const SERVER = '1111111111111111';
const ACTOR = '2222222222222222';
const CLIENT = '3333333333333333';

function makeCapture() {
  const span = (id, parent, kind, name) => ({
    traceId: TRACE, spanId: id, parentSpanId: parent,
    kind, name, startTimeUnixNano: '1783700000000000000',
    endTimeUnixNano: '1783700000000001000', attributes: []
  });
  return {
    schema: 'attolang.trace-e2e.v1', backend: 'java', source_sha: 'a'.repeat(40),
    execution: {
      compiler_exit_code: 0, executed_steps: ['synthetic build','synthetic server','synthetic HTTP'],
      real_guest_server_started: true, real_http_round_trip: true
    },
    receiver: {content_type: 'application/json', path: '/v1/traces'},
    wire: {
      incoming_traceparent: '00-' + TRACE + '-' + REMOTE + '-01',
      outbound_traceparent: '00-' + TRACE + '-' + CLIENT + '-01'
    },
    otlp: {resourceSpans: [{
      scopeSpans: [{spans: [
        span(SERVER, REMOTE, 2, 'GET /checkout'),
        span(ACTOR, SERVER, 1, 'InventoryActor.receive'),
        span(CLIENT, ACTOR, 3, 'GET /inventory')
      ]}]
    }]}
  };
}

test('synthetic valid capture checks topology but never claims guest execution', () => {
  const checked = validateCapture(makeCapture());
  assert.equal(checked.status, 'CAPTURE_SHAPE_CONSISTENT_NOT_EXECUTION_ATTESTED');
  assert.equal(checked.spans, 3);
  assert.equal(checked.client_span_id, CLIENT);
});

test('W3C traceparent validates fixed-width and rejects zeros/truncation', () => {
  const good = parseTraceparent('00-' + TRACE + '-' + REMOTE + '-01');
  assert.equal(good.traceId, TRACE);
  for (const bad of [
    '00-' + '0'.repeat(32) + '-' + REMOTE + '-01',
    '00-' + TRACE + '-' + '0'.repeat(16) + '-01',
    '00-' + TRACE + '-' + REMOTE + 'x-01',
    'ff-' + TRACE + '-' + REMOTE + '-01',
    '00-' + TRACE + '-' + REMOTE + '-0g'
  ]) assert.throws(() => parseTraceparent(bad), bad);
});

test('invalid wire propagation and unlinked actor/client are rejected', () => {
  const detached = makeCapture();
  detached.otlp.resourceSpans[0].scopeSpans[0].spans[1].parentSpanId = CLIENT;
  assert.throws(() => validateCapture(detached), /actor span/);

  const wrongParent = makeCapture();
  wrongParent.wire.outbound_traceparent =
      '00-' + TRACE + '-' + SERVER + '-01';
  assert.throws(() => validateCapture(wrongParent), /outbound traceparent/);

  const wrongTrace = makeCapture();
  wrongTrace.wire.outbound_traceparent =
      '00-' + 'f'.repeat(32) + '-' + CLIENT + '-01';
  assert.throws(() => validateCapture(wrongTrace), /distributed trace ID/);
});

test('OTLP JSON must encode hex IDs and numeric enum kind', () => {
  const wrongKind = makeCapture();
  wrongKind.otlp.resourceSpans[0].scopeSpans[0].spans[0].kind = 'SPAN_KIND_SERVER';
  assert.throws(() => validateCapture(wrongKind), /OTLP span kind/);

  const base64 = makeCapture();
  base64.otlp.resourceSpans[0].scopeSpans[0].spans[0].traceId = 'ASNFZ4mrze8BI0VniavN7w==';
  assert.throws(() => validateCapture(base64), /invalid traceId/);
});

test('negative duration, duplicate spans, and secret attribute are rejected', () => {
  const wrongTime = makeCapture();
  wrongTime.otlp.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano = '2';
  assert.throws(() => validateCapture(wrongTime), /negative span duration/);

  const duplicated = makeCapture();
  duplicated.otlp.resourceSpans[0].scopeSpans[0].spans[1].spanId = SERVER;
  assert.throws(() => validateCapture(duplicated), /duplicate spanId/);

  const secret = makeCapture();
  secret.otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes =
      [{key: 'http.request.header.authorization', value: {stringValue: 'SECRET'}}];
  assert.throws(() => validateCapture(secret), /forbidden sensitive attribute/);
});

test('report cannot mark a no-op test, missing HTTP or zero-step CI as valid', () => {
  const noSteps = makeCapture();
  noSteps.execution.executed_steps = [];
  assert.throws(() => validateCapture(noSteps), /auditable executed steps/);

  const noServer = makeCapture();
  noServer.execution.real_guest_server_started = false;
  assert.throws(() => validateCapture(noServer), /real guest server/);

  const wrongEndpoint = makeCapture();
  wrongEndpoint.receiver.path = '/v1/metrics';
  assert.throws(() => validateCapture(wrongEndpoint), /OTLP traces endpoint/);
});
