import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

const contract = JSON.parse(readFileSync(new URL('../fixtures/observable-actor-v1.json', import.meta.url)));
test('actor-only, sendable, typed subscription contract is pinned', () => {
  assert.equal(contract.schema, 'oreslang.observable-actor.v1');
  assert.equal(contract.status, 'SOURCE_CONTRACT_ONLY');
  assert.equal(contract.actor_only, true);
  assert.equal(contract.generic_event_bound, 'Sendable');
  assert.equal(contract.subscription_sendable, false);
  assert.equal(contract.receipt_means, 'delivery_admission_not_processing');
  assert.equal(contract.control_path, 'supervisor_only');
  assert.deepEqual(contract.publisher_hooks, [
    'on_observer_subscribed','on_observer_unsubscribed','on_event_published'
  ]);
});
test('fixtures have unique ids, closed outcomes and targeted negative cases', () => {
  const ids = contract.cases.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 24);
  for (const row of contract.cases) {
    assert.ok(['accept','reject'].includes(row.expect), row.id);
    assert.ok(['compile','runtime'].includes(row.kind), row.id);
  }
  for (const id of ['nonactor-implements','borrowed-event','unauthorized-grant',
    'observer-state-access','stale-publisher-incarnation','private-actor-zero-copy',
    'no-supervisor-interception']) {
    assert.equal(contract.cases.find(x => x.id === id)?.expect, 'reject', id);
  }
});
test('subscriber cutoff and per-publisher sequence never replay prior events', () => {
  const m = new ObservableActorReference();
  m.publish(1);
  const a = m.subscribe('a');
  assert.equal(m.read(a), undefined);
  m.publish(2); m.publish(3);
  assert.deepEqual([m.read(a)?.sequence, m.read(a)?.sequence], [2,3]);
  assert.equal(m.retained, 0);
});
test('reliable fanout rejects atomically when one subscriber is full', () => {
  const m = new ObservableActorReference({capacity: 1});
  const a = m.subscribe('a');
  m.publish(1);
  const b = m.subscribe('b');
  assert.throws(() => m.publish(2), /EventBackpressure/);
  assert.equal(m.sequence, 1); // rejected publish cannot increment sequence
  assert.equal(m.read(b), undefined);
  assert.equal(m.read(a)?.value, 1);
  assert.equal(m.retained, 0);
});
test('latest coalesces and returns every superseded reservation', () => {
  const m = new ObservableActorReference({policy: 'LATEST', capacity: 1});
  const a = m.subscribe('a');
  m.publish(1);
  const r = m.publish(2);
  assert.deepEqual([r.accepted,r.coalesced,r.dropped], [1,1,0]);
  assert.equal(m.retained, 1);
  assert.equal(m.read(a)?.value, 2);
  assert.equal(m.retained, 0);
});
test('lossy overflow drops new event without expanding quota', () => {
  const m = new ObservableActorReference({policy: 'LOSSY', capacity: 1});
  const a = m.subscribe('a');
  m.publish(1);
  assert.equal(m.publish(2).dropped, 1);
  assert.equal(m.retained, 1);
  assert.equal(m.read(a)?.value, 1);
});
test('publisher and observer close are idempotent; release exact-once', () => {
  const m = new ObservableActorReference();
  const a = m.subscribe('a'); const b = m.subscribe('b');
  m.publish({ok:true});
  assert.equal(m.retained, 2);
  assert.equal(m.cancel(a), true);
  assert.equal(m.cancel(a), false);
  assert.equal(m.retained, 1);
  assert.equal(m.close(), true);
  assert.equal(m.close(), false);
  assert.equal(m.retained, 0);
  assert.equal(b.active, false);
  assert.throws(() => m.publish(1), /closed/);
});
test('stale incarnations and forged leases fail closed', () => {
  const m = new ObservableActorReference({publisher: 'p#4'});
  assert.throws(() => m.subscribe('a',{expectedPublisher:'p#3'}),/stale/);
  const lease = m.subscribe('a');
  assert.throws(() => m.subscribe('a'),/duplicate/);
  assert.throws(() => m.read({observer:'a',active:true}),/closed lease/);
  assert.equal(m.cancel(lease), true);
});
test('reference schedules notification *metadata*, never guest callbacks inline', () => {
  const m = new ObservableActorReference({policy:'LATEST',capacity:1});
  const lease = m.subscribe('obs');
  m.publish(5);
  m.cancel(lease);
  assert.deepEqual(m.notifications.map(n=>n[0]),['subscribed','published','unsubscribed']);
});
