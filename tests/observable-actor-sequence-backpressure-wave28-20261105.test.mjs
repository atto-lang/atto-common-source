// Host-only reference accounting tests, not AttoLang actor execution or guest pub/sub.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('RELIABLE backpressure rejects all participants atomically without advancing sequence',()=>{
 const lane=new ObservableActorReference({policy:'RELIABLE',capacity:1});
 const a=lane.subscribe('a'), b=lane.subscribe('b');
 assert.deepEqual(lane.publish('first'),{accepted:2,dropped:0,coalesced:0,sequence:1});
 assert.equal(lane.retained,2);
 assert.throws(()=>lane.publish('denied'),/EventBackpressure/);
 assert.equal(lane.sequence,1);
 assert.equal(lane.retained,2);
 assert.equal(lane.read(a).sequence,1);
 assert.throws(()=>lane.publish('still denied'),/EventBackpressure/);
 assert.equal(lane.retained,1);
 assert.equal(lane.read(b).sequence,1);
 assert.equal(lane.publish('second').sequence,2);
 assert.equal(lane.retained,2);
});

test('LOSSY drop decisions do not reorder delivered values on each publisher edge',()=>{
 const lane=new ObservableActorReference({policy:'LOSSY',capacity:1});
 const a=lane.subscribe('a'), b=lane.subscribe('b');
 lane.publish('first');
 assert.equal(lane.read(a).value,'first');
 assert.deepEqual(lane.publish('second'),{accepted:1,dropped:1,coalesced:0,sequence:2});
 assert.equal(lane.retained,2);
 assert.equal(lane.read(b).value,'first');
 assert.equal(lane.read(a).value,'second');
 assert.equal(lane.retained,0);
});

test('LATEST coalescing preserves only newest reservation and monotonic sequence',()=>{
 const lane=new ObservableActorReference({policy:'LATEST',capacity:1});
 const lease=lane.subscribe('a');
 lane.publish('old');
 assert.deepEqual(lane.publish('new'),{accepted:1,dropped:0,coalesced:1,sequence:2});
 assert.equal(lane.retained,1);
 assert.deepEqual([lane.read(lease).sequence,lane.read(lease)],[2,undefined]);
 assert.equal(lane.retained,0);
});

test('cancellation revokes identity and drains retained reservations before rejoin',()=>{
 const lane=new ObservableActorReference({policy:'RELIABLE',capacity:2});
 const old=lane.subscribe('a');
 lane.publish('x');
 assert.equal(lane.cancel({...old}),false);
 assert.equal(lane.retained,1);
 assert.equal(lane.cancel(old),true);
 assert.equal(lane.cancel(old),false);
 assert.equal(lane.retained,0);
 assert.throws(()=>lane.read(old),/closed lease/);
 const renewed=lane.subscribe('a');
 lane.publish('y');
 assert.equal(lane.read(renewed).value,'y');
 assert.equal(lane.close(),true);
 assert.equal(lane.close(),false);
 assert.throws(()=>lane.publish('z'),/publisher closed/);
});
