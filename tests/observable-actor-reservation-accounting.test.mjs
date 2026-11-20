// Host reference model only, not actual AttoLang actor execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('reliable fanout refusal is atomic across fast and slow subscribers', () => {
  const model = new ObservableActorReference({policy:'RELIABLE', capacity:2});
  const slow = model.subscribe('slow');
  const fast = model.subscribe('fast');
  model.publish('one'); model.publish('two');
  assert.equal(model.retained, 4);
  assert.equal(model.read(fast).sequence, 1);
  assert.equal(model.retained, 3);
  assert.throws(() => model.publish('denied'), /EventBackpressure/);
  assert.equal(model.sequence, 2);
  assert.equal(model.retained, 3);
  assert.deepEqual(fast.pending.map(event => event.sequence), [2]);
  assert.equal(model.cancel(slow), true);
  assert.equal(model.retained, 1);
  assert.deepEqual(model.publish('three'), {accepted:1,dropped:0,coalesced:0,sequence:3});
  assert.deepEqual([model.read(fast).value, model.read(fast).value], ['two','three']);
  assert.equal(model.retained, 0);
});

test('LATEST replaces exact reservations per subscriber, then close refunds all', () => {
  const model = new ObservableActorReference({policy:'LATEST',capacity:1});
  const a = model.subscribe('a'), b = model.subscribe('b');
  model.publish(1);
  assert.deepEqual(model.publish(2), {accepted:2,dropped:0,coalesced:2,sequence:2});
  assert.equal(model.retained, 2);
  assert.equal(model.read(a).value, 2);
  assert.equal(model.retained, 1);
  assert.equal(model.close(), true);
  assert.equal(model.retained, 0);
  assert.equal(b.active, false);
  assert.equal(model.close(), false);
});

test('LOSSY drops only saturated subscriber while preserving other reservations', () => {
  const model = new ObservableActorReference({policy:'LOSSY',capacity:1});
  const slow = model.subscribe('slow'), fast = model.subscribe('fast');
  model.publish('first');
  assert.equal(model.read(fast).value, 'first');
  assert.deepEqual(model.publish('second'), {accepted:1,dropped:1,coalesced:0,sequence:2});
  assert.equal(model.retained, 2);
  model.cancel(slow);
  assert.equal(model.retained, 1);
  assert.equal(model.read(fast).value, 'second');
  assert.equal(model.retained, 0);
});
