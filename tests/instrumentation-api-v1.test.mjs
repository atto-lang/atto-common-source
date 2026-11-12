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
  assert.match(contract.status, /NO_GUEST_OTLP/);
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
  assert.match(a.mechanisms.foreign_ffi, /never promise arbitrary third-party internals/);
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


test('freestanding context remains separated from hosted exporter and compiler ABI', () => {
  const n = contract.auto_instrumentation.namespaces;
  assert.match(n['ores.core/trace'], /freestanding immutable/);
  assert.match(n['ores.std/trace'], /existing hosted Atto timing/);
  assert.match(n['ores.std/telemetry'], /bounded asynchronous collector/);
  assert.match(n['internal/probe_abi'], /not importable from guest code/);
});


test('scoped using preserves existing borrow semantics and requires typed unwinding', () => {
  const scoped = contract.scoped_using;
  assert.equal(scoped.spelling, 'using telemetry.span(name) as span { body }');
  assert.match(scoped.compatibility, /retains existing contextual using resource\.borrow/);
  assert.match(scoped.compiler_ast, /TryStmt finally/);
  assert.ok(scoped.behavior.some(x => x.includes('exactly once')));
  assert.ok(scoped.current_limitations.some(x => /NOT_EXECUTED|not executed/i.test(x)));
});

test('runtime policy switches only precompiled sites and does not permit patching', () => {
  const dyn = contract.dynamic_activation;
  assert.equal(dyn.no_monkey_patching, true);
  assert.match(dyn.no_redeploy_if, /pre-emitted/);
  assert.ok(dyn.rejected_mechanisms.includes('Java agents'));
  assert.match(dyn.backend_constraints.llvm_aot, /no new probes if stripped/);
  assert.match(dyn.backend_constraints.net_native_aot, /precompiled probes only/);
  assert.match(dyn.control.max_coverage, /never exceeded/);
  assert.match(dyn.control.generation, /fence stale callbacks/);
});

test('end-to-end target is not claimed as completed by synthetic harness tests', () => {
  const e2e = contract.e2e_http_actor_client_otlp;
  assert.equal(e2e.status, 'NOT_IMPLEMENTED_NOT_EXECUTED');
  assert.ok(e2e.steps.some(s => s.includes('LLVM')));
  assert.ok(e2e.steps.some(s => s.includes('OTLP receiver')));
  assert.ok(e2e.steps.some(s => s.includes('immutable Context metadata')));
  assert.match(e2e.forbidden_shortcut, /synthetic trace fixtures/);
  assert.equal(contract.evidence.auto_otel_e2e, 'NOT_IMPLEMENTED');
});


test('Java source milestones are partial and still require executed guest evidence', () => {
  const java = contract.implementation_progress.java_graal;
  assert.match(java.call_probe, /automatic.*numeric admission timing/);
  assert.match(java.recording, /no OTLP export/i);
  assert.match(java.actor_context, /private mailbox metadata/);
  assert.match(java.task_context, /heap-retained TaskContext/);
  assert.match(java.outbound_http, /W3C v00 child/);
  assert.match(java.inbound_http, /SERVER span starts/);
  assert.match(java.inbound_http, /physical exchange retirement/);
  assert.match(java.host_composition_test, /No socket/);
  assert.match(java.exporter, /NOT_IMPLEMENTED/);
  assert.equal(contract.evidence.java_auto_calls_guest, 'NOT_EXECUTED');
  assert.equal(contract.evidence.java_actor_mail_context, 'NOT_EXECUTED');
  assert.equal(contract.evidence.java_outbound_w3c_headers, 'NOT_EXECUTED');
});

test('LLVM W3C wire carrier is host ABI only, never promoted to guest parity', () => {
  const llvm = contract.implementation_progress.llvm;
  assert.match(llvm.w3c_v00, /no-allocation/);
  assert.match(llvm.source_guest, /NOT_IMPLEMENTED/);
  assert.match(llvm.isolated_w3c_smoke, /NOT LLVM-compiled Atto guest/);
  assert.equal(contract.evidence.llvm_traceparent_ctest, 'NOT_EXECUTED');
});


test('isolated exact-blob host smoke is real but cannot substitute for backend guests', () => {
  const e = contract.host_smoke_evidence;
  assert.equal(e.java_w3c.status, 'PASS_ISOLATED_EXACT_GITHUB_BLOB');
  assert.match(e.java_w3c.blob_sha, /^[0-9a-f]{40}$/);
  assert.match(e.java_w3c.scope_limit, /Not JDK25/);
  assert.equal(e.java_semantic_staging.blobs.length, 3);
  assert.equal(e.java_semantic_staging.status, 'PASS_ISOLATED_EXACT_GITHUB_BLOBS_WITH_TEST_STUBS');
  assert.match(e.java_semantic_staging.result, /736 dropped/);
  assert.equal(e.llvm_w3c_host.status, 'PASS_ISOLATED_EXACT_GITHUB_BLOBS');
  assert.ok(e.llvm_w3c_host.sanitizers.includes('ASan'));
  assert.ok(e.llvm_w3c_host.sanitizers.includes('UBSan'));
  assert.match(e.llvm_w3c_host.scope_limit, /Not exact-head CMake/);
  assert.equal(contract.evidence.zero_code_guest_end_to_end, 'NOT_EXECUTED');
});

test('staged semantic spans and native Atto batch are not misrepresented as OTLP export', () => {
  const java = contract.implementation_progress.java_graal;
  assert.match(java.semantic_span_lifecycle, /HOST STAGING IMPLEMENTED/);
  assert.match(java.semantic_span_lifecycle, /idempotent Scope.finish/);
  assert.match(java.exporter, /PARTIAL_NATIVE_ATTO_DATA_ONLY/);
  assert.match(java.exporter, /actual source collector ACTOR/);
  assert.match(java.exporter, /NOT_IMPLEMENTED/);
  assert.match(java.scoped_using, /trusted SpanScope type\/effect.*NOT_IMPLEMENTED/);
  assert.equal(contract.e2e_http_actor_client_otlp.status, 'NOT_IMPLEMENTED_NOT_EXECUTED');
});


test('LLVM native semantic staging host smoke is exact-blob but never promoted to guest parity', () => {
  const e = contract.host_smoke_evidence.llvm_semantic_staging;
  assert.equal(e.status, 'PASS_ISOLATED_EXACT_GITHUB_BLOBS');
  assert.match(e.header_sha, /^[0-9a-f]{40}$/);
  assert.match(e.test_sha, /^[0-9a-f]{40}$/);
  assert.match(e.result, /736 drops/);
  assert.match(e.scope_limit, /Does not execute full CMake\/CTest/);
  assert.ok(e.compilers.some(s => s.includes('GCC')));
  assert.ok(e.compilers.some(s => s.includes('Clang')));
  const llvm = contract.implementation_progress.llvm;
  assert.match(llvm.native_telemetry_actor, /NOT_IMPLEMENTED/);
  assert.match(llvm.semantic_span_staging, /host-only exact-GitHub-blob/);
  assert.equal(contract.evidence.llvm_native_semantic_staging_ctest, 'NOT_EXECUTED');
  assert.equal(contract.evidence.llvm_guest_semantic_spans, 'NOT_IMPLEMENTED');
});
