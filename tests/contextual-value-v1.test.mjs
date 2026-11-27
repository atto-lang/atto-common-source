import test from 'node:test';
import assert from 'node:assert/strict';
import {checkContextValue} from '../tools/contextual-value-v1.mjs';
const scalar=(name='factor')=>({name,type:'int',ownership:'copy',actor:null,regionPath:null,generation:null});
const allocator=(ownership='borrow')=>({name:'allocator',type:'allocator',ownership,actor:'actor_1',regionPath:['root','arena'],generation:1});
const value=(slots,operation='bind',actor='actor_1',regionPath=['root','arena'])=>({owner:'pkg.Foo',schema:'pkg.Foo.context.v1',slots,evaluationOrder:slots.map((_,i)=>i),destination:{actor,regionPath,operation}});
const check=v=>checkContextValue(JSON.stringify(v));
test('ordered scalar schema is copyable and results are immutable',()=>{
 const v=value([scalar(),scalar('offset')],'copy');v.evaluationOrder=[1,0];
 const r=check(v);assert.deepEqual(r.evaluationOrder,[1,0]);assert.equal(r.copyable,true);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.evaluationOrder));
});
test('allocator capability descriptors require actor and region compatibility',()=>{
 assert.equal(check(value([allocator()])).copyable,false);
 assert.equal(check(value([allocator('move')],'move')).copyable,false);
 assert.equal(check(value([allocator()],'borrow','actor_1',['root','arena','child'])).slotCount,1);
});
test('deny duplication, cross actor, escaping borrow, malformed generation and schema',()=>{
 const bad=[value([allocator()],'copy'),value([allocator('move')],'copy'),
 value([allocator()],'move'),value([allocator('move')],'move','actor_2'),
 value([allocator()],'bind','actor_1',['root']),value([allocator('copy')]),
 value([allocator()],'bind','actor_1',['root','sibling']),
 value([allocator()],'bind','actor_1',['root','arena','arena']),
 value([{...allocator(),generation:0}]),value([{...allocator(),generation:-1}]),
 value([scalar(),scalar()]),value([{...scalar(),actor:'actor_1'}]),value([]),
 value([{...scalar(),ownership:'move'}]),value(Array.from({length:33},(_,i)=>scalar('s'+i)))];
 for(const v of bad)assert.throws(()=>check(v),/E_CONTEXT_CONTRACT/);
});
test('deny invalid order and unknown authority fields',()=>{
 for(const order of [[0,0],[0,2],[0],['0',1]]){
  const v=value([scalar(),scalar('offset')]);v.evaluationOrder=order;
  assert.throws(()=>check(v),/E_CONTEXT_CONTRACT/);
 }
 const v=value([allocator()]);v.slots[0].actualHandle=42;
 assert.throws(()=>check(v),/E_CONTEXT_CONTRACT/);
 assert.throws(()=>checkContextValue('['),/E_CONTEXT_CONTRACT/);
});
