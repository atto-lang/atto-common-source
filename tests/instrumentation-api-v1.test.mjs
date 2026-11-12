import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/v1/instrumentation-api-v1.json', import.meta.url), 'utf8'
));

// SOURCE-FREE CONTRACT CHECKER ONLY. This does not parse or execute AttoLang.
function classify(v) {
  if (v.started_ns <= 0 || v.correlation_id < 0 || v.phase_id <= 0) return 'no_event';
  if (v.buffer_full) return 'dropped';
  return 'record';
}

test('instrumentation status is honest about missing execution and parity', () => {
  assert.equal(contract.schema, 'attolang.instrumentation.v1');
  assert.match(contract.status, /NOT_EXECUTED/);
  for (const status of Object.values(contract.evidence)) {
    assert.ok(['NOT_EXECUTED', 'NOT_IMPLEMENTED'].includes(status));
  }
});

test('hot path is bounded and core telemetry is not an OTel exporter', () => {
  const c = contract.implemented_guest_api;
  assert.equal(c.finish_span.disabled_token, 0);
  assert.equal(c.finish_span.result_disabled, false);
  assert.equal(c.finish_span.requires_single_owner, true);
  assert.equal(c.finish_span.not_idempotent, true);
  assert.equal(c.bounds.buffer_capacity_min, 1);
  assert.equal(c.bounds.buffer_capacity_max, 65536);
  assert.equal(c.bounds.dropped_count_saturates_at, 2147483647);
  assert.equal(contract.layers['ores.core/diagnostics'].depends_on_user_otel, false);
  assert.equal(contract.future_contract.default.includes('off'), true);
});

test('all stable phase IDs are unique and match the original table', () => {
  const p = contract.phase_ids;
  assert.deepEqual(p, {
    phase_function_call: 100, phase_http_client: 200, phase_http_server: 201,
    phase_tcp_connect: 300, phase_tcp_read: 301, phase_tcp_write: 302,
    phase_file_read: 400, phase_file_write: 401,
    phase_actor_send: 500, phase_actor_receive: 501, phase_actor_await: 502
  });
  const ids = Object.values(p);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Number.isInteger));
});

test('reference admission vectors cover disabled, every category, invalid input, saturation', () => {
  const cases = contract.vectors;
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  for (const c of cases) assert.equal(classify(c), c.expect, c.id);
  assert.ok(cases.some(c => c.id === 'off' && c.expect === 'no_event'));
  assert.ok(cases.some(c => c.id === 'saturated' && c.expect === 'dropped'));
});

test('future distributed API reserves W3C identifiers and actor-local context', () => {
  const c = contract.future_contract;
  assert.equal(c.context.trace_id_bytes, 16);
  assert.equal(c.context.span_id_bytes, 8);
  assert.equal(c.context.ids_must_be_nonzero, true);
  assert.equal(c.context.entropy, 'cryptographically secure');
  assert.ok(c.context.wire.includes('traceparent'));
  assert.ok(c.context.wire.includes('tracestate'));
  assert.ok(c.context.attached_to.includes('continuation'));
  assert.ok(c.automatic_hooks.includes('TCP read/write'));
  assert.ok(c.automatic_hooks.includes('await suspend/resume'));
});
