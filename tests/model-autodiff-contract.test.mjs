// Host-only executable state-machine model of the proposed transport protocol.
// This is NOT Oreslang compiler, tensor-kernel or actual actor-runtime evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const folder=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(folder,"../contracts/v1/model-autodiff");
const manifest=JSON.parse(readFileSync(path.join(root,"cases.json"),"utf8"));
class Ledger {
 constructor(edges,capacity=2){this.edges=new Set(edges);this.capacity=capacity;this.active=new Map();this.done=new Set();this.run="runA";this.graphGeneration=7;this.weightVersion=1;this.committed=false;this.cancelled=false;}
 err(code){throw new Error(code);}
 identity(e){if(e.run!==undefined&&e.run!==this.run)this.err("ML_RUN_MISMATCH");if(e.gen!==undefined&&e.gen!==this.graphGeneration)this.err("ML_GRAPH_GENERATION_MISMATCH");if(e.ver!==undefined&&e.ver!==this.weightVersion)this.err("ML_WEIGHT_VERSION_MISMATCH");}
 apply(e){
  if(e.op==="cancel"){this.cancelled=true;this.active.clear();return;}
  if(this.cancelled)this.err("ML_RUN_CANCELLED");
  this.identity(e);
  if(e.op==="forward"){
   if(this.committed)this.err("ML_STEP_ALREADY_COMMITTED");
   if(this.active.has(e.mb)||this.done.has(e.mb))this.err("ML_DUPLICATE_MICROBATCH");
   if(this.active.size>=this.capacity)this.err("ML_BACKPRESSURE");
   this.active.set(e.mb,new Set());return;
  }
  if(e.op==="backward"){
   if(!this.active.has(e.mb))this.err("ML_UNKNOWN_ACTIVATION");
   if(!this.edges.has(e.edge))this.err("ML_UNKNOWN_EDGE");
   const seen=this.active.get(e.mb);
   if(seen.has(e.edge))this.err("ML_DUPLICATE_GRADIENT");
   seen.add(e.edge);
   if(seen.size===this.edges.size){this.active.delete(e.mb);this.done.add(e.mb);}
   return;
  }
  if(e.op==="commit"){
   if(this.committed)this.err("ML_STEP_ALREADY_COMMITTED");
   if(this.active.size)this.err("ML_STEP_NOT_QUIESCENT");
   if(!this.done.size)this.err("ML_STEP_NO_GRADIENTS");
   this.committed=true;this.weightVersion+=1;return;
  }
  this.err("ML_UNKNOWN_EVENT");
 }
}
test("manifest has explicit proposal/evidence status",()=>{
 assert.equal(manifest.contract,"oreslang.model.autodiff.actor.v1");
 assert.equal(manifest.status,"PROPOSED");
 assert.equal(manifest.guest_execution,"NOT_EXECUTED");
 assert.equal(manifest.reference_tests,"HOST_ONLY");
});
test("every source case points to a real proposed fixture with phase-correct diagnostics",()=>{
 const ids=new Set();
 for(const item of manifest.source_cases){
  assert(!ids.has(item.id),item.id);ids.add(item.id);
  assert.equal(item.guest_execution,"NOT_EXECUTED");
  assert(["accept","reject"].includes(item.expect));
  assert.equal(item.diagnostic_class===null,item.expect==="accept");
  assert(/^fixtures\/[a-z_]+\.ores$/.test(item.fixture),item.id);
  const file=path.join(root,item.fixture);
  assert(existsSync(file),file);
  const source=readFileSync(file,"utf8");
  assert(source.includes("define model"),item.id);
  if(item.diagnostic_class)assert(source.includes(item.diagnostic_class),item.id);
  if(item.id==="non-differentiable-op"){
   assert.equal(item.expect,"accept");
   assert.equal(item.diagnostic_class,null);
   assert.match(item.note,/gradient-admission/);
  }
 }
 assert(manifest.source_cases.length>=8);
});
for(const scenario of manifest.runtime_cases){
 test("actor autograd envelope: "+scenario.id,()=>{
  assert.equal(scenario.guest_execution,"NOT_EXECUTED");
  const ledger=new Ledger(scenario.edges,scenario.capacity);
  let actual="accept",error=null;
  try{for(const event of scenario.events)ledger.apply(event);}
  catch(e){actual="reject";error=e.message;}
  assert.equal(actual,scenario.expect);
  assert.equal(error,scenario.diagnostic_class??null);
 });
}
