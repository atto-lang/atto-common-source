import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const foundation = readJson('contracts/v1/core-actor-foundation-v1.json');
const protocols = readJson('contracts/v1/core-protocols-v1.json');

const expectedPolicy = {
  user_facing_implementation: 'NATIVE_ATTO_ONLY',
  backend_role: 'COMPILER_LOWERING_SCHEDULER_MEMORY_AND_CAPABILITY_ENFORCEMENT',
  runtime_authority_cannot_be_user_implemented: true,
  base_class_inheritance_grants_control: false,
  supervisor_control_source: 'TRUSTED_RUNTIME_ONLY',
  guest_callable_control_ingress: false,
  guest_callable_init_or_receive: false,
  actor_mail_envelope_is_authority: false,
  actor_id_is_sender_capability: false,
  actor_ref_identity: 'IMMUTABLE_GENERATION_AND_CODE_IMAGE_FENCED',
  state_direct_access: false,
  critical_loan_may_escape_or_suspend: false,
  mailbox_full_send: 'ASYNC_SUSPEND_WITHOUT_CARRIER_PARKING',
  mailbox_nonblocking_send: 'try_send',
  mailbox_async_send: 'send_async',
  mailbox_admission: 'LINEARIZABLE_QUOTA_CHECKED',
  control_priority: 'SEPARATE_TRUSTED_PATH_NOT_USER_BACKPRESSURE',
  panic_delivery: 'UNINTERCEPTABLE_SUPERVISOR_NOTICE',
  pending_completion: 'EXACTLY_ONCE_SETTLEMENT_AND_QUOTA_REFUND',
  service_trait_grants_actor_endpoint: false,
  hosted_import_grants_permission: false,
  blocking_host_io_fallback_allowed: false
};

const coreTypeNames = [
  'Option<T>', 'Result<T,E>', 'Error', 'Future<T>', 'Iterator<T>',
  'ActorId', 'ActorMail<T>', 'ActorOutput<T>', 'ActorRef<A>',
  'Channel<T>', 'ReadChannel<T>', 'WriteChannel<T>'
];

const hosted = [
  ['HttpActor', 'NETWORK'],
  ['TcpActor', 'NETWORK'],
  ['WebSocketActor', 'NETWORK'],
  ['ChildProcManager', 'PROCESS'],
  ['PersistenceActor', 'FILESYSTEM_OR_STORAGE_PROVIDER']
];

function verify(model) {
  assert.equal(model.schema, 'attolang.core-actor-foundation.v1');
  assert.equal(model.status, 'DESIGN_ONLY_BACKEND_EXECUTION_UNVERIFIED');
  assert.equal(model.based_on_core_protocols, 'contracts/v1/core-protocols-v1.json');
  assert.deepEqual(model.native_actor_policy, expectedPolicy,
    'guest actor code must be native Atto; backend primitives never grant ambient authority');
  assert.deepEqual(model.core_types.map(x => x.name), coreTypeNames,
    'closed core roster; no hosted capability can masquerade as a core value');
  assert.deepEqual(model.core_types.filter(x => x.authority === 'runtime-minted')
    .map(x => x.name), ['ActorRef<A>', 'Channel<T>', 'ReadChannel<T>', 'WriteChannel<T>']);
  for (const type of model.core_types) {
    assert.ok(type.role && typeof type.role === 'string');
    assert.ok(['none', 'runtime completion only', 'runtime-minted'].includes(type.authority),
      'unexpected core authority: ' + type.name);
  }
  assert.deepEqual(model.core_actor_bases.map(x => x.name), [
    'Actor', 'SupervisorActor', 'ServiceActor<Request,Reply>'
  ]);
  for (const [i, base] of model.core_actor_bases.entries()) {
    assert.equal(base.runtime_owned, true);
    assert.equal(base.guest_defined_privilege, false);
    assert.equal(base.implementation, 'native_atto_or_compiler_intrinsic');
    assert.equal(base.control_access, i === 1);
    assert.equal(base.control_authority,
      i === 1 ? 'runtime_authenticated_supervisor_only' : 'none');
    assert.equal(base.private_control_ingress, i === 1);
    assert.equal(base.stage, i === 0 ? 'existing_language_intrinsic' : 'proposed_checked_base');
  }
  assert.deepEqual(model.std_hosted_bases.map(x => [x.name, ...x.requires]), hosted);
  for (const adapter of model.std_hosted_bases) {
    assert.equal(adapter.stage, 'proposed_hosted_adapter');
    assert.equal(adapter.privileged, false);
    assert.equal(adapter.guest_implementation, 'native_atto');
    assert.equal(adapter.runtime_permission_enforced, true);
    assert.equal(adapter.nonblocking_provider_required, true);
  }
  assert.deepEqual(model.not_separate_actor_kinds,
    ['StatefulActor', 'EventSourcedActor', 'SerialHttpActor']);
  assert.deepEqual(model.compiler_runtime_authorities,
    ['Sendable', 'Shareable', 'Copy', 'Drop', 'Receives', 'Supervisor', 'ActorLifecycle']);
  assert.deepEqual(model.compiler_runtime_authorities,
    protocols.compiler_intrinsics_not_user_implementable);
  assert.deepEqual(Object.keys(model.backend_evidence).sort(),
    ['forge', 'java', 'llvm', 'net', 'wasm']);
  assert.ok(Object.values(model.backend_evidence).every(x => x === 'NOT_EXECUTED'));
  const invariants = model.security_invariants.join('\n');
  assert.match(invariants, /runtime validates parent\/child incarnation/);
  assert.match(invariants, /without parking a runtime carrier/);
  assert.match(invariants, /must never be convertible to a sender/);
}

