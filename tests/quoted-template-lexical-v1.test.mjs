import test from 'node:test';
import assert from 'node:assert/strict';
import {loadQuotedTemplateContract,validateQuotedTemplateContract} from '../tools/validate-quoted-template-v1.mjs';

test('ten real .atto fixtures have exact pinned Git blob identities',()=>{
 const result=validateQuotedTemplateContract(loadQuotedTemplateContract());
 assert.equal(result.verified_git_blobs,10);
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
 assert.throws(()=>validateQuotedTemplateContract(mutated),/Git blob SHA mismatch/);
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
