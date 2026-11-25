#!/usr/bin/env node
// This inventory records only authored .atto conformance candidates.
// It cannot certify that a compiler, guest program, runner or AOT executed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { gitBlobSha } from './verify-alloc-parity-v1.mjs';

const SHA = /^[0-9a-f]{40}$/;
const fail = (ok, why) => { if (!ok) throw new Error(why); };
const kinds = new Set(['linked_jvm_guest_policy',
  'compiled_native_box_i64_aot','compiled_negative_diagnostic',
  'compiled_guest','native_aot_guest']);
export function checkCandidateMatrix(contract, matrix, contractBlob) {
  fail(contract && matrix && matrix.schema_version===1 &&
    matrix.contract_id===contract.contract_id, 'contract/matrix schema mismatch');
  fail(SHA.test(contractBlob)&&matrix.contract_blob===contractBlob,
    'exact shared contract Git blob mismatch');
  fail(Array.isArray(contract.candidate_backends)&&contract.candidate_backends.length===11 &&
    Array.isArray(contract.cases)&&contract.cases.length===22,
    'unexpected contract shape');
  fail(Array.isArray(matrix.backend_candidates)&&matrix.backend_candidates.length===11,
    'missing/extra backend inventory');
  const backends=new Map(contract.candidate_backends.map(x=>[x.id,x]));
  const cases=new Map(contract.cases.map(x=>[x.id,x]));
  const seenBackends=new Set();
  let authored=0,remaining=0;
  for(const row of matrix.backend_candidates){
    fail(row&&backends.has(row.backend)&&!seenBackends.has(row.backend),
      'unknown or repeated backend candidate');
    seenBackends.add(row.backend);
    const spec=backends.get(row.backend);
    fail(row.repository===spec.repository&&row.profile===spec.profile,
      'backend repository/profile mismatch');
    fail(row.evidence_state==='NOT_VERIFIED', 'candidate inventory cannot certify tests');
    const applicable=contract.cases.filter(x=>
      x.applicability==='all'||x.applicability===spec.profile).map(x=>x.id);
    fail(row.applicable_cases===applicable.length,'wrong applicable case count');
    fail(Array.isArray(row.authored_cases)&&Array.isArray(row.remaining_unverified_cases),
      'missing fixture or unsupported-case inventory');
    if(row.authored_cases.length)fail(typeof row.source_head==='string'&&
      SHA.test(row.source_head),'source head absent for claimed fixture');
    else fail(row.source_head===null,'unmapped backend must not assert source proof');
    const claimed=new Set(),paths=new Set();
    for(const item of row.authored_cases){
      fail(item && applicable.includes(item.case_id)&&!claimed.has(item.case_id),
        'duplicate or inapplicable authored case');
      claimed.add(item.case_id);
      fail(typeof item.fixture_path==='string'&&
        /^tests\/[a-zA-Z0-9_./-]+\.atto$/.test(item.fixture_path)&&
        !item.fixture_path.split('/').some(x=>!x||x==='.'||x==='..')&&
        !paths.has(item.fixture_path), 'unsafe or reused .atto fixture path');
      paths.add(item.fixture_path);
      fail(SHA.test(item.fixture_blob),'missing exact fixture Git blob');
      fail(kinds.has(item.runner_kind),'unrecognized executable evidence type');
      fail(item.execution_state==='AUTHORED_NOT_EXECUTED',
        'source-only metadata cannot be an executed test');
      const expected=cases.get(item.case_id);
      fail(expected && ['PASS','REJECT'].includes(expected.expected),
        'invalid semantic case mapping');
    }
    const unverified=applicable.filter(x=>!claimed.has(x));
    fail(row.remaining_unverified_cases.length===unverified.length &&
      row.remaining_unverified_cases.every((x,i)=>x===unverified[i]),
      'remaining unverified contract cases omitted, duplicated or reordered');
    authored+=claimed.size;remaining+=unverified.length;
  }
  fail(seenBackends.size===11,'incomplete backend inventory');
  return {status:'CANDIDATE_ONLY_NOT_EXECUTED',backends:11,authored,remaining};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const raw=readFileSync('contracts/alloc/ownership-parity-v1.json');
    const matrix=JSON.parse(readFileSync('contracts/alloc/candidates-v1.json','utf8'));
    const result=checkCandidateMatrix(JSON.parse(raw.toString('utf8')),matrix,gitBlobSha(raw));
    console.log('ATTO_ALLOC_CANDIDATES_VALID '+JSON.stringify(result));
  }catch(error){console.error('ATTO_ALLOC_CANDIDATES_REJECT: '+error.message);process.exitCode=1;}
}
