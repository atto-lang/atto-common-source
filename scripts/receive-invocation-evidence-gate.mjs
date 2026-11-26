/**
 * Source-free receipt consistency gate for receive-invocation stack parity.
 * NEVER authenticates GitHub provider data or certifies actual guest execution.
 * Live independent run/job/step and fixture-blob verification is mandatory.
 */
export const RECEIVE_STACK_BACKENDS=Object.freeze(["java","llvm","wasm","forge","net"]);
export const RECEIVE_STACK_CASES=Object.freeze([
  "receive_stack_distinct","task_stack_distinct","serial_suspend_slot",
  "concurrent_receive_disjoint","nested_frame_resume","one_shot_wake",
  "aggregate_stack_budget","physical_cleanup_before_restart",
  "critical_borrow_no_escape","actor_overflow_sibling_survival"
]);
const OID=/^[a-f0-9]{40}$/;
const STATES=new Set(["passed","failed","unsupported","not_executed"]);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const exact=(obj,keys)=>obj!==null && typeof obj==="object" &&
  !Array.isArray(obj) && Object.keys(obj).length===keys.length &&
  keys.every(k=>own(obj,k));
const positive=n=>Number.isSafeInteger(n)&&n>0;
const fail=s=>{throw Error("RECEIVE_STACK_NOT_ATTESTED: "+s);};

export function evaluateReceiveStackCandidate(receipt, observed) {
  if(!exact(receipt,["version","contract","fixtureSha","backends"]) ||
     receipt.version!==1 || receipt.contract!=="receive-invocation-stacks-v1" ||
     !OID.test(receipt.fixtureSha) ||
     !exact(receipt.backends,RECEIVE_STACK_BACKENDS) ||
     !exact(observed,RECEIVE_STACK_BACKENDS)) fail("missing canonical contract or backend");
  const totals={passed:0,failed:0,unsupported:0,not_executed:0};
  const details=Object.create(null);
  for(const backend of RECEIVE_STACK_BACKENDS){
    const r=receipt.backends[backend],p=observed[backend];
    if(!exact(r,["sourceSha","treeSha","fixtureSha","runId","jobId","cases"]) ||
       !OID.test(r.sourceSha)||!OID.test(r.treeSha) ||
       r.fixtureSha!==receipt.fixtureSha ||
       !positive(r.runId)||!positive(r.jobId)||
       !exact(r.cases,RECEIVE_STACK_CASES))
      fail(backend+" missing exact-head receipt or case");
    if(!exact(p,["headSha","treeSha","runId","jobId","runnerId",
                 "executedSteps","conclusion","event","guestExecuted"]) ||
       p.headSha!==r.sourceSha || p.treeSha!==r.treeSha ||
       p.runId!==r.runId || p.jobId!==r.jobId ||
       !positive(p.runnerId)||!positive(p.executedSteps)||
       p.conclusion!=="success"||
       !["pull_request","push","workflow_dispatch"].includes(p.event)||
       p.guestExecuted!==true)
      fail(backend+" lacks independently checked nonzero-step guest run");
    const statuses=Object.create(null);
    for(const id of RECEIVE_STACK_CASES){
      const state=r.cases[id];
      if(typeof state!=="string"||!STATES.has(state))
        fail(backend+" invalid status "+id);
      statuses[id]=state;totals[state]++;
    }
    details[backend]={cases:statuses};
  }
  const expected=RECEIVE_STACK_BACKENDS.length*RECEIVE_STACK_CASES.length;
  if(Object.values(totals).reduce((sum,n)=>sum+n,0)!==expected)
    fail("truncated receive stack evidence matrix");
  return Object.freeze({
    classification:"UNTRUSTED_CANDIDATE_ONLY",
    contract:receipt.contract,fixtureSha:receipt.fixtureSha,
    totals,backends:details,
    independentLiveGitHubAuthenticationRequired:true,
    guestParityCertified:false
  });
}

export function assertReceiveStackGuestParity(receipt,observed) {
  const candidate=evaluateReceiveStackCandidate(receipt,observed);
  if(candidate.totals.passed!==RECEIVE_STACK_BACKENDS.length*RECEIVE_STACK_CASES.length ||
     candidate.totals.failed!==0||candidate.totals.unsupported!==0||
     candidate.totals.not_executed!==0)
    fail("unexecuted, unsupported or failed guest case");
  // A JSON object and caller-supplied provider observation cannot prove a
  // real Actions job, checkout provenance, compiled guest or exact fixture bytes.
  fail("independent live GitHub and guest-output authentication required");
}
