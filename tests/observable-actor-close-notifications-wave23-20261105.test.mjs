// Host reference-model assertions only; never a compiled AttoLang actor claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('subscriber lifecycle emits deterministic deferred metadata without duplicated close notices', () => {
  const pub = new ObservableActorReference({policy: 'RELIABLE', capacity: 2, publisher: 'pinned'});
  const a = pub.subscribe('alpha');
  const b = pub.subscribe('beta');
  pub.publish('hello');
  assert.deepEqual(pub.notifications, [
    ['subscribed', 'alpha'], ['subscribed', 'beta'], ['published', 1]
  ]);
  assert.equal(pub.read(a).value, 'hello');
  assert.equal(pub.cancel(a), true);
  assert.equal(pub.close(), true);
  const snapshot = structuredClone(pub.notifications);
  assert.deepEqual(snapshot, [
    ['subscribed', 'alpha'], ['subscribed', 'beta'], ['published', 1],
    ['unsubscribed', 'alpha'], ['unsubscribed', 'beta']
  ]);
  assert.equal(pub.close(), false);
  assert.deepEqual(pub.notifications, snapshot);
  assert.equal(pub.retained, 0);
  assert.equal(b.active, false);
});

test('invalid publisher identity and duplicate lease cannot enqueue notifications', () => {
  const pub = new ObservableActorReference({publisher: 'current'});
  assert.throws(() => pub.subscribe('x', {expectedPublisher: 'old'}), /stale publisher/);
  assert.deepEqual(pub.notifications, []);
  const lease = pub.subscribe('x');
  assert.throws(() => pub.subscribe('x'), /duplicate lease/);
  assert.deepEqual(pub.notifications, [['subscribed', 'x']]);
  assert.equal(pub.cancel({...lease, pending: lease.pending}), false);
  assert.deepEqual(pub.notifications, [['subscribed', 'x']]);
  assert.equal(pub.cancel(lease), true);
});

test('failed backpressure never emits a phantom publish or advances sequence', () => {
  const pub = new ObservableActorReference({policy: 'RELIABLE', capacity: 1});
  const lease = pub.subscribe('only');
  pub.publish(1);
  const before = structuredClone(pub.notifications);
  assert.throws(() => pub.publish(2), /EventBackpressure/);
  assert.equal(pub.sequence, 1);
  assert.deepEqual(pub.notifications, before);
  assert.equal(pub.read(lease).value, 1);
  assert.equal(pub.publish(3).sequence, 2);
});

test('closed publisher rejects subscriptions and publication without new notices', () => {
  const pub = new ObservableActorReference();
  assert.equal(pub.close(), true);
  assert.throws(() => pub.subscribe('late'), /stale publisher/);
  assert.throws(() => pub.publish(42), /publisher closed/);
  assert.deepEqual(pub.notifications, []);
});
