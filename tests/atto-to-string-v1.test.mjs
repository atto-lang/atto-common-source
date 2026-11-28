import test from 'node:test';
import assert from 'node:assert/strict';
import {loadToStringV1,validateToStringV1} from '../tools/validate-atto-to-string-v1.mjs';

test('eight immutable native .atto to_string cases pin exact source bytes',()=>{
 const result=validateToStringV1(loadToStringV1());
 assert.equal(result.fixtures,8);
 assert.equal(result.compiler_status,'NOT_EXECUTED');
});
test('do not promote a draft backend to compiled or executed parity',()=>{
 for(const backend of ['java','llvm','forge','wasm','net']){
  const fake=structuredClone(loadToStringV1());
  fake.backend_evidence[backend].guest_executed=true;
  assert.throws(()=>validateToStringV1(fake),/unsupported or forged execution evidence/);
 }
});
test('do not allow manifest path and Git blob hash to rotate together',()=>{
 const swapped=structuredClone(loadToStringV1());
 swapped.cases[0].path=swapped.cases[1].path;
 swapped.cases[0].git_blob_sha=swapped.cases[1].git_blob_sha;
 assert.throws(()=>validateToStringV1(swapped),/identity drift/);
});
test('all source expected results are immutable, not merely their SHA',()=>{
 const changed=structuredClone(loadToStringV1());
 changed.cases[0].expected_output_or_diagnostic='unknown';
 assert.throws(()=>validateToStringV1(changed),/identity drift/);
 const mutated=structuredClone(loadToStringV1());
 mutated.cases[3].expect_frontend='ACCEPT';
 assert.throws(()=>validateToStringV1(mutated),/identity drift/);
});
test('guest implicit object-to-string and numeric interpolation stay forbidden',()=>{
 const m=loadToStringV1();
 assert.match(m.semantics.class,/no implicit class-to-String conversion/);
 assert.match(m.semantics.template,/requires String statically/);
 for(const id of ['reject-implicit-class-conversion','reject-implicit-int-template']){
  assert.equal(m.cases.find(c=>c.id===id).expect_frontend,'REJECT');
 }
 const bad=structuredClone(m);
 bad.semantics.class='class Java Object.toString fallback permitted';
 assert.throws(()=>validateToStringV1(bad),/semantic type or conversion drift/);
});
test('incomplete or forged backend inventory must fail closed',()=>{
 const incomplete=structuredClone(loadToStringV1());
 incomplete.cases.pop();
 assert.throws(()=>validateToStringV1(incomplete),/incomplete physical/);
 const forged=structuredClone(loadToStringV1());
 forged.backend_evidence.llvm.implementation='PASS';
 assert.throws(()=>validateToStringV1(forged),/unsupported or forged/);
});
