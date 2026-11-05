import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('reliable backpressure, observer cancellation and reads release each reservation once', () => {
  const m = new ObservableActorReference({capacity: 2});
  const a = m.subscribe('a'), b = m.subscribe('b');
  m.publish('one'); m.publish('two');
  assert.equal(m.retained, 4);
  assert.equal(m.read(a).sequence, 1);
  assert.equal(m.retained, 3);
  assert.throws(() => m.publish('blocked'), /EventBackpressure/);
  assert.equal(m.sequence, 2);
  assert.equal(m.cancel(b), true);
  assert.equal(m.cancel(b), false);
  assert.equal(m.retained, 1);
  m.publish('three');
  assert.deepEqual([m.read(a).sequence, m.read(a).sequence], [2,3]);
  assert.equal(m.retained, 0);
  assert.equal(m.close(), true);
  assert.equal(m.close(), false);
});

test('latest coalescing across two readers cannot leak old delivery slots', () => {
  const m = new ObservableActorReference({policy: 'LATEST', capacity: 1});
  const a = m.subscribe('a'), b = m.subscribe('b');
  m.publish('old');
  const next = m.publish('new');
  assert.deepEqual([next.accepted, next.coalesced, next.dropped], [2,2,0]);
  assert.equal(m.retained, 2);
  assert.equal(m.read(a).value, 'new');
  assert.equal(m.retained, 1);
  assert.equal(m.read(b).value, 'new');
  assert.equal(m.retained, 0);
});

test('lossy fanout still admits new subscribers while full old subscribers drop', () => {
  const m = new ObservableActorReference({policy: 'LOSSY',capcity: 1});
  const old = m.subscribe('old');
  m.publish(1);
  const fresh = m.subscribe('fresh');
  const outcome = m.publish(2);
  assert.deepEqual([outcome.accepted,outcome.dropped,outcome.sequence],[1,1,2]);
  assert.equal(m.retained, 2);
  assert.equal(m.read(old).value, 1);
  assert.equal(m.read(fresh).value, 2);
  assert.equal(m.retained, 0);
});

test('empty fanout creates no reservation or synchronous guest callback', () => {
  const m = new ObservableActorReference();
  const result = m.publish({data: 1});
  assert.deepEqual([result.accepted,result.sequence,m.retained],[0,1,0]);
  assert.deepEqual(m.notifications,[['published',1]]);
});
