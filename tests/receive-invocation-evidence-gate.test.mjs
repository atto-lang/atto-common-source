import test from "node:test";
import assert from "node:assert/strict";
import {RECEIVE_STACK_BACKENDS,RECEIVE_STACK_CASES,
 evaluateReceiveStackCandidate,assertReceiveStackGuestParity}
 from "../scripts/receive-invocation-evidence-gate.mjs";
const sha=(c)=>c.repeat(40);
function specimen(state="passed"){
 const fixtureSha=sha("a"),receipt={version:1,contract:"receive-invocation-stacks-v1",
  fixtureSha,backends:{}},observed={};
 for(const [i,backend] of RECEIVE_STACK_BACKENDS.entries()){
  const sourceSha=String(i+1).repeat(40),treeSha=String(i+5).repeat(40);
  receipt.backends[backend]={sourceSha,treeSha,fixtureSha,runId:200+i,jobId:300+i,
   cases:Object.fromEntries(RECEIVE_STACK_CASES.map(c=>[c,state]))};
  observed[backend]={headSha:sourceSha,treeSha,runId:200+i,jobId:300+i,
   runnerId:800+i,executedSteps:4,conclusion:"success",event:"pull_request",
   guestExecuted:true};
 }
 return {receipt,observed};
}
test("complete five-backend candidate remains untrusted, never certified",()=>{
 const {receipt,observed}=specimen();
 const candidate=evaluateReceiveStackCandidate(receipt,observed);
 assert.equal(candidate.totals.passed,50);
 assert.equal(candidate.guestParityCertified,false);
 assert.equal(candidate.classification,"UNTRUSTED_CANDIDATE_ONLY");
 assert.throws(()=>assertReceiveStackGuestParity(receipt,observed),/independent live/);
});
test("source-free fixture matrix cannot pass from a zero-step runner",()=>{
 const {receipt,observed}=specimen();
 observed.java.executedSteps=0;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/nonzero-step/);
});
test("host-only self declaration is not guest execution",()=>{
 const {receipt,observed}=specimen();
 observed.llvm.guestExecuted=false;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/guest run/);
});
test("wrong exact head or tree is denied",()=>{
 const {receipt,observed}=specimen();
 observed.wasm.headSha=sha("e");
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/wasm/);
 observed.wasm.headSha=receipt.backends.wasm.sourceSha;
 observed.wasm.treeSha=sha("f");
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/wasm/);
});
test("swapped job and run IDs cannot attest a backend",()=>{
 const {receipt,observed}=specimen();
 observed.net.jobId=observed.llvm.jobId;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/net/);
});
test("omitted or extra cases and unknown state fail closed",()=>{
 const {receipt,observed}=specimen();
 delete receipt.backends.java.cases.receive_stack_distinct;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/case/);
 receipt.backends.java.cases.receive_stack_distinct="passed";
 receipt.backends.java.cases.unknown="passed";
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/case/);
 delete receipt.backends.java.cases.unknown;
 receipt.backends.java.cases.task_stack_distinct="skipped";
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/invalid status/);
});
test("missing backend and unknown case list cannot produce complete parity",()=>{
 const {receipt,observed}=specimen();
 delete observed.forge;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/backend/);
 observed.forge={};
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/forge/);
});
test("unsupported, failed and unexecuted remain separate from passes",()=>{
 const {receipt,observed}=specimen();
 receipt.backends.forge.cases.actor_overflow_sibling_survival="unsupported";
 receipt.backends.java.cases.one_shot_wake="failed";
 receipt.backends.net.cases.serial_suspend_slot="not_executed";
 const s=evaluateReceiveStackCandidate(receipt,observed);
 assert.deepEqual(s.totals,{passed:47,failed:1,unsupported:1,not_executed:1});
 assert.throws(()=>assertReceiveStackGuestParity(receipt,observed),/unexecuted/);
});
test("failed CI, unrecognized event and no runner ID deny even declared pass",()=>{
 const {receipt,observed}=specimen();
 observed.llvm.conclusion="failure";
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/llvm/);
 observed.llvm.conclusion="success";
 observed.llvm.event="repository_dispatch";
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/llvm/);
 observed.llvm.event="push"; observed.llvm.runnerId=0;
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/llvm/);
});
test("placeholder SHAs, missing case summary and wrong fixture SHA deny",()=>{
 const {receipt,observed}=specimen();
 receipt.backends.wasm.sourceSha="TODO";
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/wasm/);
 receipt.backends.wasm.sourceSha=observed.wasm.headSha;
 receipt.backends.wasm.fixtureSha=sha("d");
 assert.throws(()=>evaluateReceiveStackCandidate(receipt,observed),/wasm/);
});
