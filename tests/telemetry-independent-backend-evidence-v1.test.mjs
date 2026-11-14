import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/v1/telemetry-independent-backend-evidence-v1.json', import.meta.url),
  'utf8',
));
const byId = new Map(contract.backends.map(backend => [backend.id, backend]));

test('shared behavior never implies a shared compiler/MIR', () => {
  assert.equal(contract.schema, 'atto.telemetry.independent-backends.v1');
  assert.equal(contract.status, 'TARGET_SOURCE_CONTRACT_NOT_EXECUTABLE_PARITY');
  assert.equal(contract.rules.compiler_implementation_shared, false);
  assert.equal(contract.rules.shared_mir_required, false);
  assert.equal(contract.rules.cross_backend_source_id_format, true);
  assert.equal(contract.rules.runtime_jit_required_for_tracing, false);
  assert.equal(contract.rules.no_python_tooling, true);
});

test('each backend gets a separate implementation profile and repository', () => {
  assert.deepEqual([...byId.keys()].sort(),
    ['java','llvm','net','rs','cranelift','forge','wasm'].sort());
  assert.equal(new Set(contract.backends.map(x => x.repository)).size, 7);
  for (const backend of contract.backends) {
    assert.ok(backend.compiler_family.length >= 10);
    assert.ok(backend.source_map.length >= 10);
    assert.ok(backend.aot.length >= 10);
    assert.ok(backend.jit.length >= 10);
  }
});

test('Rust object compiler and independent Cranelift JIT are NOT aliases', () => {
  assert.notEqual(byId.get('rs').repository, byId.get('cranelift').repository);
  assert.equal(byId.get('rs').independent_source_frontend, true);
  assert.equal(byId.get('cranelift').independent_source_frontend, true);
  assert.match(byId.get('rs').jit, /no automatic linkage/);
});

test('Wasm source-to-Wasm bridge is not falsely called independent', () => {
  assert.equal(byId.get('wasm').independent_source_frontend, false);
  assert.match(byId.get('wasm').current_compiler_dependency, /LLVM/);
  assert.ok(contract.prohibited_evidence_substitutions.some(v =>
    v.includes('independent_wasm_frontend')));
});

test('source-control IDs and runtime OpenTelemetry identity are not conflated', () => {
  const r = contract.rules;
  assert.match(r.routine_id_type, /^rid_/);
  assert.match(r.site_id_type, /^sid_/);
  assert.match(r.runtime_trace_id, /distinct from routine_id and site_id/);
  assert.match(r.runtime_span_id, /distinct from source identities/);
  assert.equal(r.source_id_rekey_on_jit_recompile, false);
  assert.equal(r.source_id_rekey_on_source_formatting, false);
  assert.equal(r.hot_load_generation_must_pin_source_map, true);
});

test('source, native host and guest compiled claims have separate evidence gates', () => {
  const substitutions = contract.prohibited_evidence_substitutions;
  for (const pattern of ['nativeaot_host', 'llvm_native_host', 'host_dispatch', 'zero_step']) {
    assert.ok(substitutions.some(v => v.includes(pattern)), pattern);
  }
  assert.ok(contract.gate_names.includes('independent_frontend_and_type_checker'));
  assert.ok(contract.gate_names.includes('own_lowering_and_compiled_guest_artifact'));
  assert.ok(contract.gate_names.includes('jit_codegen_proof_if_claimed'));
  assert.ok(contract.gate_names.includes('nonzero_step_ci_and_exact_source_sha'));
});

test('experimental implementation reports explicitly exclude unsupported tracing modes', () => {
  for (const candidate of contract.candidate_adapters) {
    assert.ok(byId.has(candidate.backend));
    assert.ok(candidate.pr.startsWith('https://github.com/'));
    assert.ok(candidate.not_verified.length > 0);
  }
});

test('canonical source ID byte-order vectors preserve independent native layouts', () => {
  assert.match(contract.rules.source_id_binary_encoding, /network byte order/);
  assert.equal(contract.source_id_test_vectors.length, 2);
  for (const vector of contract.source_id_test_vectors) {
    const prefix = vector.kind === 'routine' ? 'rid_' : 'sid_';
    assert.equal(vector.text.slice(0, 4), prefix);
    const hex = vector.text.slice(4);
    assert.match(hex, /^[0-9a-f]{32}$/);
    assert.equal(hex, vector.bytes_hex);
    assert.equal(hex.slice(0, 16), vector.lane_high_hex);
    assert.equal(hex.slice(16), vector.lane_low_hex);
    assert.notEqual(hex, '0'.repeat(32));
  }
  for (const vector of contract.invalid_source_id_test_vectors) {
    const prefix = vector.kind === 'routine' ? 'rid_' : 'sid_';
    const valid = vector.text.startsWith(prefix) &&
      /^[0-9a-f]{32}$/.test(vector.text.slice(4)) &&
      vector.text.slice(4) !== '0'.repeat(32);
    assert.equal(valid, false, vector.reason);
  }
});

