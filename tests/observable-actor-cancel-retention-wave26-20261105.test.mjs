// Host actor-policy reference model; not executed AttoLang actors or transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('LATEST coalescing and subscriber cancellation refund reservations exactly',()=>{
  const pub=new ObservableActorReference({policy:'LATEST',capacity:1});
  const a=pub.subscribe('a'),b=pub.subscribe('b');
  assert.deepEqual(pub.publish('old'),{accepted:2,dropped:0,coalesced:0,sequence:1});
  assert.equal(pub.retained,2);
  assert.deepEqual(pub.publish('new'),{accepted:2,dropped:0,coalesced:2,sequence:2});
  assert.equal(pub.retained,2);
  assert.equal(pub.cancel(a),true);
  assert.equal(pub.retained,1);
  assert.equal(pub.read(b).value,'new');
  assert.equal(pub.retained,0);
  assert.equal(pub.close(),true);
  assert.equal(pub.close(),false);
  assert.equal(pub.retained,0);
});

test('LOSSY retains full subscriber event but still delivers to drained subscriber',()=>{
  const pub=new ObservableActorReference({policy:'LOSSY',capacity:1});
  const a=pub.subscribe('a'),b=pub.subscribe('b');
  pub.publish(10);
  assert.equal(pub.read(a).value,10);
  assert.deepEqual(pub.publish(20),{accepted:1,dropped:1,coalesced:0,sequence:2});
  assert.equal(pub.retained,2);
  assert.equal(pub.read(b).value,10);
  assert.equal(pub.read(a).value,20);
  assert.equal(pub.retained,0);
  pub.close();
});

test('RELIABLE failed fanout never advances sequence or emits duplicate event',()=>{
  const pub=new ObservableActorReference({policy:'RELIABLE',capacity:1});
  const a=pub.subscribe('a'),b=pub.subscribe('b');
  pub.publish('first');
  const notices=structuredClone(pub.notifications);
  assert.equal(pub.read(a).value,'first');
  assert.throws(()=>pub.publish('second'),/EventBackpressure/);
  assert.equal(pub.sequence,1);
  assert.deepEqual(pub.notifications,notices);
  assert.equal(pub.read(b).value,'first');
  assert.equal(pub.publish('second').sequence,2);
  assert.equal(pub.retained,2);
  pub.close();
  assert.equal(pub.retained,0);
});

test('copied lease never drains or cancels authentic observer',()=>{
  const pub=new ObservableActorReference();
  const owned=pub.subscribe('owner');
  pub.publish('value');
  const fake={...owned,pending:owned.pending};
  assert.equal(pub.cancel(fake),false);
  assert.throws(()=>pub.read(fake),/closed lease/);
  assert.equal(pub.read(owned).value,'value');
  assert.equal(pub.cancel(owned),true);
  assert.equal(pub.retained,0);
});
