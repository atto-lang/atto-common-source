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
  assert.ok(c.automatic_hooks.includes('TCP connect/read/write'));
  assert.ok(c.automatic_hooks.includes('await suspend/resume'));
});


test('zero-code automatic instrumentation has no dynamic interception requirement', () => {
  const a = contract.auto_instrumentation;
  assert.equal(a.status, 'PROPOSED_NOT_IMPLEMENTED');
  assert.match(a.goal, /no application-level imports/);
  for (const forbidden of ['monkey patching','Java agents','reflection-based interception','dynamic bytecode rewriting']) {
    assert.ok(a.forbidden.includes(forbidden), forbidden);
  }
  assert.match(a.mechanisms.compiler, /HIR\/MIR/);
  assert.match(a.mechanisms.runtime, /actor/);
  assert.match(a.mechanisms.stdlib, /HTTP/);
  assert.match(a.mechanisms.foreign_ffi, /not.*arbitrary third-party internals/);
});

test('trace-capable binaries start off and never turn missing probe sites on', () => {
  const a = contract.auto_instrumentation;
  assert.equal(a.runtime.enabled_default, false);
  assert.deepEqual(a.runtime.modes, ['off','boundaries','calls','full']);
  assert.equal(a.runtime.default_enabled_mode, 'boundaries');
  assert.equal(a.runtime.sampling_default_when_enabled, 0.05);
  assert.deepEqual(a.build.variants, ['trace_capable','trace_stripped']);
  assert.match(a.build.trace_stripped, /cannot turn on missing call-site coverage/);
  assert.match(a.build.options.precedence, /runtime.*cannot add missing probes/);
  assert.match(a.probe_abi.recording, /before timestamp/);
  assert.ok(a.behavior_gates.some(x => x.includes('without rebuild')));
});

test('logical async propagation and effects stay distinct from recording', () => {
  const a = contract.auto_instrumentation;
  assert.match(a.propagation.enabled_unsampled, /nonrecording spans/);
  assert.match(a.propagation.carrier, /continuation/);
  assert.match(a.propagation.restart, /revoked generation/);
  assert.match(a.probe_abi.error_handling, /supervisor CONTROL notice/);
  assert.match(a.probe_abi.lifecycle, /fatal process abort/);
  assert.match(a.probe_abi.host_boundary, /separate runtime-internal diagnostic events/);
  assert.ok(a.probe_abi.outcome.includes('cancel'));
  assert.ok(a.probe_abi.outcome.includes('panic'));
});

test('OTel configuration does not provide new permissions', () => {
  const c = contract.auto_instrumentation.configuration;
  assert.ok(c.environment.includes('OTEL_SDK_DISABLED'));
  assert.ok(c.environment.includes('OTEL_TRACES_SAMPLER'));
  assert.ok(c.environment.includes('OTEL_EXPORTER_OTLP_ENDPOINT'));
  assert.match(c.environment_cannot_grant, /network\/filesystem/);
  assert.match(c.otel_disabled_semantics, /propagation policy remains independent/);
});
