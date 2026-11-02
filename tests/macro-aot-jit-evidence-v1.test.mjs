import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReceipt,contractFromDisk,sourceDigest} from '../tools/verify-macro-aot-jit-evidence.mjs';
const c=contractFromDisk();
function valid(backend='llvm',mode='aot'){
 const H='a'.repeat(40);
 return {schema:'atto.macro-aot-jit.evidence.v1',backend,mode,source_repo:c.backend_repositories[backend],
 source_head:H,source_tree:'b'.repeat(40),
 job:{repository:c.backend_repositories[backend],head_sha:H,run_id:123,job_id:789,attempt:1,
 steps:['exact_head_checkout','compile_guest','execute_guest','reject_negatives','verify_aot_artifact'].map(name=>({name,conclusion:'success'}))},
 build:{program_specific_guest_lowering:true,finite_closed_program:true,macro_ast_erased:true,
 source_compiler_not_in_guest_runtime:true,macro_expander_not_in_guest_runtime:true,guest_interpreter_fallback_disabled:true,
 no_runtime_authority_minting:true,runtime_jit_required:false,executable_sha256:'c'.repeat(64),
 artifact_format:backend==='wasm'?'WASM':'ELF',native_image_of_interpreter:false,
 artifact_kind:backend==='wasm'?'closed_guest_wasm_module':'standalone_guest_executable',
 linked_guest_entry_executed:true,
 precompiled_aot_baseline:true,jit_disabled_equivalence:true},
 cases:c.cases.map(row=>({id:row.id,source_sha256:sourceDigest(row),
 ...(row.expected==='execute'?{result:'PASS',layer:'guest_execution',exit_code:0,stdout:row.expected_stdout,compiled_guest:true}:
 {result:'EXPECTED_REJECT',layer:'compiler_admission',exit_code:1,partial_artifact:false,diagnostic_family:row.diagnostic_family})}))};
}
const classify=r=>classifyReceipt(r,c).classification;
test('contract pins all five backends and honest evidence layers',()=>{
 assert.equal(c.status,'CONTRACT_ONLY_NO_BACKEND_EXECUTION_CREDIT');
 assert.equal(Object.keys(c.backend_repositories).length,5);
 assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
 assert.equal(c.execution_modes.jit.does_not_satisfy_aot_release_gate,true);
 assert.equal(c.minimum_matrix.structural_receipt_validation_not_authentication,true);
});
test('synthetic receipts have only unauthenticated status, never verified pass',()=>{
 for(const backend of Object.keys(c.backend_repositories))
  assert.equal(classify(valid(backend)),'AOT_STRUCTURAL_UNAUTHENTICATED');
});
test('zero/null steps are NOT_EXECUTED, even if all case claims say PASS',()=>{
 for(const steps of [[],null]){const r=valid();r.job.steps=steps;assert.equal(classify(r),'NOT_EXECUTED');}
});
const attacks=[
 ['head mismatch',r=>r.job.head_sha='d'.repeat(40)],
 ['wrong tree',r=>r.source_tree='broken'],
 ['other org runner',r=>r.job.repository='other/private-runner'],
 ['no run attempt',r=>delete r.job.attempt],
 ['step omission',r=>r.job.steps.splice(1,1)],
 ['duplicate steps',r=>r.job.steps.push({...r.job.steps[0]})],
 ['step failure',r=>r.job.steps[1].conclusion='failure'],
 ['host smoke only',r=>r.cases[0].layer='host_runtime'],
 ['source blob changed',r=>r.cases[1].source_sha256='0'.repeat(64)],
 ['partial negative IR',r=>r.cases[2].partial_artifact=true],
 ['negative successful exit',r=>r.cases[3].exit_code=0],
 ['diagnostic drift',r=>r.cases[4].diagnostic_family='OTHER'],
 ['missing test',r=>r.cases.pop()],
 ['duplicate test',r=>r.cases.push({...r.cases[0]})],
 ['runtime expander linked',r=>r.build.macro_expander_not_in_guest_runtime=false],
 ['interpreter native image',r=>r.build.native_image_of_interpreter=true],
 ['JIT required in strict AOT',r=>r.build.runtime_jit_required=true],
 ['no artifact digest',r=>delete r.build.executable_sha256]
];
for(const [name,mutate] of attacks)
 test('fail closed: '+name,()=>{const r=valid();mutate(r);assert.notEqual(classify(r),'AOT_STRUCTURAL_UNAUTHENTICATED');});
test('unsupported positive is not a pass',()=>{
 const r=valid();Object.assign(r.cases[0],{result:'UNSUPPORTED',layer:'compiler_admission',exit_code:1,partial_artifact:false});
 assert.equal(classify(r),'UNSUPPORTED_OR_INCOMPLETE');
});
test('JIT is a separate optional class, never binary-AOT credit',()=>{
 const r=valid('cranelift','jit');r.job.steps.pop();delete r.build.executable_sha256;
 assert.equal(classify(r),'JIT_ONLY_STRUCTURAL_UNAUTHENTICATED');
 assert.equal(r.mode,'jit');
});
test('hybrid requires proven JIT-off AOT baseline',()=>{
 const r=valid('java-graal','hybrid');r.job.steps.pop();r.build.jit_disabled_equivalence=false;
 assert.equal(classify(r),'EVIDENCE_INVALID');
});
test('malformed case collection fails closed instead of crashing',()=>{
 const r=valid();r.cases={forged:true};assert.equal(classify(r),'EVIDENCE_INVALID');
});

test('CLI never exits green merely from self-declared structural completeness', async () => {
 const {spawnSync}=await import('node:child_process');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {fileURLToPath}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'atto-macro-evidence-'));
 try{
  const report=join(dir,'self-attested.json');
  writeFileSync(report,JSON.stringify(valid()));
  const script=fileURLToPath(new URL('../tools/verify-macro-aot-jit-evidence.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[script,report],{encoding:'utf8',timeout:4000});
  assert.equal(run.error,undefined);
  assert.equal(run.status,1,'untrusted report must not make CI green');
  assert.match(run.stdout,/AOT_STRUCTURAL_UNAUTHENTICATED/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('hybrid structural receipt is separately labelled and never release-qualified',()=>{
 const r=valid('java-graal','hybrid');r.job.steps.pop();
 const out=classifyReceipt(r,c);
 assert.equal(out.classification,'HYBRID_STRUCTURAL_UNAUTHENTICATED');
 assert.equal(out.release_qualified,false);
});

test('native object alone cannot masquerade as complete program-specific guest AOT',()=>{
 const r=valid('cranelift','aot');
 r.build.artifact_kind='relocatable_guest_object';
 assert.equal(classify(r),'EVIDENCE_INVALID');
 const wasm=valid('wasm','aot'); wasm.build.artifact_kind='standalone_guest_executable';
 assert.equal(classify(wasm),'EVIDENCE_INVALID');
});
test('a fabricated linker digest without executed linked entrypoint is rejected',()=>{
 const r=valid();r.build.linked_guest_entry_executed=false;
 assert.equal(classify(r),'EVIDENCE_INVALID');
});
