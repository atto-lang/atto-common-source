#!/usr/bin/env node
// Unauthenticated structural checks only; verify actual GitHub job steps/artifacts independently.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const CONTRACT_URL=new URL('../contracts/macro-aot-jit-v1.json',import.meta.url);
export const sourceDigest = c => createHash('sha256').update(c.source,'utf8').digest('hex');
export function classifyReceipt(receipt,contract) {
 const errors=[];
 const fail=(ok,label)=>{if(!ok)errors.push(label);};
 const is40=x=>typeof x==="string"&&/^[0-9a-f]{40}$/.test(x);
 const is64=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))
  return {classification:"EVIDENCE_INVALID",errors:["receipt object missing"]};
 fail(receipt.schema==="atto.macro-aot-jit.evidence.v1","wrong evidence schema");
 const repo=contract.backend_repositories[receipt.backend];
 fail(Boolean(repo),"unknown backend");
 fail(["aot","jit","hybrid"].includes(receipt.mode),"unknown compilation mode");
 fail(is40(receipt.source_head),"source head SHA missing or malformed");
 fail(is40(receipt.source_tree),"source tree SHA missing or malformed");
 fail(receipt.source_repo===repo,"source repo mismatch");
 const job=receipt.job||{};
 fail(job.repository===repo,"source-local runner required: no cross-org source transfer authorization");
 fail(job.head_sha===receipt.source_head,"job head SHA mismatch");
 fail(Number.isSafeInteger(job.run_id)&&job.run_id>0,"missing run ID");
 fail(Number.isSafeInteger(job.job_id)&&job.job_id>0,"missing job ID");
 fail(Number.isSafeInteger(job.attempt)&&job.attempt>0,"missing run attempt");
 if(!Array.isArray(job.steps)||job.steps.length===0)
   return {classification:"NOT_EXECUTED",errors:[...errors,"runner executed no steps"]};
 const required=receipt.mode==="aot"
  ?["exact_head_checkout","compile_guest","execute_guest","reject_negatives","verify_aot_artifact"]
  :["exact_head_checkout","compile_guest","execute_guest","reject_negatives"];
 const names=new Set();
 for(const step of job.steps) {
  fail(typeof step?.name==="string"&&step.name.length>0,"unnamed step");
  fail(step?.conclusion==="success","failed/incomplete step");
  fail(!names.has(step?.name),"duplicate step");
  names.add(step?.name);
 }
 for(const name of required)fail(names.has(name),"missing step "+name);
 const build=receipt.build||{};
 for(const name of ["program_specific_guest_lowering","finite_closed_program","macro_ast_erased",
 "source_compiler_not_in_guest_runtime","macro_expander_not_in_guest_runtime",
 "guest_interpreter_fallback_disabled","no_runtime_authority_minting"])
  fail(build[name]===true,"unproven build property "+name);
 if(receipt.mode==="aot") {
  fail(build.runtime_jit_required===false,"AOT requires JIT disabled");
  fail(is64(build.executable_sha256),"artifact SHA256 missing");
  fail(["ELF","Mach-O","PE","WASM"].includes(build.artifact_format),"unsupported artifact format");
  fail(build.native_image_of_interpreter===false,"interpreter image is not guest AOT");
  fail(receipt.backend==="wasm"?build.artifact_format==="WASM":build.artifact_format!=="WASM",
   "artifact/backend format mismatch");
 }
 if(receipt.mode==="hybrid"){
  fail(build.precompiled_aot_baseline===true,"no precompiled AOT baseline");
  fail(build.jit_disabled_equivalence===true,"no JIT-off equivalence");
 }
 if(!Array.isArray(receipt.cases))
  return {classification:"EVIDENCE_INVALID",errors:[...errors,"cases array missing"]};
 const byId=new Map(contract.cases.map(x=>[x.id,x])),seen=new Set();
 let unsupported=false;
 for(const item of receipt.cases){
  const c=byId.get(item?.id);
  fail(Boolean(c),"unrecognized test case"); if(!c)continue;
  fail(!seen.has(c.id),"duplicate case "+c.id);seen.add(c.id);
  fail(item.source_sha256===sourceDigest(c),"case source digest drift "+c.id);
  if(item.result==="UNSUPPORTED"){
   unsupported=true;
   fail(item.layer==="compiler_admission","unsupported needs compiler admission");
   fail(Number.isInteger(item.exit_code)&&item.exit_code!==0,"unsupported exit not nonzero");
   fail(item.partial_artifact===false,"unsupported left partial artifact");
   continue;
  }
  if(c.expected==="execute"){
   fail(item.result==="PASS","missing positive PASS "+c.id);
   fail(item.layer==="guest_execution","host/model-only result "+c.id);
   fail(item.exit_code===0,"guest exit nonzero "+c.id);
   fail(item.stdout===c.expected_stdout,"guest stdout drift "+c.id);
   fail(item.compiled_guest===true,"guest source compilation absent "+c.id);
  }else{
   fail(item.result==="EXPECTED_REJECT","missing negative rejection "+c.id);
   fail(item.layer==="compiler_admission","negative did not reject at compiler "+c.id);
   fail(Number.isInteger(item.exit_code)&&item.exit_code!==0,"negative exited zero "+c.id);
   fail(item.partial_artifact===false,"negative left partial artifact "+c.id);
   fail(item.diagnostic_family===c.diagnostic_family,"wrong diagnostic "+c.id);
  }
 }
 for(const c of contract.cases)fail(seen.has(c.id),"missing case "+c.id);
 if(errors.length)return {classification:"EVIDENCE_INVALID",errors};
 if(unsupported)return {classification:"UNSUPPORTED_OR_INCOMPLETE",errors:["unsupported is not parity"]};
 return {classification:"STRUCTURALLY_COMPLETE_UNAUTHENTICATED",errors:[]};
}
export const contractFromDisk=()=>JSON.parse(readFileSync(fileURLToPath(CONTRACT_URL),'utf8'));
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
 if(process.argv.length!==3){console.error('usage: node tools/verify-macro-aot-jit-evidence.mjs <receipt.json>');process.exit(2);}
 try{const report=JSON.parse(readFileSync(process.argv[2],'utf8'));const result=classifyReceipt(report,contractFromDisk());console.log(JSON.stringify(result));// Structural-only, self-supplied evidence must NEVER satisfy a release gate.
  process.exit(1);}
 catch(e){console.error('EVIDENCE_INVALID: '+e.message);process.exit(1);}
}
