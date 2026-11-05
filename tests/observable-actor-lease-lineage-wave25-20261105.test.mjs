// Host reference model only, not a compiled actor or transport implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference as Pub} from '../models/observable-actor-reference-v1.mjs';

test('reliable fanout backpressure is atomic across independently drained subscribers',()=>{
 const p=new Pub({policy:'RELIABLE',capacity:1});
 const a=p.subscribe('alpha'),b=p.subscribe('beta');
 assert.deepEqual(p.publish(1),{accepted:2,dropped:0,coalesced:0,sequence:1});
 assert.equal(p.retained,2);
 assert.equal(p.read(a).value,1);
 assert.throws(()=>p.publish(2),/EventBackpressure/);
 assert.equal(p.sequence,1);assert.equal(p.retained,1);
 assert.equal(p.read(b).value,1);
 assert.equal(p.publish(3).accepted,2);
 assert.equal(p.retained,2);
});

test('latest replacement releases all old per-subscriber reservations',()=>{
 const p=new Pub({policy:'LATEST',capacity:1,publisher:'origin'});
 const a=p.subscribe('a'),b=p.subscribe('b');
 for(let i=1;i<=128;i++){
  const r=p.publish(i);
  assert.equal(r.accepted,2);
  assert.equal(r.coalesced,i===1?0:2);
  assert.equal(p.retained,2);
 }
 assert.equal(p.read(a).value,128);assert.equal(p.read(b).value,128);
 assert.equal(p.retained,0);
 assert.equal(p.sequence,128);
});

test('lossy drops belong only to saturated subscribers, not to other deliveries',()=>{
 const p=new Pub({policy:'LOSSY',capacity:1});
 const a=p.subscribe('a'),b=p.subscribe('b');
 p.publish('first');
 assert.equal(p.read(a).value,'first');
 const second=p.publish('second');
 assert.deepEqual(second,{accepted:1,dropped:1,coalesced:0,sequence:2});
 assert.equal(p.read(a).value,'second');
 assert.equal(p.read(b).value,'first');
 assert.equal(p.retained,0);
});

test('copied leases cannot consume or revoke owned subscriptions, including after close',()=>{
 const p=new Pub({publisher:'trusted'});
 const a=p.subscribe('alpha');
 p.publish('one');
 const spoof={observer:a.observer,pending:a.pending,active:true};
 assert.throws(()=>p.read(spoof),/closed lease/);
 assert.equal(p.cancel(spoof),false);
 assert.equal(p.retained,1);
 assert.equal(p.close(),true);assert.equal(p.close(),false);
 assert.equal(p.retained,0);
 assert.equal(p.cancel(a),false);
 assert.throws(()=>p.read(a),/closed lease/);
 assert.throws(()=>p.subscribe('late'),/stale publisher/);
});
