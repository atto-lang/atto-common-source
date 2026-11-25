import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../contracts/v1/actor-fatal-fault-classes-v1.json', import.meta.url);
const contract = JSON.parse(readFileSync(path, 'utf8'));
const exactFailures = [
  'guest-panic', 'guest-stack-quota', 'guest-memory-bounds', 'actor-oom',
  'native-segv', 'host-oom', 'os-process-kill', 'vm-corruption'
];
const exactBackends = [
  'oreslang-source.java', 'oreslang-source.llvm', 'oreslang-source.wasm',
  'oreslang-source.forge', 'oreslang-source.net', 'oreslang-source.rs',
  'oreslang-source.cranelift'
];

test('contract is versioned and explicitly uncertified', () => {
  assert.equal(contract.schema, 'atto.actor-fatal-fault-classes.v1');
  assert.equal(contract.status, 'DRAFT_TARGET_NOT_EXECUTED');
  assert.equal(contract.certification, 'NONE');
});
test('fixed failure taxonomy is complete and unique', () => {
  const ids = contract.failure_classes.map(c => c.id);
  assert.deepEqual(ids, exactFailures);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(contract.accepted_scopes, ['actor', 'tenant', 'process']);
});
test('fatal host failures demand external process for actor claim', () => {
  const fatal = contract.failure_classes.filter(c => c.host_fatal);
  assert.deepEqual(fatal.map(c => c.id), exactFailures.slice(4));
  for (const c of fatal) {
    assert.equal(c.external_process_required_for_actor_claim, true);
    assert.equal(typeof c.os_memory_limit_required, 'boolean');
  }
  assert.equal(fatal.find(c => c.id === 'host-oom').os_memory_limit_required, true);
  for (const c of contract.failure_classes.filter(c => !c.host_fatal)) {
    assert.equal(c.external_process_required_for_actor_claim, false);
  }
});
test('every backend remains independently unverified', () => {
  assert.deepEqual(contract.backend_status.map(b => b.id), exactBackends);
  assert.equal(new Set(contract.backend_status.map(b => b.id)).size, exactBackends.length);
  for (const backend of contract.backend_status) {
    assert.equal(backend.status, 'pending');
    assert.equal(backend.actor_containment_certified, false);
    assert.equal(backend.process_fatal_containment_certified, false);
  }
});
test('physical proof fields exclude model-only promotion', () => {
  assert.equal(new Set(contract.evidence_requirements).size, contract.evidence_requirements.length);
  for (const required of [
    'physical_fault_trigger', 'post_fault_sibling_progress',
    'independently_verified_runner_steps', 'compiled_binary_identity'
  ]) assert.ok(contract.evidence_requirements.includes(required));
  assert.ok(!contract.evidence_requirements.includes('model_pass'));
});