test('candidate metadata and execution gates do not certify guest callsites', () => {
  for (const id of ['rs', 'llvm', 'java']) {
    const candidate = contract.candidate_adapters.find(x => x.backend === id);
    assert.ok(candidate, id);
    assert.ok(candidate.not_verified.some(x =>
      /guest|probe|OTel|OTLP|lowering|Maven|Cargo|IR integration/i.test(x)), id);
  }
  assert.ok(contract.gate_names.includes('compiler_owned_guest_source_id_binding'));
  assert.ok(contract.gate_names.includes('runtime_site_probe_in_compiled_guest_not_only_host'));
  assert.ok(contract.prohibited_evidence_substitutions.includes(
    'source_only_registry_validation_as_compiled_site_instrumentation'));
});

test('host ring proof cannot satisfy linked guest logging evidence', () => {
  for (const key of [
    'distinct_checked_guest_log_site_ids',
    'compiled_guest_log_callsite_and_host_ring_both_executed',
    'exact_head_compiler_linked_guest_native_evidence'
  ]) assert.ok(contract.gate_names.includes(key), key);
  for (const key of [
    'java_source_ast_binding_as_executed_guest_logging',
    'llvm_host_static_log_ring_as_compiled_guest_ir_or_linked_aot_proof'
  ]) assert.ok(contract.prohibited_evidence_substitutions.includes(key), key);
  const llvm = contract.candidate_adapters.find(x => x.backend === 'llvm');
  assert.match(llvm.verified_scope, /C11 static log ring compiled and executed/);
  assert.ok(llvm.not_verified.includes('LLVM SDK compiler IR selftest'));
  assert.ok(llvm.not_verified.includes('actual linked AOT guest fixture with log.info'));
  const java = contract.candidate_adapters.find(x => x.backend === 'java');
  assert.ok(java.not_verified.includes('actual Truffle guest log.info runtime event'));
  const rs = contract.candidate_adapters.find(x => x.backend === 'rs');
  assert.ok(rs.not_verified.includes('automatic site-ID assignment'));
});

test('audited source identity fixes do not bypass pending compiler evidence', () => {
  for (const gate of [
    'exact_ast_verified_function_binding',
    'source_log_return_expression_fail_closed',
    'rust_root_level_proposal_no_clobber',
    'native_log_50k_fifo_model_evidence'
  ]) assert.ok(contract.gate_names.includes(gate), gate);
  const rs = contract.candidate_adapters.find(c => c.backend === 'rs');
  assert.match(rs.verified_scope, /Cargo tests not executed/);
  const llvm = contract.candidate_adapters.find(c => c.backend === 'llvm');
  assert.match(llvm.verified_scope, /3\/3 local CTest/);
  assert.match(llvm.verified_scope, /50k operation FIFO model/);
  assert.ok(llvm.not_verified.includes('LLVM SDK compiler IR selftest'));
  const java = contract.candidate_adapters.find(c => c.backend === 'java');
  assert.match(java.verified_scope, /unexecuted/);
  assert.ok(java.not_verified.includes('actual Truffle guest log.info runtime event'));
});

test('linked synthetic IR and synthetic Java AST cannot masquerade as real guest compilers', () => {
  for (const name of [
    'ordinary_llvm_cli_verified_manifest_to_generated_guest',
    'linked_guest_exit42_and_both_source_sites',
    'real_java_parser_to_guest_log_execution',
  ]) assert.ok(contract.gate_names.includes(name), name);
  assert.ok(contract.prohibited_evidence_substitutions.includes(
    'source_free_linked_llvm_ir_as_atto_compiler_generated_guest'));
  assert.ok(contract.prohibited_evidence_substitutions.includes(
    'synthetic_java_ast_as_real_java_parser_or_truffle_guest'));

  const llvm = contract.candidate_adapters.find(item => item.backend === 'llvm');
  assert.match(llvm.verified_scope, /source-free manually authored LLVM IR/);
  assert.ok(llvm.not_verified.some(item =>
    item.includes('ordinary --source-log-ids .atto compiler')));
  const java = contract.candidate_adapters.find(item => item.backend === 'java');
  assert.match(java.verified_scope, /synthetic AST fixture/);
  assert.ok(java.not_verified.includes('real Java Parser.parse + Maven/JUnit suite'));
});
