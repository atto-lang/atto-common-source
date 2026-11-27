import test from 'node:test';
import assert from 'node:assert/strict';
import {checkContextValue,planContextInvocation} from '../tools/contextual-value-v1.mjs';
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

const op=(id,type='int')=>({id,type});
const invocation=()=>{
 const binding=value([scalar(),{...scalar('enabled'),type:'bool'}]);
 binding.evaluationOrder=[1,0];
 return {schema:{owner:binding.owner,id:binding.schema,context:[{name:'factor',type:'int'},{name:'enabled',type:'bool'}],
 ordinary:[{name:'value',type:'int'}],result:'int'},binding,mode:'direct',
 contextOperands:[op('enabled_expr','bool'),op('factor_expr')],ordinaryOperands:[op('value_expr')],storedSlots:[]};
};
const plan=p=>planContextInvocation(JSON.stringify(p));
test('direct invocation preserves lexical evaluation order and maps already-evaluated operands',()=>{
 const r=plan(invocation());
 assert.deepEqual(r.evaluation.map(x=>[x.phase,x.slot,x.operand]),[
 ['context',1,'enabled_expr'],['context',0,'factor_expr'],['ordinary',0,'value_expr']]);
 assert.deepEqual(r.parameterOperands,['factor_expr','enabled_expr','value_expr']);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.evaluation)&&r.evaluation.every(Object.isFrozen)&&Object.isFrozen(r.parameterOperands));
});
test('stored invocation uses existing typed slots and evaluates only ordinary actuals',()=>{
 const p=invocation();p.mode='stored';p.contextOperands=[];p.storedSlots=[op('saved_factor'),op('saved_enabled','bool')];
 const r=plan(p);assert.deepEqual(r.evaluation.map(x=>x.operand),['value_expr']);
 assert.deepEqual(r.parameterOperands,['saved_factor','saved_enabled','value_expr']);
});
test('reject schema mismatch, duplicate operand occurrence, recapture and wrong types',()=>{
 for(const mutate of [
 p=>p.schema.owner='pkg.Other',
 p=>p.schema.id='pkg.Other.v1',
 p=>p.schema.context[0].name='unknown',
 p=>p.schema.context[0].type='bool',
 p=>p.schema.ordinary[0].name='factor',
 p=>p.contextOperands.reverse(),
 p=>p.ordinaryOperands[0].id='factor_expr',
 p=>p.contextOperands.pop(),
 p=>p.binding.evaluationOrder=[0,0],
 p=>p.mode='stored',
 p=>p.storedSlots=[op('forged')],
 p=>p.binding.destination.operation='copy'
 ]){
  const p=invocation();mutate(p);assert.throws(()=>plan(p),/E_CONTEXT_CONTRACT/);
 }
});
test('reject duplicate JSON keys including escaped spellings and deep input',()=>{
 const text=JSON.stringify(invocation());
 assert.throws(()=>planContextInvocation(text.replace('"mode":"direct"','"mode":"stored","mode":"direct"')),/duplicate JSON key/);
 assert.throws(()=>checkContextValue(JSON.stringify(value([scalar()])).replace('"owner":','"own\\u0065r":"forged","owner":')),/duplicate JSON key/);
 assert.throws(()=>checkContextValue('['.repeat(65)+'0'+']'.repeat(65)),/nesting budget/);
});
