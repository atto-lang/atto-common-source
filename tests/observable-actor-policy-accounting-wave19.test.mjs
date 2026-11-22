// Observable host reference only; does not execute compiled AttoLang actors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('LATEST coalesces each prior subscriber reservation exactly once',()=>{
 const pub=new ObservableActorReference({policy:'LATEST',capacity:1,publisher:'latest'});
 const first=pub.subscribe('alice'),second=pub.subscribe('bob');
 assert.deepEqual(pub.publish('one'),{accepted:2,dropped:0,coalesced:0,sequence:1});
 assert.equal(pub.retained,2);
 assert.deepEqual(pub.publish('two'),{accepted:2,dropped:0,coalesced:2,sequence:2});
 assert.equal(pub.retained,2);
 assert.equal(pub.read(first).value,'two');
 assert.equal(pub.retained,1);
 assert.equal(pub.cancel(second),true);
 assert.equal(pub.retained,0);
 assert.equal(pub.close(),true);
 assert.equal(pub.close(),false);
 assert.throws(()=>pub.publish('late'),/closed/);
});

test('LOSSY denies only full subscribers without consuming their held events',()=>{
 const pub=new ObservableActorReference({policy:'LOSSY',capacity:2,publisher:'lossy'});
 const a=pub.subscribe('a'),b=pub.subscribe('b');
 pub.publish(1);pub.publish(2);
 assert.equal(pub.retained,4);
 assert.equal(pub.read(a).value,1);
 const event=pub.publish(3);
 assert.deepEqual(event,{accepted:1,dropped:1,coalesced:0,sequence:3});
 assert.deepEqual(a.pending.map(x=>x.value),[2,3]);
 assert.deepEqual(b.pending.map(x=>x.value),[1,2]);
 assert.equal(pub.retained,4);
 pub.cancel(a);pub.cancel(b);
 assert.equal(pub.retained,0);
});

test('RELIABLE refuses fanout atomically and does not advance sequence',()=>{
 const pub=new ObservableActorReference({policy:'RELIABLE',capacity:1,publisher:'reliable'});
 const a=pub.subscribe('a'),b=pub.subscribe('b');
 pub.publish('a');
 const before=[pub.retained,pub.sequence,a.pending[0],b.pending[0]];
 assert.throws(()=>pub.publish('b'),/EventBackpressure/);
 assert.deepEqual([pub.retained,pub.sequence,a.pending[0],b.pending[0]],before);
 assert.equal(pub.read(a).value,'a');
 assert.throws(()=>pub.publish('b'),/EventBackpressure/);
 assert.equal(pub.read(b).value,'a');
 assert.deepEqual(pub.publish('c'),{accepted:2,dropped:0,coalesced:0,sequence:2});
 pub.close();
 assert.equal(pub.retained,0);
});

test('subscriber identities never permit copied leases to drain an active observer',()=>{
 const pub=new ObservableActorReference({policy:'LOSSY',capacity:2});
 const real=pub.subscribe('consumer');
 const copy={...real,pending:real.pending};
 pub.publish('first');
 assert.equal(pub.cancel(copy),false);
 assert.throws(()=>pub.read(copy),/closed lease/);
 assert.equal(pub.read(real).value,'first');
 assert.equal(pub.cancel(real),true);
 assert.equal(pub.retained,0);
});
