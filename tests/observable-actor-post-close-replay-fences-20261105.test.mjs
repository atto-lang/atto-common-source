// Host actor reference only. Tests lease identity, NOT compiled AttoLang guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('closing a publisher revokes all old subscriber handles and refunds pending deliveries', () => {
  const publisher = new ObservableActorReference({policy:'RELIABLE', capacity:3, publisher:'worker#7'});
  const a = publisher.subscribe('alice');
  const b = publisher.subscribe('bob');
  assert.deepEqual(publisher.publish('turn-one'), {accepted:2,dropped:0,coalesced:0,sequence:1});
  assert.deepEqual(publisher.publish('turn-two'), {accepted:2,dropped:0,coalesced:0,sequence:2});
  assert.equal(publisher.retained, 4);
  const fake = {...a};
  assert.equal(publisher.cancel(fake), false, 'a copied lease has no authority');
  assert.equal(publisher.retained, 4);
  assert.equal(publisher.read(a).value, 'turn-one');
  assert.equal(publisher.retained, 3);
  assert.equal(publisher.close(), true);
  assert.equal(publisher.retained, 0);
  assert.equal(publisher.close(), false);
  for (const lease of [a,b,fake]) {
    assert.equal(publisher.cancel(lease), false);
    assert.throws(() => publisher.read(lease), /closed lease/);
  }
  assert.throws(() => publisher.publish('late'), /publisher closed/);
  assert.throws(() => publisher.subscribe('alice'), /stale publisher/);
  assert.equal(publisher.sequence, 2, 'late admission cannot advance sequence');
});

test('a lease from a prior instance cannot revoke a new actor reusing the same label', () => {
  const previous = new ObservableActorReference({publisher:'same-label'});
  const old = previous.subscribe('observer');
  previous.publish(1);
  previous.close();
  const current = new ObservableActorReference({publisher:'same-label'});
  const fresh = current.subscribe('observer');
  assert.equal(current.cancel(old), false);
  assert.deepEqual(current.publish('new'), {accepted:1,dropped:0,coalesced:0,sequence:1});
  assert.equal(current.read(fresh).value, 'new');
  assert.equal(current.retained, 0);
  assert.equal(previous.retained, 0);
});

test('a rejected reliable fanout leaves all subscriber reservations unchanged', () => {
  const actor = new ObservableActorReference({policy:'RELIABLE',capacity:1});
  const a=actor.subscribe('a'), b=actor.subscribe('b');
  actor.publish('first');
  const snapshot=[actor.sequence,actor.retained,a.pending[0],b.pending[0]];
  assert.throws(() => actor.publish('second'), /EventBackpressure/);
  assert.deepEqual([actor.sequence,actor.retained,a.pending[0],b.pending[0]],snapshot);
  assert.equal(Object.isFrozen(a.pending[0]),true);
  actor.close();
  assert.equal(actor.retained,0);
});
