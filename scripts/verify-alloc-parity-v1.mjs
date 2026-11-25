#!/usr/bin/env node
// Offline Atto allocation parity evidence validator. Not a GitHub attestation.
// Independently fetch/verify immutable source+mirror Git trees and job steps
// using scripts/exact_source_gate.py before accepting any release evidence.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const KNOWN_BACKENDS = ["java","llvm","rs","cranelift","forge","wasm","net","js","hdl","realtime","atto"];
const assertOk = function assertOk(condition,msg){if(!condition)throw new Error(msg)};
const shaLike = function shaLike(x){return typeof x==="string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x)};
const positiveId = function positiveId(x){return Number.isSafeInteger(x)&&x>0};
export function validateRegistry(registry){
  assertOk(registry && typeof registry==="object"&&!Array.isArray(registry),"registry object required");
  assertOk(registry.schema_version===1&&registry.contract_id==="atto-alloc-ownership-parity-v1","unsupported contract/version");
  assertOk(Array.isArray(registry.candidate_backends)&&registry.candidate_backends.length===11,"exactly eleven backends required");
  const seen=new Set();
  for(const b of registry.candidate_backends){
    assertOk(b&&KNOWN_BACKENDS.includes(b.id)&&!seen.has(b.id),"invalid or duplicate backend");
    seen.add(b.id);
    assertOk(b.repository===`atto-lang/atto-source.${b.id}`,"repository identity mismatch");
    assertOk(["hosted","restricted"].includes(b.profile),"invalid profile");
    assertOk(b.evidence_state==="NOT_VERIFIED","registry must not claim unverified backend is certified");
    assertOk(b.candidate_pr===null||(typeof b.candidate_pr==="string"&&b.candidate_pr.startsWith(`https://github.com/${b.repository}/pull/`)),"invalid PR link");
  }
  assertOk(KNOWN_BACKENDS.every(x=>seen.has(x)),"missing backend");
  assertOk(Array.isArray(registry.cases)&&registry.cases.length>=20&&registry.cases.length<=128,"invalid case inventory");
  const ids=new Set();
  for(const c of registry.cases){
    assertOk(c&&typeof c.id==="string"&&/^[a-z]+(?:[._][a-z0-9]+)+$/.test(c.id)&&!ids.has(c.id),"invalid duplicate case");
    ids.add(c.id);
    assertOk(typeof c.capability==="string"&&/^[a-z]+$/.test(c.capability),"invalid capability");
    assertOk(["PASS","REJECT"].includes(c.expected),"invalid expected result");
    assertOk(["compile","guest","runtime"].includes(c.phase),"invalid execution phase");
    assertOk(["all","hosted","restricted"].includes(c.applicability),"invalid applicability");
  }
  for(const b of registry.candidate_backends){
    const cases=registry.cases.filter(c=>c.applicability==="all"||c.applicability===b.profile);
    assertOk(cases.length>0 && cases.some(x=>x.expected==="REJECT"),"backend missing rejection obligations");
  }
  assertOk(registry.proof_protocol?.required_successful_step==="Execute allocation conformance guest","missing real test step contract");
  return registry;
};
export function verifyEvidence(registry, evidence, registryBlob){
  validateRegistry(registry);
  assertOk(shaLike(registryBlob),"invalid pinned contract blob");
  assertOk(evidence&&typeof evidence==="object"&&!Array.isArray(evidence),"evidence object required");
  const backend=registry.candidate_backends.find(x=>x.id===evidence.backend);
  assertOk(!!backend,"evidence unknown backend");
  assertOk(evidence.fixture_blob===registryBlob,"contract fixture blob mismatch");
  assertOk(evidence.repository===backend.repository,"source repository mismatch");
  for(const prop of ["source_head","source_tree","mirror_head"]){assertOk(shaLike(evidence[prop]),`invalid ${prop}`)}
  assertOk(evidence.source_tree!==evidence.mirror_head,"tree identity cannot be substituted by mirror commit");
  const run=evidence.run,job=evidence.job;
  assertOk(run&&job&&typeof run==="object"&&typeof job==="object","missing GitHub run/job evidence");
  assertOk(positiveId(run.id)&&positiveId(run.run_attempt),"missing run ID/attempt");
  assertOk(run.head_sha===evidence.mirror_head && run.status==="completed"&&run.conclusion==="success","stale or non-successful run");
  assertOk(positiveId(job.id)&&job.run_id===run.id&&job.run_attempt===run.run_attempt&&positiveId(job.runner_id),"job has no verified runner identity");
  assertOk(job.head_sha===run.head_sha&&job.status==="completed"&&job.conclusion==="success","wrong or unfinished job");
  const steps=job.steps;
  assertOk(Array.isArray(steps)&&steps.length>0,"zero-step job is NOT_EXECUTED");
  const needed=registry.proof_protocol.required_successful_step;
  assertOk(steps.some(s=>s&&s.name===needed&&s.status==="completed"&&s.conclusion==="success"),"required guest execution step absent");
  assertOk(evidence.execution_marker==="ATTO_ALLOC_GUEST_EXECUTED","executed guest marker absent (verify independently in log)");
  for(const field of ["skipped_tests","failed_tests","errored_tests"]){assertOk(evidence[field]===0,`${field} is nonzero or missing`)}
  const expected=registry.cases.filter(c=>c.applicability==="all"||c.applicability===backend.profile);
  assertOk(Array.isArray(evidence.observations)&&evidence.observations.length===expected.length,"missing/extra applicable observations");
  assertOk(positiveId(evidence.executed_tests)&&evidence.executed_tests>=expected.length,"insufficient executed test count");
  const want=new Map(expected.map(c=>[c.id,c])),seen=new Set();
  for(const result of evidence.observations){
    assertOk(result&&typeof result==="object"&&want.has(result.case_id)&&!seen.has(result.case_id),"unknown/duplicate/missing case");
    seen.add(result.case_id);
    const c=want.get(result.case_id);
    assertOk(result.phase===c.phase&&result.outcome===c.expected,"mismatched semantic outcome/phase");
    assertOk(result.executed===true&&result.skipped===false,"case did not execute");
    assertOk(typeof result.observation==="string"&&result.observation.trim().length>=4 && !/\b(SKIP|TODO|PENDING|UNKNOWN|NOT_EXECUTED)\b/i.test(result.observation),"missing real observation");
  }
  return {backend:backend.id,cases:expected.length,offline_only:true};
};
export function verifyBatch(registry,records,blob,requireAll){
  validateRegistry(registry);
  assertOk(Array.isArray(records)&&records.length>0,"missing submitted evidence");
  const seen=new Set(),reports=[];
  for(const rec of records){
    const out=verifyEvidence(registry,rec,blob);
    assertOk(!seen.has(out.backend),"duplicate backend record");
    seen.add(out.backend);reports.push(out);
  }
  if(requireAll)assertOk(registry.candidate_backends.every(b=>seen.has(b.id)),"missing backend: all-backend parity gate is fail-closed");
  return reports;
};
export function gitBlobSha(bytes) {
  const prefix = Buffer.from('blob ' + bytes.length + '\0','utf8');
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}
function cli(args) {
  const registryPath = 'contracts/alloc/ownership-parity-v1.json';
  const raw = readFileSync(registryPath);
  const registry = validateRegistry(JSON.parse(raw.toString('utf8')));
  const contractBlob = gitBlobSha(raw);
  if(args.length===0 || (args.length===1 && args[0]==='--validate-contract')) {
    console.log('ATTO_ALLOC_CONTRACT_VALID backends='+registry.candidate_backends.length+' cases='+registry.cases.length+' blob='+contractBlob);
    return;
  }
  let files=[], all=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--evidence'&&args[i+1])files.push(args[++i]);
    else if(args[i]==='--require-all')all=true;
    else throw new Error('unsupported CLI argument '+args[i]);
  }
  const reports=verifyBatch(registry,files.map(f=>JSON.parse(readFileSync(f,'utf8'))),contractBlob,all);
  for(const rec of reports)console.log('OFFLINE_EVIDENCE_SHAPE_PASS '+rec.backend+' cases='+rec.cases+' NOT_LIVE_ATTESTATION');
  console.log('CAUTION: Independently verify actual GitHub tree, job steps and log markers; this is no automatic parity certification.');
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{cli(process.argv.slice(2));}catch(error){console.error('ATTO_ALLOC_PARITY_REJECT: '+error.message);process.exitCode=1;}
}
