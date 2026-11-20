// Host-only observable actor reference model. Not compiled AttoLang guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservableActorReference } from '../models/observable-actor-reference-v1.mjs';

test('RELIABLE capacity reopens only after all blocked subscribers make room', () => {
  const pub = new ObservableActorReference({policy:'RELIABLE', capacity:1});
  const slow = pub.subscribe('slow');
  const fast = pub.subscribe('fast');
  assert.deepEqual(pub.publish('a'), {accepted:2,dropped:0,coalesced:0,sequence:1});
  assert.equal(pub.read(fast).value, 'a');
  assert.throws(() => pub.publish('b'), /EventBackpressure/);
  assert.equal(pub.sequence, 1);
  assert.equal(pub.cancel(slow), true);
  assert.deepEqual(pub.publish('b'), {accepted:1,dropped:0,coalesced:0,sequence:2});
  assert.equal(pub.read(fast).value, 'b');
  assert.equal(pub.retained, 0);
  pub.close();
});

test('LATEST replacement is per-lease and subscriber turnover does not leak retained count', () => {
  const pub = new ObservableActorReference({policy:'LATEST', capacity:1});
  const stable = pub.subscribe('stable');
  for (let i=1;i<=24;i++) {
    const temporary = pub.subscribe('temp-'+i);
    assert.equal(pub.publish(i).accepted,2);
    assert.equal(pub.cancel(temporary),true);
    assert.equal(pub.retained,1);
  }
  assert.equal(pub.sequence,24);
  assert.equal(pub.read(stable).value,24);
  assert.equal(pub.retained,0);
  assert.equal(pub.cancel(stable),true);
  assert.equal(pub.close(),true);
  assert.equal(pub.retained,0);
});

test('LOSSY all-dropped publication advances sequence without granting new capacity', () => {
  const pub = new ObservableActorReference({policy:'LOSSY',capacity:1});
  const a=pub.subscribe('a'), b=pub.subscribe('b');
  pub.publish('initial');
  assert.deepEqual(pub.publish('dropped'), {accepted:0,dropped:2,coalesced:0,sequence:2});
  assert.equal(pub.retained,2);
  assert.equal(pub.read(a).value,'initial');
  assert.equal(pub.read(b).value,'initial');
  assert.equal(pub.retained,0);
  assert.deepEqual(pub.publish('accepted'), {accepted:2,dropped:0,coalesced:0,sequence:3});
  assert.equal(pub.close(),true);
  assert.equal(pub.retained,0);
});

test('publishing is metadata-only; no guest callback occurs inline', () => {
  const pub = new ObservableActorReference();
  const lease=pub.subscribe('reader');
  pub.publish(Object.freeze({value:7}));
  assert.deepEqual(pub.notifications, [['subscribed','reader'],['published',1]]);
  assert.equal(pub.read(lease).value.value,7);
  assert.equal(pub.cancel(lease),true);
  assert.deepEqual(pub.notifications.at(-1), ['unsubscribed','reader']);
});
