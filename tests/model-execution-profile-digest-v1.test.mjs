import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalExecutionProfileV1Bytes, digestExecutionProfileV1, ModelProfileDigestError } from "../experiments/model_execution_profile_digest_v1.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const vectors=JSON.parse(fs.readFileSync(path.join(here,"../contracts/v1/model-graph/execution-profile-digest-v1-vectors.json"),"utf8"));
const clone=x=>structuredClone(x);
const fails=(code,fn)=>assert.throws(fn,e=>e instanceof ModelProfileDigestError&&e.code===code);

test("portable reference execution profile matches v1 vector",()=>{
  assert.equal(canonicalExecutionProfileV1Bytes(vectors.base.profile).length,vectors.base.expectedBytes);
  assert.equal(digestExecutionProfileV1(vectors.base.profile),vectors.base.expected);
});
test("numeric mode feature and target changes alter profile identity",()=>{
  for(const m of vectors.mutations){
    const p=clone(vectors.base.profile);p[m.field]=m.value;
    assert.equal(digestExecutionProfileV1(p),m.expected,m.id);
  }
});
test("features must already be unique ASCII sorted",()=>{
  const p=clone(vectors.base.profile);p.numericFeatures=["sse4.2","fma"];
  fails("MODEL_NONCANONICAL_EXECUTION_PROFILE",()=>digestExecutionProfileV1(p));
  p.numericFeatures=["fma","fma"];
  fails("MODEL_NONCANONICAL_EXECUTION_PROFILE",()=>digestExecutionProfileV1(p));
});
test("profile metadata accessors fail closed before execution",()=>{
  let calls=0;const p=clone(vectors.base.profile);
  Object.defineProperty(p,"targetTriple",{enumerable:true,get(){calls++;return "portable";}});
  fails("MODEL_INVALID_EXECUTION_PROFILE",()=>digestExecutionProfileV1(p));
  assert.equal(calls,0);
});
