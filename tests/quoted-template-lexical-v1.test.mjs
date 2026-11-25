import test from 'node:test';
import assert from 'node:assert/strict';
import {loadQuotedTemplateContract,validateQuotedTemplateContract} from '../tools/validate-quoted-template-v1.mjs';

test('twelve real .atto fixtures have exact pinned Git blob identities',()=>{
 const result=validateQuotedTemplateContract(loadQuotedTemplateContract());
 assert.equal(result.verified_git_blobs,12);
 assert.equal(result.backend_evidence,'NOT_EXECUTED');
});
test('cannot promote lexical fixtures into execution evidence',()=>{
 const forged=structuredClone(loadQuotedTemplateContract());
 forged.backend_evidence.net.guest_executed_for_manifest=true;
 assert.throws(()=>validateQuotedTemplateContract(forged),/unsupported executed/);
 const fake=structuredClone(loadQuotedTemplateContract());
 fake.cases[0].typed_runtime_outcome='PASS';
 assert.throws(()=>validateQuotedTemplateContract(fake),/unverified guest pass/);
});
test('deny missing fixture or forged Git source hash',()=>{
 const missing=structuredClone(loadQuotedTemplateContract());
 missing.cases.pop();
 assert.throws(()=>validateQuotedTemplateContract(missing),/missing or extra/);
 const mutated=structuredClone(loadQuotedTemplateContract());
 mutated.cases[1].git_blob_sha='0'.repeat(40);
 assert.throws(()=>validateQuotedTemplateContract(mutated),/pinned path|Git blob SHA mismatch/);
});
test('caps and backend-specific comment depth cannot silently drift',()=>{
 const v=structuredClone(loadQuotedTemplateContract());
 v.semantics.limits.interpolation_braces_including_outer=257;
 assert.throws(()=>validateQuotedTemplateContract(v),/limit drift/);
 const w=structuredClone(loadQuotedTemplateContract());
 w.generated_boundaries[3].profile='all backends';
 assert.throws(()=>validateQuotedTemplateContract(w),/comment budget/);
});

test('manifest cannot rebind a fixture to another valid path and hash',()=>{
 const swapped=structuredClone(loadQuotedTemplateContract());
 swapped.cases[0].path=swapped.cases[1].path;
 swapped.cases[0].git_blob_sha=swapped.cases[1].git_blob_sha;
 assert.throws(()=>validateQuotedTemplateContract(swapped),/pinned path/);
 const rehomed=structuredClone(loadQuotedTemplateContract());
 rehomed.cases[2].path='fixtures/quoted-template-v1/quoted-raw-newline.atto';
 rehomed.cases[2].git_blob_sha=rehomed.cases[1].git_blob_sha;
 assert.throws(()=>validateQuotedTemplateContract(rehomed),/pinned path/);
});

test('draft Java/LLVM comment-budget PRs cannot be relabeled merged in evidence',()=>{
 const claim=structuredClone(loadQuotedTemplateContract());
 claim.pending_review.status='MERGED';
 assert.throws(()=>validateQuotedTemplateContract(claim),/unverified Java\/LLVM/);
 const forged=structuredClone(loadQuotedTemplateContract());
 forged.pending_review.llvm='https://github.com/other/other/pull/1';
 assert.throws(()=>validateQuotedTemplateContract(forged),/unverified Java\/LLVM/);
});

test('complete frontend outcome is distinct from scanner-only rejection',()=>{
 const m=loadQuotedTemplateContract();
 for(const id of ['template-empty-interpolation','template-comment-only']) {
  assert.equal(m.cases.find(c=>c.id===id).expect_frontend,'REJECT');
  assert.equal(m.admission_stage_profiles[id].java,'PARSER_LOWERING');
  assert.equal(m.admission_stage_profiles[id].llvm,'PARSER_LOWERING');
 }
 const forged=structuredClone(m);
 forged.admission_stage_profiles['template-comment-only'].java='SCANNER';
 assert.throws(()=>validateQuotedTemplateContract(forged),/scanner-vs-parser stage/);
 const stale=structuredClone(m);
 stale.cases[0].expect_lexical='ACCEPT';
 assert.throws(()=>validateQuotedTemplateContract(stale),/fixture identity/);
});

test('Wasm-specific UTF-8 byte bound is not a global source limit',()=>{
 const m=loadQuotedTemplateContract();
 assert.equal(m.backend_specific_source_limits.wasm.max_utf8_bytes,1048576);
 const bad=structuredClone(m);
 bad.backend_specific_source_limits.wasm.max_utf8_bytes=1048577;
 assert.throws(()=>validateQuotedTemplateContract(bad),/Wasm byte-budget/);
 const other=structuredClone(m);
 other.backend_specific_source_limits.java={max_utf8_bytes:1048576};
 assert.throws(()=>validateQuotedTemplateContract(other),/Wasm byte-budget/);
});
