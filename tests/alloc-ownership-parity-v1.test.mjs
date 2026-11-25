import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gitBlobSha,validateRegistry,verifyEvidence,verifyBatch} from '../scripts/verify-alloc-parity-v1.mjs';

const raw = readFileSync(new URL('../contracts/alloc/ownership-parity-v1.json',import.meta.url));
const registry = JSON.parse(raw.toString('utf8'));
const blob = gitBlobSha(raw);
const SHA = 'a'.repeat(40);
function evidence(backend='java'){
  const entry=registry.candidate_backends.find(x=>x.id===backend);
  const applicable=registry.cases.filter(c=>c.applicability==='all'||c.applicability===entry.profile);
  return {
    backend, repository:entry.repository, fixture_blob:blob,
    source_head:'b'.repeat(40), source_tree:'c'.repeat(40), mirror_head:SHA,
    run:{id:31,run_attempt:1,head_sha:SHA,status:'completed',conclusion:'success'},
    job:{id:32,run_id:31,run_attempt:1,runner_id:33,head_sha:SHA,
      status:'completed',conclusion:'success',
      steps:[{name:'Execute allocation conformance guest',status:'completed',conclusion:'success'}]},
    execution_marker:'ATTO_ALLOC_GUEST_EXECUTED',
    skipped_tests:0,failed_tests:0,errored_tests:0,
    executed_tests:applicable.length,
    observations:applicable.map(c=>({case_id:c.id,phase:c.phase,outcome:c.expected,executed:true,skipped:false,observation:'SYNTHETIC TEST VECTOR ONLY'}))
  };
}
const reject=(mutate,message)=>{
  const rec=evidence();mutate(rec);assert.throws(()=>verifyEvidence(registry,rec,blob),message);
};
test('contract blob is stable and exactly 11 backends with 22 semantic cases',()=>{
  assert.equal(blob,'bbe1f27352c5a8b9b887f1c02ce1d1c212603745');
  assert.equal(validateRegistry(registry).candidate_backends.length,11);
  assert.equal(registry.cases.length,22);
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,registry.cases.length);
});
test('synthetic fixture proves offline validator behavior, NOT real CI execution',()=>{
  const a=verifyEvidence(registry,evidence(),blob);
  assert.equal(a.offline_only,true);
  assert.equal(a.backend,'java');
  assert.ok(a.cases>=16);
  assert.equal(verifyEvidence(registry,evidence('hdl'),blob).cases,9);
});
test('runner-less, zero-step and stale/mismatched run fail closed',()=>{
  reject(e=>{e.job.steps=[]},/zero-step/);
  reject(e=>{e.job.runner_id=0},/runner/);
  reject(e=>{e.job.runner_id=true},/runner/);
  reject(e=>{e.run.head_sha='d'.repeat(40)},/stale/);
  reject(e=>{e.run.conclusion='failure'},/non-successful/);
  reject(e=>{e.job.run_id=99},/runner/);
  reject(e=>{e.job.run_attempt=2},/runner/);
  reject(e=>{e.job.steps[0].conclusion='skipped'},/execution step/);
  reject(e=>{e.execution_marker='PENDING'},/marker/);
});
test('source and fixture identity cannot silently drift',()=>{
  reject(e=>{e.fixture_blob='d'.repeat(40)},/blob mismatch/);
  reject(e=>{e.source_head='invalid'},/source_head/);
  reject(e=>{e.source_tree=e.mirror_head},/identity/);
  reject(e=>{e.repository='other/repository'},/source repository/);
  reject(e=>{e.backend='unknown'},/unknown backend/);
});
test('case coverage cannot count skipped, duplicate or wrong outcomes',()=>{
  reject(e=>{e.skipped_tests=1},/skipped_tests/);
  reject(e=>{e.failed_tests=1},/failed_tests/);
  reject(e=>{e.errored_tests=1},/errored_tests/);
  reject(e=>{e.executed_tests=0},/executed test/);
  reject(e=>{e.observations.pop()},/applicable observations/);
  reject(e=>{e.observations[1]=e.observations[0]},/duplicate/);
  reject(e=>{e.observations[0].outcome='PASS'},/semantic outcome/);
  reject(e=>{e.observations[0].executed=false},/did not execute/);
  reject(e=>{e.observations[0].observation='PENDING'},/real observation/);
});
test('restricted backend cannot claim hosted-only cases',()=>{
  reject(e=>{e.backend='hdl'},/repository mismatch/);
  const rec=evidence('hdl');
  rec.observations[0].phase='compile';
  assert.throws(()=>verifyEvidence(registry,rec,blob),/semantic outcome/);
});
test('all-backend flag does not certify partial evidence',()=>{
  assert.throws(()=>verifyBatch(registry,[evidence()],blob,true),/missing backend/);
  assert.equal(verifyBatch(registry,[evidence()],blob,false).length,1);
  const same=evidence();assert.throws(()=>verifyBatch(registry,[same,same],blob,false),/duplicate backend/);
  assert.equal(verifyBatch(registry,registry.candidate_backends.map(b=>evidence(b.id)),blob,true).length,11);
});
test('contract cannot be marked certified by editing registry',()=>{
  const changed=structuredClone(registry);
  changed.candidate_backends[0].evidence_state='PASS';
  assert.throws(()=>validateRegistry(changed),/registry must not claim/);
});
