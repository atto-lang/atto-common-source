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
