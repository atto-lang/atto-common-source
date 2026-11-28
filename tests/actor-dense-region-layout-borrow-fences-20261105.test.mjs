import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorArenaOracle,DenseRegionOracle,LAYOUTS} from '../scripts/actor-memory-layout-v1.mjs';

const make=()=>new DenseRegionOracle(new ActorArenaOracle('layout',1,4096),['x','y','z'],4,'aos',2);
test('layout migrations preserve entity values and swap-delete identities',()=>{
 const r=make(),a=r.insert([1,2,3]),b=r.insert([4,5,6]),c=r.insert([7,8,9]);
 for(const layout of LAYOUTS){
  r.changeLayout(layout);
  assert.deepEqual(r.read(a),[1,2,3]);
  assert.deepEqual(r.read(b),[4,5,6]);
  assert.deepEqual(r.read(c),[7,8,9]);
 }
 assert.equal(r.epoch,3);
 r.eraseSwap(b);
 assert.equal(r.length,2);
 assert.deepEqual(r.read(c),[7,8,9]);
 assert.throws(()=>r.read(b),/foreign or stale entity handle/);
 r.close();
});
test('read leases prevent mutation, migration and close until released',()=>{
 const r=make(),a=r.insert([3,2,1]),lease=r.borrowRead(),epoch=r.epoch;
 assert.throws(()=>r.write(a,[1,2,3]),/borrowed allocation/);
 assert.throws(()=>r.changeLayout('soa'),/borrowed allocation/);
 assert.throws(()=>r.close(),/borrowed allocation/);
 assert.equal(r.epoch,epoch);
 r.releaseRead(lease);
 assert.equal(r.changeLayout('soa'),epoch+1);
 r.close();
 assert.throws(()=>r.read(a),/region closed/);
});
test('component data getters cannot execute or partially insert a row',()=>{
 const r=make(),input=[1,2,3];let reads=0;
 Object.defineProperty(input,'0',{get(){reads++;return 1;},enumerable:true});
 assert.throws(()=>r.insert(input),/untrusted component descriptor/);
 assert.equal(reads,0);
 assert.equal(r.length,0);
 const a=r.insert(Object.freeze([1,2,3]));
 assert.deepEqual(r.read(a),[1,2,3]);
 r.close();
});