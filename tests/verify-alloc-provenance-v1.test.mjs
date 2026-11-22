import { test } from 'node:test';
import assert from 'node:assert/strict';
import {verifyExactMirrorTree,verifyGitHubJob,verifyCaseLog,verifyAllocationProvenance}
  from '../scripts/verify-alloc-provenance-v1.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const source={truncated:false,tree:[
  {path:'x.atto',type:'blob',mode:'100644',sha:A},
  {path:'lib/y.atto',type:'blob',mode:'100644',sha:B}]};
const mirror={truncated:false,tree:[
  {path:'atto-source/x.atto',type:'blob',mode:'100644',sha:A},
  {path:'atto-source/lib/y.atto',type:'blob',mode:'100644',sha:B}]};
const run={id:1001,run_attempt:1,head_sha:C,status:'completed',conclusion:'success'};
const job={id:2001,runner_id:3001,run_id:1001,run_attempt:1,head_sha:C,
  status:'completed',conclusion:'success',
  steps:[{name:'Execute allocation conformance guest',status:'completed',conclusion:'success'}]};
const cases=[{id:'move.after',phase:'compile',expected:'REJECT'},
  {id:'drop.once',phase:'guest',expected:'PASS'}];
const fixtures={'move.after':A,'drop.once':B};
const log=`other output\nATTO_ALLOC_CASE move.after compile REJECT ${A}\n`+
  `ATTO_ALLOC_CASE drop.once guest PASS ${B}\nATTO_ALLOC_GUEST_EXECUTED\n`;
const clone=x=>structuredClone(x);
const reject=(f,re)=>assert.throws(f,re);
test('exact paths, modes, git object SHAs required',()=>{
  assert.equal(verifyExactMirrorTree(source,mirror),2);
  let m=clone(mirror);m.tree[0].sha=C;
  reject(()=>verifyExactMirrorTree(source,m),/object mismatch/);
  m=clone(mirror);m.tree.pop();
  reject(()=>verifyExactMirrorTree(source,m),/missing or additional/);
  m=clone(mirror);m.tree[0].mode='100755';
  reject(()=>verifyExactMirrorTree(source,m),/object mismatch/);
  m=clone(mirror);m.truncated=true;
  reject(()=>verifyExactMirrorTree(source,m),/truncated/);
  m=clone(mirror);m.tree[0].path='atto-source/../evil';
  reject(()=>verifyExactMirrorTree(source,m),/unsafe/);
});
test('actual executed GitHub run and job correlation required',()=>{
  verifyGitHubJob(run,job,C,'Execute allocation conformance guest');
  let j=clone(job);j.steps=null;
  reject(()=>verifyGitHubJob(run,j,C,'Execute allocation conformance guest'),/zero-step/);
  j=clone(job);j.runner_id=null;
  reject(()=>verifyGitHubJob(run,j,C,'Execute allocation conformance guest'),/unassigned/);
  j=clone(job);j.steps[0].conclusion='skipped';
  reject(()=>verifyGitHubJob(run,j,C,'Execute allocation conformance guest'),/step did not succeed/);
  j=clone(job);j.run_attempt=2;
  reject(()=>verifyGitHubJob(run,j,C,'Execute allocation conformance guest'),/failed GitHub job/);
  const r=clone(run);r.conclusion='failure';
  reject(()=>verifyGitHubJob(r,job,C,'Execute allocation conformance guest'),/non-successful/);
});
test('guest case receipts must match case, phase, expected outcome and fixture SHA',()=>{
  assert.equal(verifyCaseLog(log,cases,fixtures),2);
  reject(()=>verifyCaseLog(log.replace('guest PASS','guest REJECT'),cases,fixtures),/result/);
  reject(()=>verifyCaseLog(log.replace(A,C),cases,fixtures),/fixture blob mismatch/);
  reject(()=>verifyCaseLog(log.replace(`ATTO_ALLOC_CASE drop.once guest PASS ${B}\n`,''),cases,fixtures),/missing executed/);
  reject(()=>verifyCaseLog(log+`ATTO_ALLOC_CASE move.after compile REJECT ${A}\n`,cases,fixtures),/repeated/);
  reject(()=>verifyCaseLog(log+'ATTO_ALLOC_GUEST_EXECUTED\n',cases,fixtures),/duplicated/);
  reject(()=>verifyCaseLog('PENDING',cases,fixtures),/marker/);
});
test('synthetic record only proves offline crosscheck, never authentication',()=>{
  assert.deepEqual(verifyAllocationProvenance({sourceTree:source,mirrorTree:mirror,
    mirrorPrefix:'atto-source/',mirrorHead:C,run,job,
    requiredStep:'Execute allocation conformance guest',jobLog:log,cases,fixtureBlobs:fixtures}),
  {status:'OFFLINE_CROSSCHECK_ONLY',exactGitObjects:2,caseReceipts:2});
});
