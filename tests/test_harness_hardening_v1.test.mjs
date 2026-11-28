import test from "node:test";
import assert from "node:assert/strict";
import {suite,test_case,fixture,using,plan,run_suite,case_seed,case_context} from "../reference/test_harness_v1.mjs";
import {strategy_int,property_case} from "../reference/test_property_v1.mjs";
import {report_jsonl} from "../reference/test_reporters_v1.mjs";

test("forged descriptors cannot execute arbitrary getters during discovery",()=>{
  const malicious={get kind(){throw Error("executed unsafe getter")},name:"bad"};
  assert.throws(()=>plan(suite("root",[malicious])),/unregistered test descriptor/);
});
test("test discovery is bounded by a strict nesting budget",()=>{
  let root=test_case("leaf",()=>true);
  for(let i=0;i<80;i++) root=suite("layer", [root]);
  assert.throws(()=>plan(root),/depth budget/);
});
test("max name budget rejects hostile cases at creation",()=>{
  assert.throws(()=>test_case("x".repeat(257),()=>true),/invalid case/);
});
test("invalid test result cannot pass silently",async()=>{
  const r=await run_suite(suite("invalid",[
    test_case("zero",()=>0),
    test_case("null",()=>null),
    test_case("string",()=>"success"),
    test_case("bad object",()=>({passed:"yes"}))
  ]));
  assert.equal(r.summary.failed,4);
  assert.ok(r.events.every(e=>e.issues[0].phase==="body"));
});
test("both body and cleanup errors survive as distinct JSONL issues",async()=>{
  const t=suite("scope",[using(fixture(()=>({state:"open"}),()=>{throw Error("close failure")}),[
    test_case("both",()=>{throw Error("body failure")})
  ])]);
  const r=await run_suite(t);
  assert.equal(r.summary.failed,1);
  assert.deepEqual(r.events[0].issues.map(x=>x.phase),["body","release"]);
  assert.match(r.events[0].detail,/body failure/);
  assert.match(r.events[0].detail,/close failure/);
  const event=JSON.parse(report_jsonl(r).trim().split("\n")[0]);
  assert.deepEqual(event.issues.map(x=>x.phase),["body","release"]);
});
test("acquisition failure is preserved separately from failed prior release",async()=>{
  let body=0;
  const s=suite("root",[
    using(fixture(()=>1,()=>{throw Error("release primary resource")}),[
      using(fixture(()=>{throw Error("acquire failure")},()=>{}),[
        test_case("leaf",()=>{body++})
      ])
    ])
  ]);
  const r=await run_suite(s);
  assert.equal(body,0);
  assert.deepEqual(r.events[0].issues.map(x=>x.phase),["acquire","release"]);
});
test("UTF-8 seed mapping has byte stable goldens independent of JS UTF-16 code units",()=>{
  assert.equal(case_seed(42,"suite/a"),2231590945);
  assert.equal(case_seed(42,"suite/é"),247450422);
  assert.equal(case_seed(42,"suite/🐢"),3059950657);
  assert.throws(()=>case_seed(4294967296,"x"),/invalid seed/);
});
test("random bounds cover full 32-bit span with deterministic replay",()=>{
  const a=case_context(42,"suite/🐢"),b=case_context(42,"suite/🐢");
  for(let i=0;i<50;i++) assert.equal(a.random_int(0,4294967295),b.random_int(0,4294967295));
});
test("unstable property cannot shrink to a false counterexample",async()=>{
  let n=0;
  const p=property_case("flaky",{draw:()=>97,shrink:strategy_int(0,100).shrink},()=>++n>1,{runs:1});
  const r=await run_suite(suite("p",[p]));
  assert.equal(r.summary.failed,1);
  assert.match(r.events[0].detail,/nonreproducible property failure/);
  assert.ok(r.events[0].detail.includes('original=97'));
});
test("mutating a shrinking strategy does not alter saved original witness",async()=>{
  const shrink=value=>{ value.n=0; return [{n:1}]; };
  const p=property_case("mutable_shrinker",{draw:()=>({n:42}),shrink},()=>false,{runs:1,max_shrinks:1});
  const r=await run_suite(suite("p",[p]));
  assert.equal(r.summary.failed,1);
  assert.ok(r.events[0].detail.includes('original={"n":42}'));
});
test("property must reject fixture before acquire and without side effects",async()=>{
  let acquisitions=0;
  const root=suite("root",[using(fixture(()=>{acquisitions++;return 1},()=>{}),[
    property_case("pure",strategy_int(0,10),()=>true)
  ])]);
  await assert.rejects(run_suite(root),/property fixture requires per-attempt acquisition/);
  assert.equal(acquisitions,0);
});
test("metadata does not permit untrusted keys and reporter receipt mismatch",()=>{
  const run={events:[],summary:{total:0,passed:0,failed:0,skipped:0,filtered:0}};
  assert.throws(()=>report_jsonl(run,{"Bad-Key":"x"}),/unsafe metadata/);
  assert.throws(()=>report_jsonl({events:[{status:"FAIL",name:"a",detail:"bad",issues:[{phase:"body",detail:"other"}]}],summary:{total:1,passed:0,failed:1,skipped:0,filtered:0}}),/structured issues differ/);
});

test("property shrinking accepts candidate-dependent assertion diagnostics",async()=>{
  const g={draw:()=>97,shrink:strategy_int(0,100).shrink};
  const p=property_case("varying_message",g,(ctx,x)=>ctx.expect_equal(x,0),{runs:1,max_shrinks:100});
  const r=await run_suite(suite("p",[p]));
  assert.equal(r.summary.failed,1);
  assert.ok(r.events[0].detail.includes("minimal=1"),r.events[0].detail);
});

test("host equality does not mistake JS object identity for Atto value equality",async()=>{
  const obj={value:1};
  const r=await run_suite(suite("p",[test_case("objects",ctx=>ctx.expect_equal(obj,obj))]));
  assert.equal(r.summary.failed,1);
  assert.match(r.events[0].detail,/primitive values only/);
});