test('native Atto bases have closed, exact runtime authority constraints', () => {
  verify(foundation);
});

test('negative capability, hierarchy, permission, mailbox and evidence mutations reject', () => {
  const edits = [
    x => { x.native_actor_policy.user_facing_implementation = 'JAVA_HOST_CLASS'; },
    x => { x.native_actor_policy.base_class_inheritance_grants_control = true; },
    x => { x.native_actor_policy.guest_callable_control_ingress = true; },
    x => { x.native_actor_policy.guest_callable_init_or_receive = true; },
    x => { x.native_actor_policy.actor_mail_envelope_is_authority = true; },
    x => { x.native_actor_policy.actor_id_is_sender_capability = true; },
    x => { x.native_actor_policy.state_direct_access = true; },
    x => { x.native_actor_policy.critical_loan_may_escape_or_suspend = true; },
    x => { x.native_actor_policy.mailbox_full_send = 'BLOCK_CARRIER_THREAD'; },
    x => { x.native_actor_policy.mailbox_nonblocking_send = 'blocking_send'; },
    x => { x.native_actor_policy.control_priority = 'SHARED_USER_MAILBOX'; },
    x => { x.native_actor_policy.pending_completion = 'BEST_EFFORT'; },
    x => { x.native_actor_policy.service_trait_grants_actor_endpoint = true; },
    x => { x.native_actor_policy.hosted_import_grants_permission = true; },
    x => { x.native_actor_policy.blocking_host_io_fallback_allowed = true; },
    x => { x.core_actor_bases[1].runtime_owned = false; },
    x => { x.core_actor_bases[1].control_authority = 'inherited_by_guest'; },
    x => { x.core_actor_bases[2].control_access = true; },
    x => { x.core_actor_bases.push({name: 'PrivilegedActor'}); },
    x => { x.core_types.push({name: 'UntrustedControl', role: 'CONTROL', authority: 'none'}); },
    x => { x.core_types[8].authority = 'none'; },
    x => { x.std_hosted_bases[0].requires = []; },
    x => { x.std_hosted_bases[3].requires = ['NETWORK']; },
    x => { x.std_hosted_bases[4].privileged = true; },
    x => { x.std_hosted_bases[2].nonblocking_provider_required = false; },
    x => { x.std_hosted_bases[3].runtime_permission_enforced = false; },
    x => { x.backend_evidence.forge = 'PASSED'; },
    x => { x.security_invariants = []; }
  ];
  for (const [i, change] of edits.entries()) {
    const mutant = structuredClone(foundation);
    change(mutant);
    assert.throws(() => verify(mutant), 'mutant ' + i + ' must reject');
  }
});

test('trait imports cannot confer actor authority and core source stays freestanding', () => {
  const source = readFileSync(new URL('library/ores.core/protocols.atto', root), 'utf8');
  assert.equal(Object.keys(protocols.traits).length, 19);
  assert.deepEqual(protocols.traits.ReadWrite.extends, ['Read<E>', 'Write<E>']);
  assert.deepEqual(protocols.traits.Transform.extends, ['Sink<I, E>', 'Source<O, E>']);
  assert.deepEqual(protocols.traits.Service.methods, ['call_async']);
  assert.deepEqual(protocols.traits.BatchWritable.methods, ['send_batch_async']);
  assert.deepEqual(protocols.traits.KeyValueStore.methods,
    ['get_async', 'put_async', 'delete_async']);
  for (const name of foundation.compiler_runtime_authorities) {
    assert.doesNotMatch(source,
      new RegExp('\\bdefine\\s+(?:pub\\s+)?(?:trait|interface|contract)\\s+' + name + '\\b'));
  }
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|use namespace)\s+ores\.std\b/m);
  assert.doesNotMatch(source, /\b(?:spawn|critical-write|critical-read|unsafe)\b/);
});
