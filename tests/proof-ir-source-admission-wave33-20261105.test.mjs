// Proof IR record-shape checks only. Neither a solver nor guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIr} from '../scripts/verify-proof-receipt-v1.mjs';

const fixture=()=>({
 schemaVersion:1,kind:'ores-proof-ir',contractId:'actor-ownership',
 function:'check_credit',semantics:{integer:'signed-i64',ownership:'pure',effects:[]},
 source:{repository:'ores-truffle-oreslang/oreslang-common-source',
 commit:'a'.repeat(40),blob:'b'.repeat(40),path:'contracts/credit.atto',
 mode:'reviewed-blob',typedDigest:null},
 assumptions:['bounded source state'],
 obligations:[
  {id:'proof-one',kind:'proof',logic:'QF_BV',expected:'unsat',querySha256:'c'.repeat(64)},
  {id:'mutation-one',kind:'negative-control',logic:'QF_BV',expected:'sat',querySha256:'d'.repeat(64)}
 ]
});
test('a well-formed proof and mandatory mutation admit shape but do not attest a solver',()=>{
 assert.deepEqual(validateIr(fixture()),{proved:1,mutated:1});
 const typed=fixture();typed.source.mode='typed-hir';typed.source.typedDigest='e'.repeat(64);
 assert.deepEqual(validateIr(typed),{proved:1,mutated:1});
});
test('unsafe or ambiguous source paths cannot assert source provenance',()=>{
 for(const path of ['/x.atto','../x.atto','a/../x.atto','a//x.atto','a/./x.atto','']){
  const x=fixture();x.source.path=path;
  assert.throws(()=>validateIr(x),/unsafe source path/);
 }
 const x=fixture();x.source.repository='foreign/source';assert.throws(()=>validateIr(x),/source repo scope/);
});
test('typed representation cannot be forged by reviewed raw blob mode',()=>{
 const x=fixture();x.source.typedDigest='e'.repeat(64);
 assert.throws(()=>validateIr(x),/reviewed blob cannot claim typed derivation/);
 x.source.mode='typed-mir';x.source.typedDigest=null;
 assert.throws(()=>validateIr(x),/typed representation/);
});
test('duplicated, missing or incorrect proof controls reject an incomplete record',()=>{
 const x=fixture();x.obligations[1].id=x.obligations[0].id;
 assert.throws(()=>validateIr(x),/duplicate\/unsupported obligation/);
 const y=fixture();y.obligations[1].expected='unsat';
 assert.throws(()=>validateIr(y),/mutation expected SAT/);
 const z=fixture();z.obligations[0].kind='negative-control';z.obligations[0].expected='sat';
 assert.throws(()=>validateIr(z),/proof and mutation controls required/);
});
test('effects, assumption duplication and noncanonical function identity are rejected',()=>{
 const x=fixture();x.semantics.effects=['IO'];
 assert.throws(()=>validateIr(x),/unmodeled effects/);
 const y=fixture();y.assumptions.push(y.assumptions[0]);
 assert.throws(()=>validateIr(y),/duplicate assumption/);
 const z=fixture();z.function='unsafe-Function';
 assert.throws(()=>validateIr(z),/bad function/);
});
