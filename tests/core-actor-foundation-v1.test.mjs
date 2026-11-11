import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const load = relative => JSON.parse(readFileSync(new URL(relative, root), 'utf8'));
const contract = load('contracts/v1/core-actor-foundation-v1.json');
const protocols = load('contracts/v1/core-protocols-v1.json');
const source = readFileSync(new URL('library/ores.core/protocols.atto', root), 'utf8');
const doc = readFileSync(new URL('docs/CORE_AND_ACTOR_BASE_CLASSES_V1.md', root), 'utf8');

function verifyFoundation(model) {
  assert.equal(model.schema, 'attolang.core-actor-foundation.v1');
  assert.equal(model.status, 'DESIGN_ONLY_BACKEND_EXECUTION_UNVERIFIED');
  assert.equal(model.based_on_core_protocols, 'contracts/v1/core-protocols-v1.json');

  const bases = model.core_actor_bases;
  assert.deepEqual(bases.map(x => x.name), [
    'Actor', 'SupervisorActor', 'ServiceActor<Request,Reply>'
  ]);
  assert.ok(bases.every(x => x.runtime_owned === true));
  assert.equal(bases[0].stage, 'existing_language_intrinsic');
  assert.equal(bases[0].control_access, false);
  assert.equal(bases[1].stage, 'proposed_checked_base');
  assert.equal(bases[1].control_access, true);
  assert.equal(bases[2].control_access, false);

  const std = model.std_hosted_bases;
  assert.deepEqual(std.map(x => x.name), [
    'HttpActor', 'TcpActor', 'WebSocketActor',
    'ChildProcManager', 'PersistenceActor'
  ]);
  assert.ok(std.every(x => x.stage === 'proposed_hosted_adapter'));
  assert.ok(std.every(x => x.privileged === false));
  assert.ok(std.every(x => x.requires.length > 0));
  assert.deepEqual(std.slice(0, 3).map(x => x.requires), [
    ['NETWORK'], ['NETWORK'], ['NETWORK']
  ]);
  assert.deepEqual(std[3].requires, ['PROCESS']);
  assert.deepEqual(std[4].requires, ['FILESYSTEM_OR_STORAGE_PROVIDER']);

  assert.deepEqual(model.not_separate_actor_kinds,
    ['StatefulActor', 'EventSourcedActor', 'SerialHttpActor']);
  assert.deepEqual(model.compiler_runtime_authorities,
    ['Sendable', 'Shareable', 'Copy', 'Drop',
     'Receives', 'Supervisor', 'ActorLifecycle']);
  assert.deepEqual(model.compiler_runtime_authorities,
    protocols.compiler_intrinsics_not_user_implementable);
  assert.equal(new Set(model.core_types.map(x => x.name)).size,
    model.core_types.length);
  for (const typed of model.core_types) {
    assert.ok(typed.role.length > 0);
    assert.ok(!/network|socket|filesystem|process provider/i.test(typed.role),
      'core type cannot import hosted adapter: ' + typed.name);
  }
  for (const typeName of ['ActorRef<A>', 'Channel<T>',
    'ReadChannel<T>', 'WriteChannel<T>']) {
    const type = model.core_types.find(x => x.name === typeName);
    assert.equal(type?.authority, 'runtime-minted', typeName);
  }
  assert.deepEqual(model.existing_hosted_policy_modules,
    ['stdlib/otp/supervisor.ores', 'stdlib/actor_persistence.ores']);
  const invariants = model.security_invariants.join(' ').toLowerCase();
  for (const term of ['control', 'critical-read', 'panic',
    'generation', 'permission', 'nonblocking', 'cancellation',
    'sendable', 'init', 'mailbox']) {
    assert.ok(invariants.includes(term), 'missing core invariant: ' + term);
  }
  assert.deepEqual(Object.keys(model.backend_evidence).sort(),
    ['forge', 'java', 'llvm', 'net', 'wasm']);
  assert.ok(Object.values(model.backend_evidence)
    .every(value => value === 'NOT_EXECUTED'));
}

test('base actor catalog preserves compiler/runtime authority', () => {
  verifyFoundation(contract);
});

test('runtime ownership and host permission mutations fail closed', () => {
  const mutate = fn => {
    const candidate = structuredClone(contract);
    fn(candidate);
    assert.throws(() => verifyFoundation(candidate));
  };
  mutate(x => { x.core_actor_bases[1].runtime_owned = false; });
  mutate(x => { x.core_actor_bases[0].control_access = true; });
  mutate(x => { x.core_actor_bases[2].control_access = true; });
  mutate(x => { x.std_hosted_bases[0].privileged = true; });
  mutate(x => { x.std_hosted_bases[3].requires = []; });
  mutate(x => { x.std_hosted_bases[4].requires = ['NETWORK']; });
  mutate(x => { x.not_separate_actor_kinds = []; });
  mutate(x => { x.compiler_runtime_authorities.pop(); });
  mutate(x => { x.backend_evidence.java = 'PASSED'; });
  mutate(x => { x.core_types.find(y => y.name === 'ActorRef<A>').authority = 'none'; });
  mutate(x => { x.security_invariants = ['all fine']; });
});

test('catalog cannot silently upgrade declarations into guest execution', () => {
  assert.equal(Object.keys(protocols.traits).length, 19);
  for (const name of Object.keys(protocols.traits)) {
    assert.match(source, new RegExp('define pub trait ' + name + '\\b'),
      'missing canonical source trait ' + name);
  }
  assert.doesNotMatch(source, /(?:^|\n)\s*import\s/m);
  assert.match(doc, /design.source.only/i);
  assert.match(doc, /Java actor PR #2901/);
  assert.match(doc, /not an OTP\s+supervisor implementation/i);
  assert.match(doc, /async reactor\/NIO only/i);
  for (const name of ['SupervisorActor', 'ServiceActor', 'HttpActor',
    'ChildProcManager', 'ActorRef', 'critical']) {
    assert.ok(doc.includes(name), 'missing implementation boundary ' + name);
  }
});
