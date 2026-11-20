import test from "node:test";
import assert from "node:assert/strict";
import { beginModelRun, nextGraphGeneration, commitModelRun, compiledPlanCacheKey, ModelFenceError } from "../experiments/model_run_fence.mjs";

const A="a".repeat(64), B="b".repeat(64);
const graph=(generation=7)=>({modelTypeId:"pkg.PriceEstimate",graphDigest:A,graphGeneration:generation});
const instance=()=>({instanceId:"instance-1",modelTypeId:"pkg.PriceEstimate",graphDigest:A,graphGeneration:7,parameterVersion:3});
const request=()=>({runId:"run-1",executionProfileDigest:B});
const fails=(code,fn)=>assert.throws(fn,e=>e instanceof ModelFenceError&&e.code===code);

test("graph generation increments without wrapping",()=>{
  assert.equal(nextGraphGeneration(graph()),8);
  fails("MODEL_GRAPH_GENERATION_OVERFLOW",()=>nextGraphGeneration(graph(Number.MAX_SAFE_INTEGER)));
});

test("published run identity is single commit",()=>{
  const stamp=beginModelRun(graph(),instance(),request());
  const ledger=commitModelRun(stamp,graph(),instance(),request(),[]);
  assert.deepEqual(ledger,["run-1"]);
  assert(Object.isFrozen(ledger));
  fails("MODEL_RUN_REPLAY",()=>commitModelRun(stamp,graph(),instance(),request(),ledger));
});

test("compiled plan cache binds graph and execution profile",()=>{
  assert.notEqual(compiledPlanCacheKey(A,B),compiledPlanCacheKey(A,"c".repeat(64)));
  assert.notEqual(compiledPlanCacheKey(A,B),compiledPlanCacheKey("d".repeat(64),B));
});

test("accessor backed publication ledger is rejected without execution",()=>{
  const stamp=beginModelRun(graph(),instance(),request());
  let calls=0;
  const ledger=[];
  Object.defineProperty(ledger,"0",{enumerable:true,get(){calls++;return "run-x";}});
  ledger.length=1;
  fails("MODEL_INVALID_RUN_REQUEST",()=>commitModelRun(stamp,graph(),instance(),request(),ledger));
  assert.equal(calls,0);
});
