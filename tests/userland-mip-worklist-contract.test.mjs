// HOST-ONLY control-plane model for a proposed USERLAND MIP worklist.
// This does not implement simplex, LP certification, or an Oreslang guest solver.
import test from "node:test";
import assert from "node:assert/strict";

function fail(code){throw Error(code);}
function finite(n){if(typeof n!=="number"||!Number.isFinite(n))fail("MIP_NONFINITE");}
const problem=Object.freeze({
  sense:"min", variables:Object.freeze([
    Object.freeze({id:"x",kind:"binary",lower:0,upper:1}),
    Object.freeze({id:"y",kind:"integer",lower:0,upper:3})]),
  objective:Object.freeze([3,1]),
  constraints:Object.freeze([{coeff:[2,1],relation:">=",rhs:3}])
});
function validatedObjective(problem,candidate,tol=1e-9){
  if(!Array.isArray(candidate)||candidate.length!==problem.variables.length)
    fail("MIP_BAD_CANDIDATE");
  for(let i=0;i<candidate.length;i++){
    const v=problem.variables[i], x=candidate[i]; finite(x);
    if(x<v.lower-tol||x>v.upper+tol)fail("MIP_VARIABLE_BOUND");
    if(v.kind==="binary"||v.kind==="integer"){
      if(Math.abs(x-Math.round(x))>tol)fail("MIP_NOT_INTEGRAL");
      if(v.kind==="binary" && ![0,1].includes(Math.round(x)))fail("MIP_NOT_BINARY");
    }
  }
  const normalized=candidate.map((x,i)=>problem.variables[i].kind==="continuous"?x:Math.round(x));
  for(const c of problem.constraints){
    const lhs=c.coeff.reduce((sum,coeff,i)=>sum+coeff*normalized[i],0);
    finite(lhs);
    if(c.relation==="<=" && lhs>c.rhs+tol)fail("MIP_INFEASIBLE");
    if(c.relation===">=" && lhs<c.rhs-tol)fail("MIP_INFEASIBLE");
    if(c.relation==="=" && Math.abs(lhs-c.rhs)>tol)fail("MIP_INFEASIBLE");
  }
  const score=problem.objective.reduce((sum,coeff,i)=>sum+coeff*normalized[i],0);
  finite(score);return score;
}
// The authority is a *host stub* for a trusted LP verifier. Its issuance is
// an assumption, NOT mathematical proof that the bound is valid.
class RelaxationAuthority{
  #proofs=new WeakMap();
  issue(node,epoch,bound,sense){
    finite(bound);
    const cert=Object.freeze({node,epoch,bound,sense});
    this.#proofs.set(cert,true);
    return cert;
  }
  verified(cert,node,epoch,sense){
    if(!cert||!this.#proofs.has(cert)||cert.node!==node||
       cert.epoch!==epoch||cert.sense!==sense)fail("MIP_UNVERIFIED_BOUND");
    return cert.bound;
  }
}
class MipWorklist{
  constructor({p=problem,authority=new RelaxationAuthority(),maxNodes=8}={}){
    if(!Number.isSafeInteger(maxNodes)||maxNodes<1)fail("MIP_BAD_QUOTA");
    if(!p||!["min","max"].includes(p.sense))fail("MIP_INVALID_SENSE");
    this.state={p,authority,epoch:1,queue:["root"],inflight:new Map(),
      outbox:new Map(),seen:new Set(["root"]),done:new Set(),
      incumbent:null,maxNodes,closed:false};
    this._runtimeGateHeld=false; // infrastructure only, not actor state
  }
  critical(f){
    if(this._runtimeGateHeld)fail("MIP_STATE_REENTRANT");
    this._runtimeGateHeld=true;
    try{
      const r=f(this.state);
      if(r&&typeof r.then==="function")fail("MIP_STATE_SUSPENDS");
      if(r===this.state)fail("MIP_STATE_ESCAPE");
      return r;
    } finally {this._runtimeGateHeld=false;}
  }
  claim(worker){
    return this.critical(s=>{
      if(s.closed)fail("MIP_RETIRED");
      if(!s.queue.length)fail("MIP_NO_WORK");
      const node=s.queue.shift();
      const token=Symbol("claim");
      s.inflight.set(node,{token,worker,epoch:s.epoch});
      return Object.freeze({node,token,epoch:s.epoch});
    });
  }
  finish(claim,{candidate=null,bound=null,children=[]}={}){
    return this.critical(s=>{
      if(s.closed)fail("MIP_RETIRED");
      const cur=s.inflight.get(claim.node);
      if(!cur||cur.token!==claim.token||cur.epoch!==claim.epoch||cur.epoch!==s.epoch)
        fail("MIP_STALE_OR_DUPLICATE_CLAIM");
      if(!Array.isArray(children))fail("MIP_BAD_CHILDREN");
      if(children.length>2||children.some(n=>typeof n!=="string"||!/^node[0-9]+$/.test(n)))
        fail("MIP_BAD_CHILDREN");
      if(new Set(children).size!==children.length||children.some(n=>s.seen.has(n)))
        fail("MIP_DUPLICATE_CHILD");
      if(s.seen.size+children.length>s.maxNodes)fail("MIP_NODE_QUOTA");
      const score=candidate===null?null:validatedObjective(s.p,candidate);
      const validBound=bound===null?null:s.authority.verified(bound,claim.node,s.epoch,s.p.sense);
      const incumbent=s.incumbent;
      const better=score!==null && (incumbent===null||
        (s.p.sense==="min"?score<incumbent.score:score>incumbent.score));
      // A valid primal solution in this node cannot improve beyond a
      // trusted mathematically valid dual bound; contradiction is fatal.
      if(score!==null && validBound!==null &&
        (s.p.sense==="min"?validBound>score+1e-9:validBound<score-1e-9))
        fail("MIP_INCONSISTENT_CERTIFICATE");
      const best=better?{score,candidate:Object.freeze([...candidate])}:incumbent;
      const canPrune=validBound!==null&&best!==null&&
        (s.p.sense==="min"?validBound>=best.score-1e-9:validBound<=best.score+1e-9);
      if(canPrune&&children.length)fail("MIP_PRUNED_NODE_HAS_CHILDREN");
      // Atomic transition; do not publish children before checking ALL fields.
      s.inflight.delete(claim.node);s.done.add(claim.node);s.incumbent=best;
      for(const node of children){
        s.seen.add(node);
        const receipt=Symbol("child-delivery");
        s.outbox.set(node,{parent:claim.node,receipt,epoch:s.epoch});
      }
      return Object.freeze({status:canPrune?"pruned":"processed",
        childReceipts:children.map(node=>Object.freeze({node,token:s.outbox.get(node).receipt,epoch:s.epoch})),
        incumbent:best?best.score:null});
    });
  }
  ackChild(receipt){
    return this.critical(s=>{
      if(s.closed)fail("MIP_RETIRED");
      const job=s.outbox.get(receipt.node);
      if(!job||job.receipt!==receipt.token||job.epoch!==receipt.epoch||job.epoch!==s.epoch)
        fail("MIP_INVALID_CHILD_ACK");
      s.outbox.delete(receipt.node);s.queue.push(receipt.node);
      return true;
    });
  }
  quiescent(){
    return this.critical(s=>!s.closed&&!s.queue.length&&!s.inflight.size&&!s.outbox.size);
  }
  status(){return this.critical(s=>Object.freeze({queued:s.queue.length,
    inflight:s.inflight.size,outbox:s.outbox.size,
    incumbent:s.incumbent?.score??null,done:s.done.size}));}
  retire(){return this.critical(s=>{if(s.closed)return false;s.closed=true;s.epoch++;
    s.queue=[];s.inflight.clear();s.outbox.clear();return true;});}
}
test("feasible mixed-binary/integer incumbent verified against original constraints",()=>{
  const w=new MipWorklist(),c=w.claim("worker");
  assert.throws(()=>w.finish(c,{candidate:[0,2]}),/MIP_INFEASIBLE/);
  assert.throws(()=>w.finish(c,{candidate:[0.1,3]}),/MIP_NOT_INTEGRAL/);
  assert.throws(()=>w.finish(c,{candidate:[0,4]}),/MIP_VARIABLE_BOUND/);
  assert.equal(w.status().inflight,1);
  assert.equal(w.finish(c,{candidate:[0,3]}).incumbent,3);
  assert.equal(w.quiescent(),true);
});
test("unknown or forged LP bound cannot prune despite numeric plausibility",()=>{
  const oracle=new RelaxationAuthority(),w=new MipWorklist({authority:oracle});
  const c=w.claim("w");
  assert.throws(()=>w.finish(c,{bound:{node:"root",epoch:1,bound:6,sense:"min"}}),
    /MIP_UNVERIFIED_BOUND/);
  const forged=oracle.issue("other",1,6,"min");
  assert.throws(()=>w.finish(c,{bound:forged}),/MIP_UNVERIFIED_BOUND/);
  assert.equal(w.status().inflight,1);
  w.finish(c,{candidate:[0,3]});
});
test("a verified lower bound prunes minimization only after feasible incumbent exists",()=>{
  const oracle=new RelaxationAuthority(),w=new MipWorklist({authority:oracle});
  const c=w.claim("w");
  assert.equal(w.finish(c,{bound:oracle.issue("root",1,4,"min")}).status,"processed");
  assert.equal(w.quiescent(),true); // no more work, but no proof of optimum
  assert.equal(w.status().incumbent,null);
});
test("published child stays in outbox until ACK; queue-empty is not quiescence",()=>{
  const w=new MipWorklist(),c=w.claim("w");
  const r=w.finish(c,{children:["node1"]});
  assert.equal(w.quiescent(),false);
  assert.deepEqual(w.status(),{queued:0,inflight:0,outbox:1,incumbent:null,done:1});
  const child=r.childReceipts[0];
  assert.throws(()=>w.ackChild({...child,token:Symbol("forged")}),/MIP_INVALID_CHILD_ACK/);
  assert.equal(w.ackChild(child),true);
  assert.equal(w.quiescent(),false);
  assert.throws(()=>w.ackChild(child),/MIP_INVALID_CHILD_ACK/);
  const next=w.claim("w2");w.finish(next,{candidate:[0,3]});
  assert.equal(w.quiescent(),true);
  assert.equal(w.status().incumbent,3);
});
test("duplicate child and capacity failures are atomic",()=>{
  const w=new MipWorklist({maxNodes:2}),c=w.claim("w");
  assert.throws(()=>w.finish(c,{children:["node1","node1"]}),/MIP_DUPLICATE_CHILD/);
  assert.throws(()=>w.finish(c,{children:["node1","node2"]}),/MIP_NODE_QUOTA/);
  assert.deepEqual(w.status(),{queued:0,inflight:1,outbox:0,incumbent:null,done:0});
  const a=w.finish(c,{children:["node1"]});
  assert.equal(a.childReceipts.length,1);
});
test("retirement fences late completions; exactly one claim completion",()=>{
  const w=new MipWorklist(),c=w.claim("w");w.finish(c,{candidate:[0,3]});
  assert.throws(()=>w.finish(c,{candidate:[1,1]}),/MIP_STALE_OR_DUPLICATE_CLAIM/);
  assert.equal(w.retire(),true);
  assert.equal(w.retire(),false);
  assert.throws(()=>w.claim("w"),/MIP_RETIRED/);
});
test("certificate contradiction rejected before incumbent or completion mutation",()=>{
  const oracle=new RelaxationAuthority(),w=new MipWorklist({authority:oracle});
  const c=w.claim("w");
  assert.throws(()=>w.finish(c,{candidate:[0,3],bound:oracle.issue("root",1,4,"min")}),
    /MIP_INCONSISTENT_CERTIFICATE/);
  assert.equal(w.status().incumbent,null);
  assert.equal(w.status().inflight,1);
});
test("the worklist contains guest state solely in state and rejects loan escape",()=>{
  const w=new MipWorklist();
  assert.deepEqual(Object.keys(w).sort(),["_runtimeGateHeld","state"]);
  assert.throws(()=>w.critical(s=>s),/MIP_STATE_ESCAPE/);
  assert.throws(()=>w.critical(()=>w.critical(()=>1)),/MIP_STATE_REENTRANT/);
  assert.throws(()=>w.critical(()=>Promise.resolve(2)),/MIP_STATE_SUSPENDS/);
});


test("integer candidate is normalized before checking original inequalities",()=>{
  const w=new MipWorklist(),c=w.claim("w");
  // x is only approximately binary; rounded x=0 makes 2*x+y=2 infeasible.
  assert.throws(()=>w.finish(c,{candidate:[0.0000000001,2]}),/MIP_INFEASIBLE/);
  w.finish(c,{candidate:[0,3]});
  assert.equal(w.status().incumbent,3);
});
test("invalid objective sense fails closed instead of reversing comparison",()=>{
  assert.throws(()=>new MipWorklist({p:{...problem,sense:"?"}}),/MIP_INVALID_SENSE/);
});
