// Conformance catalog sanity only. These tests do NOT execute the Oreslang
// compiler or prove runtime/backend parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(
  new URL('../fixtures/in-memory-actor-pubsub-v1.json', import.meta.url),
  'utf8',
));

test('pubsub-v1 manifest is well formed and contains unique pending cases', () => {
  assert.equal(spec.contract, 'in-memory-actor-pubsub-v1');
  assert.equal(spec.status, 'SOURCE_CONTRACT_ONLY');
  assert.ok(spec.cases.length >= 45, 'must retain the v1 safety matrix');
  const ids = new Set();
  for (const item of spec.cases) {
    assert.match(item.id, /^[a-z][a-z0-9_]*$/);
    assert.ok(!ids.has(item.id), 'duplicate id: ' + item.id);
    ids.add(item.id);
    assert.ok(['runtime', 'race', 'security', 'source_positive', 'source_negative'].includes(item.category));
    assert.ok(['accept', 'reject'].includes(item.expected));
    assert.equal(item.status, 'pending_backend_execution',
      'catalog cannot claim host-only or unexecuted cases have passed');
    assert.ok(item.assertion.length >= 30, 'assertion needs a concrete oracle: ' + item.id);
  }
});

test('pubsub-v1 conformance targets all known toolchains explicitly', () => {
  assert.deepEqual([...spec.required_backends].sort(), [
    'cranelift', 'forge', 'java', 'llvm', 'net', 'wasm',
  ]);
  assert.ok(spec.cases.some(c => c.category === 'source_negative'));
  assert.ok(spec.cases.some(c => c.category === 'source_positive'));
  assert.ok(spec.cases.some(c => c.category === 'race'));
});

test('pubsub-v1 mandatory ownership, security and fanout scenarios are registered', () => {
  const present = new Set(spec.cases.map(x => x.id));
  const required = [
    'group_join_two', 'group_leave_independent', 'group_close_independent',
    'group_membership_not_subscription', 'group_topic_isolation',
    'runtime_topic_cross_groups', 'runtime_topic_wrong_runtime',
    'topic_non_sendable', 'topic_grant_forged_id', 'topic_grant_wrong_incarnation',
    'topic_reliable_atomic_failure', 'topic_latest_replace', 'topic_lossy_drop',
    'topic_fanout_lock_safe', 'topic_control_priority',
    'topic_lease_cancel_idempotent', 'topic_1000_way_race',
    'topic_private_domain_unimplemented', 'topic_hard_rt_bounds',
    'topic_observable_actor_separate', 'topic_address_bus_separate',
  ];
  for (const id of required) assert.ok(present.has(id), 'missing: ' + id);
});
