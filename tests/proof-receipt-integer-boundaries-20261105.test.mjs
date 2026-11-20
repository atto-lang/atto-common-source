import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateBundle} from '../scripts/verify-proof-receipt-v1.mjs';

const sha='a'.repeat(40),digest='b'.repeat(64);
const job=()=>({
 repository:'ores-truffle-oreslang/oreslang-common-source',
 headSha:sha,checkedOutSha:sha,runId:1,runAttempt:1,runnerId:1,jobId:1,
 conclusion:'success',steps:[
  {id:'checkout-identity',conclusion:'success'},
  {id:'solver-proofs',conclusion:'success'}
 ]
});
function fixture(){
 const ir={schemaVersion:1,kind:'ores-proof-ir',contractId:'core-proof-v1',function:'checked_i64',
  semantics:{integer:'signed-i64',ownership:'pure',effects:[]},
  source:{repository:'ores-truffle-oreslang/oreslang-common-source',commit:sha,blob:sha,
   path:'fixtures/checked.atto',mode:'checked-ast',typedDigest:digest},
  assumptions:['bounded signed integers'],obligations:[
   {id:'proof-ok',kind:'proof',logic:'QF_BV',expected:'unsat',querySha256:digest},
   {id:'negative-ok',kind:'negative-control',logic:'QF_BV',expected:'sat',querySha256:digest}
  ]};
 const bytes=Buffer.from(JSON.stringify(ir));
 const receipt={schemaVersion:1,kind:'ores-proof-receipt',
  proofIrSha256:createHash('sha256').update(bytes).digest('hex'),
  solver:{name:'z3',version:'1.0',binarySha256:digest},
  results:ir.obligations.map(o=>({id:o.id,verdict:o.expected,transcriptSha256:digest})),
  job:job(),guest:null};
 return {bytes,receipt};
}
test('job identifiers accept the last safe integer and reject overflow, zero and fractional numbers',()=>{
 const {bytes,receipt}=fixture();
 assert.equal(validateBundle(bytes,receipt).classification,'MODEL_RECORD_CONSISTENT_UNATTESTED');
 for(const field of ['runId','runAttempt','runnerId','jobId']){
  receipt.job[field]=Number.MAX_SAFE_INTEGER;
  assert.equal(validateBundle(bytes,receipt).classification,'MODEL_RECORD_CONSISTENT_UNATTESTED');
  for(const invalid of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN]){
   receipt.job[field]=invalid;
   assert.throws(()=>validateBundle(bytes,receipt),/must be positive/);
  }
  receipt.job[field]=1;
 }
});
test('executed-step limit admits 64 distinct successful steps and denies the 65th or duplicate',()=>{
 const {bytes,receipt}=fixture();
 receipt.job.steps.push(...Array.from({length:62},(_,i)=>({id:'extra-step-'+i,conclusion:'success'})));
 assert.equal(receipt.job.steps.length,64);
 assert.equal(validateBundle(bytes,receipt).classification,'MODEL_RECORD_CONSISTENT_UNATTESTED');
 receipt.job.steps.push({id:'extra-step-62',conclusion:'success'});
 assert.throws(()=>validateBundle(bytes,receipt),/unexecuted job/);
 receipt.job.steps.pop();
 receipt.job.steps[63].id='checkout-identity';
 assert.throws(()=>validateBundle(bytes,receipt),/duplicate step/);
});