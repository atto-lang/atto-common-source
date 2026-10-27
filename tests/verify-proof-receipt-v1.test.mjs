import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validateIr,validateBundle} from '../scripts/verify-proof-receipt-v1.mjs';
const sha='a'.repeat(40), hash='b'.repeat(64);
const job=(steps=['checkout-identity','solver-proofs'])=>({
 repository:'ores-truffle-oreslang/oreslang-source.java',headSha:sha,checkedOutSha:sha,
 runId:11,runAttempt:1,runnerId:22,jobId:33,conclusion:'success',
 steps:steps.map(id=>({id,conclusion:'success'}))
});
const ir=()=>({schemaVersion:1,kind:'ores-proof-ir',contractId:'ores-core-math-signed-i64-v1',
 function:'min_int',semantics:{integer:'signed-i64',ownership:'pure',effects:[]},
 source:{repository:'ores-truffle-oreslang/oreslang-source.java',commit:sha,blob:sha,
  path:'stdlib/core.ores',mode:'checked-ast',typedDigest:hash},
 assumptions:['signed i64 comparison is total'],
 obligations:[
  {id:'min-law',kind:'proof',logic:'QF_BV',expected:'unsat',querySha256:hash},
  {id:'broken-min',kind:'negative-control',logic:'QF_BV',expected:'sat',querySha256:hash}
 ]});
function bundle(i=ir()){
 const bytes=Buffer.from(JSON.stringify(i));
 return {bytes,receipt:{schemaVersion:1,kind:'ores-proof-receipt',
  proofIrSha256:createHash('sha256').update(bytes).digest('hex'),
  solver:{name:'z3',version:'5.1.0',binarySha256:hash},
  results:i.obligations.map(o=>({id:o.id,verdict:o.expected,transcriptSha256:hash})),
  job:job(),guest:null}};
}
const guest=()=>({backend:'java-graal',binarySha256:hash,fixtureSha256:hash,
 observationsSha256:hash,cases:24,job:job(['checkout-identity','guest-build','guest-execution'])});
test('model evidence is explicitly non-certifying',()=>{
 const b=bundle();assert.equal(validateBundle(b.bytes,b.receipt).classification,'MODEL_RECORD_CONSISTENT_UNATTESTED');
});
test('guest evidence is separate, not a backend certification',()=>{
 const b=bundle();b.receipt.guest=guest();
 assert.equal(validateBundle(b.bytes,b.receipt).classification,'MODEL_AND_GUEST_RECORDS_CONSISTENT_UNATTESTED');
});
test('reviewed-blob is permitted but cannot pretend it is a typed proof',()=>{
 const x=ir();x.source.mode='reviewed-blob';x.source.typedDigest=null;
 const b=bundle(x);assert.equal(validateBundle(b.bytes,b.receipt).sourceMode,'reviewed-blob');
});
test('IR rejects unsafe inputs, effects, lost mutants and implicit widening',()=>{
 const muts=[
  x=>x.semantics.effects.push('throws'),x=>x.semantics.integer='float64',
  x=>x.semantics.ownership='shared',x=>x.source.mode='unrecognized',
  x=>x.source.typedDigest=null,x=>x.source.path='../core.ores',
  x=>x.source.path='/absolute',x=>x.source.commit='bad',
  x=>x.source.repository='other-org/public',x=>x.assumptions=[],
  x=>x.assumptions.push(x.assumptions[0]),x=>x.obligations.pop(),
  x=>x.obligations[0].expected='sat',x=>x.obligations[1].expected='unsat',
  x=>x.obligations[1].id=x.obligations[0].id,
  x=>x.obligations[0].logic='QF_FP',x=>x.extra='hidden'
 ];
 for(const mutate of muts){const x=ir();mutate(x);assert.throws(()=>validateIr(x))}
});
test('receipt rejects forged-shaped, missing or stale run data and solver mutants',()=>{
 const muts=[
  r=>r.proofIrSha256='c'.repeat(64),r=>r.results.pop(),
  r=>r.results[0].verdict='unknown',r=>r.results[0].verdict='sat',
  r=>r.results[1].id=r.results[0].id,r=>r.results[0].transcriptSha256='',
  r=>r.solver.binarySha256='invalid',r=>r.solver.name='fake',
  r=>r.job.runnerId=0,r=>r.job.runAttempt=0,
  r=>r.job.headSha='c'.repeat(40),r=>r.job.checkedOutSha='c'.repeat(40),
  r=>r.job.steps=[],r=>r.job.steps[0].conclusion='skipped',
  r=>r.job.steps[1].id='checkout-identity',r=>r.job.conclusion='failure',
  r=>r.extra='passed'
 ];
 for(const mutate of muts){const b=bundle();mutate(b.receipt);assert.throws(()=>validateBundle(b.bytes,b.receipt))}
});
test('guest cannot borrow solver run or skip real guest execution',()=>{
 const muts=[
  g=>g.cases=0,g=>g.backend='unknown',g=>g.binarySha256='',
  g=>g.job.runnerId=0,g=>g.job.runAttempt=0,
  g=>g.job.headSha='c'.repeat(40),g=>g.job.steps.pop(),
  g=>g.job.repository='ores-truffle-oreslang/oreslang-common-source'
 ];
 for(const mutate of muts){
  const b=bundle();b.receipt.guest=guest();mutate(b.receipt.guest);
  assert.throws(()=>validateBundle(b.bytes,b.receipt));
 }
});
test('both schemas use strict versioned JSON Schema 2020-12 roots',()=>{
 for(const name of ['proof-ir.schema.json','proof-receipt.schema.json']){
  const s=JSON.parse(readFileSync(new URL('../contracts/verification/v1/'+name,import.meta.url)));
  assert.equal(s.$schema,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(s.properties.schemaVersion.const,1);
  assert.equal(s.additionalProperties,false);
 }
});
