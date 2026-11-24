import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gitBlobSha} from '../scripts/verify-alloc-parity-v1.mjs';
import {checkCandidateMatrix} from '../scripts/verify-alloc-candidates-v1.mjs';

const raw=readFileSync(new URL('../contracts/alloc/ownership-parity-v1.json',import.meta.url));
const contract=JSON.parse(raw.toString('utf8'));
const matrix=JSON.parse(readFileSync(
  new URL('../contracts/alloc/candidates-v1.json',import.meta.url),'utf8'));
const exact=gitBlobSha(raw);
const clone=()=>structuredClone(matrix);
function reject(change,reason){
  const m=clone();change(m);
  assert.throws(()=>checkCandidateMatrix(contract,m,exact),reason);
}
test('11 backend candidate inventories retain every unverified semantic case',()=>{
  const result=checkCandidateMatrix(contract,matrix,exact);
  assert.deepEqual(result,{status:'CANDIDATE_ONLY_NOT_EXECUTED',
    backends:11,authored:11,remaining:187});
  assert.equal(matrix.contract_blob,'bbe1f27352c5a8b9b887f1c02ce1d1c212603745');
});
test('cannot mark authored source or backend itself as executed',()=>{
  reject(m=>{m.backend_candidates[0].evidence_state='PASS'},/cannot certify/);
  reject(m=>{m.backend_candidates[0].authored_cases[0].execution_state='PASS'},/cannot be an executed test/);
  reject(m=>{m.backend_candidates[0].authored_cases[0].execution_state='EXECUTED'},/cannot be an executed test/);
});
test('exact source identity, fixtures and backend identity mandatory',()=>{
  reject(m=>{m.contract_blob='f'.repeat(40)},/contract Git blob/);
  reject(m=>{m.backend_candidates[0].source_head='stale'},/source head/);
  reject(m=>{m.backend_candidates[1].repository='atto-lang/atto-source.java'},/repository/);
  reject(m=>{m.backend_candidates[0].authored_cases[0].fixture_blob='stale'},/fixture Git blob/);
  reject(m=>{m.backend_candidates[0].authored_cases[0].fixture_path='tests/../bad.atto'},/unsafe/);
});
test('missing, duplicate, extra or profile-inapplicable cases must reject',()=>{
  reject(m=>{m.backend_candidates.pop()},/missing\/extra backend/);
  reject(m=>{m.backend_candidates[1].backend='java'},/repeated backend/);
  reject(m=>{m.backend_candidates[0].remaining_unverified_cases.pop()},/remaining unverified/);
  reject(m=>{m.backend_candidates[0].authored_cases.push(
    {...m.backend_candidates[0].authored_cases[0]})},/duplicate or inapplicable/);
  reject(m=>{
    const row=m.backend_candidates[8];
    const otherCase=contract.cases.find(item=>
      item.applicability!=='all'&&item.applicability!==row.profile);
    assert.ok(otherCase,'fixture must supply a case for a different profile');
    row.source_head='a'.repeat(40);
    row.authored_cases.push({...m.backend_candidates[0].authored_cases[0],case_id:otherCase.id});
  },/inapplicable/);
});
