import test from "node:test";
import assert from "node:assert/strict";
import {parseFiveBackendActorEvidence,ACTOR_BACKENDS,ACTOR_CASES}
  from "../scripts/five_backend_actor_evidence.mjs";

const PASS={
  java:["boolean-singleton","nested-borrow","primitive","runtime-envelope","unknown-nominal"],
  llvm:["messagepack-v2"],
  net:["actor-ref-on-wire","same-id-cross-mailbox","stale-generation"],
  wasm:[],
  forge:["same-id-cross-mailbox","stale-generation"]
};
function sample(){
  const lines=[];
  for(const backend of ACTOR_BACKENDS){
    const states=Object.fromEntries(ACTOR_CASES.map(c=>[
      c,PASS[backend].includes(c)?"passed":"unsupported"
    ]));
    const n=PASS[backend].length;
    lines.push("2026-10-16T18:17:24.0000000Z "+backend+" "+JSON.stringify(states));
    lines.push("2026-10-16T18:17:24.0001000Z "+backend+
      " {'passed': "+n+", 'failed': 0, 'unsupported': "+(13-n)+"}");
  }
  return lines.join("\n");
}
test("a complete 65-pair source-log matrix treats unsupported as unsupported",()=>{
 const r=parseFiveBackendActorEvidence(sample());
 assert.deepEqual(r.total,{passed:11,failed:0,unsupported:54});
 assert.equal(r.backends.wasm.passed,0);
 assert.equal(r.backends.llvm.cases["messagepack-v2"],"passed");
});
test("missing backend or truncated raw log cannot certify parity",()=>{
 const parts=sample().split("\n");
 assert.throws(()=>parseFiveBackendActorEvidence(parts.slice(0,-2).join("\n")),/missing/);
 assert.throws(()=>parseFiveBackendActorEvidence(parts.filter(x=>!x.includes("forge {'")).join("\n")),/missing/);
});
test("duplicated backend records and summaries cannot overwrite earlier results",()=>{
 const lines=sample().split("\n");
 assert.throws(()=>parseFiveBackendActorEvidence(sample()+"\n"+lines[0]),/duplicate/);
 assert.throws(()=>parseFiveBackendActorEvidence(sample()+"\n"+lines[1]),/duplicate/);
});
test("contradictory passed count and unsupported promotion are rejected",()=>{
 const original=sample();
 assert.throws(()=>parseFiveBackendActorEvidence(original.replace(
   "java {'passed': 5", "java {'passed': 6")),/counts disagree/);
 const promoted=original.replace('"callable":"unsupported"','"callable":"passed"');
 assert.throws(()=>parseFiveBackendActorEvidence(promoted),/counts disagree/);
});
test("unknown case, noncanonical evidence status and omitted case fail closed",()=>{
 const base=sample();
 assert.throws(()=>parseFiveBackendActorEvidence(base.replace(
   '"callable":"unsupported"','"invented-feature":"unsupported"')),/missing or unrecognized/);
 assert.throws(()=>parseFiveBackendActorEvidence(base.replace(
   '"callable":"unsupported"','"callable":"skipped"')),/unsupported evidence state/);
 assert.throws(()=>parseFiveBackendActorEvidence(base.replace(
   '"callable":"unsupported",','')),/missing or unrecognized/);
});
test("JSON parser rejects malformed backend object and numeric states",()=>{
 const base=sample();
 assert.throws(()=>parseFiveBackendActorEvidence(base.replace(
   '"callable":"unsupported"','"callable":true')),/unsupported evidence state/);
 assert.throws(()=>parseFiveBackendActorEvidence(base.replace(
   '"callable":"unsupported"','"callable":oops')),/malformed backend JSON/);
});
test("invalid input and fake tiny log cannot be certified",()=>{
 assert.throws(()=>parseFiveBackendActorEvidence(null),/missing or oversized/);
 assert.throws(()=>parseFiveBackendActorEvidence(""),/missing or oversized/);
 assert.throws(()=>parseFiveBackendActorEvidence("z".repeat(2000001)),/missing or oversized/);
 assert.throws(()=>parseFiveBackendActorEvidence("workflow success"),/missing/);
});
test("actual failed cases remain failed, rather than reclassified as unsupported",()=>{
 const r=sample().replace('"callable":"unsupported"','"callable":"failed"')
   .replace("java {'passed': 5, 'failed': 0, 'unsupported': 8}",
     "java {'passed': 5, 'failed': 1, 'unsupported': 7}");
 const result=parseFiveBackendActorEvidence(r);
 assert.equal(result.total.failed,1);
 assert.equal(result.total.unsupported,53);
 assert.equal(result.backends.java.cases.callable,"failed");
});
