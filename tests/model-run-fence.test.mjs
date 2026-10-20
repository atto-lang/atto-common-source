import test from "node:test";
import assert from "node:assert/strict";
import { beginModelRun, validateModelRunStamp, nextParameterVersion, nextGraphGeneration, commitModelRun, ModelFenceError } from "../experiments/model_run_fence.mjs";

const A="a".repeat(64), B="b".repeat(64), C="c".repeat(64);
const graph=(patch={})=>({modelTypeId:"pkg.PriceEstimate",graphDigest:A,graphGeneration:7,...patch});
const instance=(patch={})=>({instanceId:"instance-1",modelTypeId:"pkg.PriceEstimate",graphDigest:A,graphGeneration:7,parameterVersion:3,...patch});
const request=(patch={})=>({runId:"run-1",executionProfileDigest:B,...patch});
const err=(code,fn)=>assert.throws(fn,e=>e instanceof ModelFenceError&&e.code===code);

test("run stamp pins graph, instance, parameter and execution profile",()=>{
  const s=beginModelRun(graph(),instance(),request());
  assert(Object.isFrozen(s));
  assert.deepEqual(s,{runId:"run-1",modelTypeId:"pkg.PriceEstimate",graphDigest:A,graphGeneration:7,instanceId:"instance-1",parameterVersion:3,executionProfileDigest:B});
  assert.equal(validateModelRunStamp(s,graph(),instance(),request()),true);
});
test("same nominal type cannot cross graph content or generation",()=>{
  const s=beginModelRun(graph(),instance(),request());
  err("MODEL_INSTANCE_GRAPH_MISMATCH",()=>validateModelRunStamp(s,graph({graphDigest:C}),instance({graphDigest:C}),request()));
  err("MODEL_GRAPH_GENERATION_MISMATCH",()=>validateModelRunStamp(s,graph({graphGeneration:8}),instance({graphGeneration:8}),request()));
});
test("run cannot cross instance or parameter snapshot",()=>{
  const s=beginModelRun(graph(),instance(),request());
  err("MODEL_INSTANCE_ID_MISMATCH",()=>validateModelRunStamp(s,graph(),instance({instanceId:"instance-2"}),request()));
  err("MODEL_PARAMETER_VERSION_MISMATCH",()=>validateModelRunStamp(s,graph(),instance({parameterVersion:4}),request()));
});
test("run and execution profile are part of the fence",()=>{
  const s=beginModelRun(graph(),instance(),request());
  err("MODEL_RUN_MISMATCH",()=>validateModelRunStamp(s,graph(),instance(),request({runId:"run-2"})));
  err("MODEL_EXECUTION_PROFILE_MISMATCH",()=>validateModelRunStamp(s,graph(),instance(),request({executionProfileDigest:C})));
});
test("instance must be bound to exact graph before a run starts",()=>{
  err("MODEL_INSTANCE_TYPE_MISMATCH",()=>beginModelRun(graph(),instance({modelTypeId:"pkg.Other"}),request()));
  err("MODEL_INSTANCE_GRAPH_MISMATCH",()=>beginModelRun(graph(),instance({graphDigest:C}),request()));
  err("MODEL_GRAPH_GENERATION_MISMATCH",()=>beginModelRun(graph(),instance({graphGeneration:8}),request()));
});
test("stateful commit advances exactly one checked version",()=>{
  const s=beginModelRun(graph(),instance(),request());
  assert.equal(nextParameterVersion(s,graph(),instance(),request()),4);
});
test("stateless models are valid runs but cannot publish parameters",()=>{
  const i=instance({parameterVersion:null});
  const s=beginModelRun(graph(),i,request());
  assert.equal(s.parameterVersion,null);
  err("MODEL_STATELESS_INSTANCE",()=>nextParameterVersion(s,graph(),i,request()));
});
test("parameter versions never wrap",()=>{
  const i=instance({parameterVersion:Number.MAX_SAFE_INTEGER});
  const s=beginModelRun(graph(),i,request());
  err("MODEL_PARAMETER_VERSION_OVERFLOW",()=>nextParameterVersion(s,graph(),i,request()));
});
test("malformed digests and unsafe versions fail closed",()=>{
  err("MODEL_INVALID_GRAPH_DIGEST",()=>beginModelRun(graph({graphDigest:"not-a-digest"}),instance(),request()));
  err("MODEL_INVALID_GRAPH_GENERATION",()=>beginModelRun(graph({graphGeneration:-1}),instance({graphGeneration:-1}),request()));
  err("MODEL_INVALID_PARAMETER_VERSION",()=>beginModelRun(graph(),instance({parameterVersion:1.5}),request()));
});
test("accessor metadata is rejected without execution",()=>{
  let calls=0;
  const g=graph();
  Object.defineProperty(g,"graphDigest",{enumerable:true,get(){calls++;return A;}});
  err("MODEL_INVALID_GRAPH_IDENTITY",()=>beginModelRun(g,instance(),request()));
  assert.equal(calls,0);
});
