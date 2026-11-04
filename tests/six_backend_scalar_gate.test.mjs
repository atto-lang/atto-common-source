import test from 'node:test';
import assert from 'node:assert/strict';
import {SCALAR_BACKENDS,SCALAR_CASES,admitSixBackendScalarCandidate,
  assertExecutedSixBackendScalarParity} from '../scripts/six_backend_scalar_gate.mjs';
const a='a'.repeat(40), b='b'.repeat(40), c='c'.repeat(40);
function fixture(){
 const backends={},provider={};
 for(const [i,name] of SCALAR_BACKENDS.entries()){
  backends[name]={sourceSha:b,sourceTreeSha:c,fixtureBlobSha:a,
    runId:100+i,jobId:200+i,
    cases:Object.fromEntries(SCALAR_CASES.map(x=>[x,'passed']))};
  provider[name]={sourceSha:b,runId:100+i,jobId:200+i,
    runnerId:300+i,steps:6,conclusion:'success',event:'pull_request'};
 }
 return {record:{version:1,fixtureBlobSha:a,backends},provider};
}
test('complete six-backend fixture yields untrusted candidate only',()=>{
 const {record,provider}=fixture();
 const r=admitSixBackendScalarCandidate(record,provider);
 assert.equal(r.classification,'UNTRUSTED_CANDIDATE_ONLY');
 assert.deepEqual(r.totals,{passed:36,failed:0,unsupported:0,not_executed:0});
 assert.equal(r.compilerParityCertified,false);
 assert.throws(()=>assertExecutedSixBackendScalarParity(record,provider),/requires independent/);
});
test('missing or counterfeit backend cannot certify',()=>{
 for(const k of SCALAR_BACKENDS){const {record,provider}=fixture();delete record.backends[k];
  assert.throws(()=>admitSixBackendScalarCandidate(record,provider),/incomplete/);}
 const x=fixture();x.record.backends.cranelift={...x.record.backends.cranelift,unreviewed:true};
 assert.throws(()=>admitSixBackendScalarCandidate(x.record,x.provider),/malformed/);
});
test('zero-step or unassigned runner or mismatched head, job, event fails closed',()=>{
 for(const [k,v] of [['steps',0],['runnerId',0],['sourceSha',a],['jobId',1],
   ['conclusion','failure'],['event','untrusted_event']]){
  const {record,provider}=fixture();provider.java[k]=v;
  assert.throws(()=>admitSixBackendScalarCandidate(record,provider),/missing independently/);
 }
});
test('skipped unsupported, failed and not-executed remain distinct',()=>{
 for(const status of ['unsupported','failed','not_executed']){
  const {record,provider}=fixture();record.backends.cranelift.cases.precedence=status;
  const r=admitSixBackendScalarCandidate(record,provider);
  assert.equal(r.totals[status],1);assert.equal(r.totals.passed,35);
  assert.throws(()=>assertExecutedSixBackendScalarParity(record,provider),/unsupported, missing/);
 }
});
test('source fixture mutation, unknown case, and invented pass status rejected',()=>{
 for(const change of [
  x=>{x.record.backends.net.fixtureBlobSha=c;},
  x=>{delete x.record.backends.forge.cases.precedence;},
  x=>{x.record.backends.wasm.cases.precedence='skipped';},
  x=>{x.record.backends.java.cases.extra='passed';},
  x=>{x.record.fixtureBlobSha='BAD';},
 ]){const x=fixture();change(x);assert.throws(()=>admitSixBackendScalarCandidate(x.record,x.provider));}
});
test('host evidence cannot claim executable parity even if every test is passed',()=>{
 const {record,provider}=fixture();
 assert.throws(()=>assertExecutedSixBackendScalarParity(record,provider),/NOT_ATTESTED/);
});
