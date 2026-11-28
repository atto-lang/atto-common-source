import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  CriticalAdmissionModel, NonreentrantActorTurnModel, checkCriticalEffectSummary
} from "../models/critical-suspends-actor-turn-v1.mjs";

const m = JSON.parse(readFileSync(
  new URL("../contracts/v1/critical-suspends-actor-turn-v1.json", import.meta.url), "utf8"
));
const byId = Object.fromEntries(m.cases.map(c => [c.id,c]));

test("draft manifest explicitly denies guest/parity certification for all five targets", () => {
  assert.equal(m.schema,"oreslang.critical-suspends-actor-turn/1");
  assert.equal(m.status,"DRAFT_NOT_EXECUTED");
  assert.equal(m.authority,"review_pending");
  assert.equal(m.diagnosticsAreProposed,true);
  assert.deepEqual(Object.keys(m.backendStatus).sort(),["cranelift","java-graal","llvm","net","wasm"]);
  assert.ok(Object.values(m.backendStatus).every(s => s==="PENDING_GUEST_PROOF"));
  assert.equal(m.evidence.zeroStepCountsAsEvidence,false);
  assert.equal(m.evidence.hostSourceContractAloneSufficient,false);
  assert.equal(m.evidence.requiresNativeBackendExecution,true);
  assert.equal(m.evidence.unrelatedFailureCountsAsRejectedCase,false);
});

test("all 36 vectors have unique closed expectations and nonempty payloads", () => {
  assert.equal(m.cases.length,36);
  assert.equal(new Set(m.cases.map(c => c.id)).size,36);
  assert.equal(m.cases.filter(c => c.kind==="compiler").length,20);
  assert.equal(m.cases.filter(c => c.kind==="runtime").length,16);
  for (const c of m.cases) {
    assert.match(c.id,/^[a-z][a-z0-9-]+$/);
    if (c.kind==="compiler") {
      assert.ok(["accept","reject"].includes(c.expected),c.id);
      assert.equal(typeof c.source,"string");
      assert.ok(c.source.trim().length>10,c.id);
      if (c.expected==="reject") assert.match(c.diagnostic,/^E_[A-Z_]+$/,c.id);
      else assert.equal(c.diagnostic,null,c.id);
    } else {
      assert.equal(c.kind,"runtime");
      assert.equal(c.expected,"observe");
      assert.ok(c.oracle?.length>10,c.id);
      assert.equal(c.source,undefined);
    }
  }
});

test("modifier decisions are distinct from legacy async task expressions", () => {
  for (const id of ["reject-critical-suspends","reject-suspends-critical","reject-async-function-modifier"]) {
    assert.equal(byId[id].expected,"reject");
    assert.equal(byId[id].diagnostic,"E_CALLABLE_MODIFIERS");
  }
  assert.match(byId["reject-critical-suspends"].source,/critical suspends fnc/);
  assert.match(byId["reject-suspends-critical"].source,/suspends critical fnc/);
  assert.match(byId["reject-async-function-modifier"].source,/async fnc/);
  assert.equal(byId["suspends-fnc"].expected,"accept");
  assert.equal(byId["actor-critical-method"].expected,"accept");
});

test("potentially waiting guard needs suspends, try-only entry does not", () => {
  assert.equal(byId["suspends-critical-block"].expected,"accept");
  assert.equal(byId["reject-sync-critical-block"].diagnostic,"E_SUSPENDS_REQUIRED");
  assert.equal(byId["try-critical-in-sync"].expected,"accept");
  assert.match(byId["try-critical-in-sync"].source,/try critical/);
});

test("critical effect violations classify by intended diagnostic, not parser failure", () => {
  for (const id of ["reject-await-in-critical","reject-indirect-suspends","reject-effectful-callback"]) {
    assert.equal(byId[id].diagnostic,"E_CRITICAL_SUSPENSION");
  }
  assert.equal(byId["reject-blocking-ffi"].diagnostic,"E_CRITICAL_BLOCKING");
  assert.equal(byId["reject-untrusted-call"].diagnostic,"E_EFFECT_UNKNOWN");
  assert.equal(byId["reject-unsafe-recursive-acquire"].diagnostic,"E_CRITICAL_NESTED");
});

test("unguarded and cross-actor synchronous calls reject without inventing a lock", () => {
  for (const id of ["reject-unguarded-plain-critical","reject-unguarded-critical-fnc"])
    assert.equal(byId[id].diagnostic,"E_CRITICAL_OWNER");
  assert.equal(byId["reject-direct-actor-call"].diagnostic,"E_ACTOR_ADMISSION");
});

test("Future extraction remains exactly one awaitable layer", () => {
  const fixture=byId["nested-future-explicit-await"];
  assert.equal(fixture.expected,"accept");
  assert.match(fixture.source,/Future<Future<int>>/);
  assert.match(fixture.source,/Future<int> inner = await outer/);
  assert.match(fixture.source,/return await inner/);
  assert.equal(byId["reject-sync-calls-suspends"].diagnostic,"E_SUSPENDS_REQUIRED");
});

test("uncontended admission is immediate and never parks a carrier", () => {
  const q=new CriticalAdmissionModel();
  const a=q.acquire("a",1);
  assert.equal(a.status,"held");
  assert.deepEqual(q.snapshot(),{generation:1,current:a.sequence,pending:[],carriersBlocked:0});
});

test("contended FIFO admission never barges", () => {
  const q=new CriticalAdmissionModel();
  const a=q.acquire("a",1),b=q.acquire("b",1),c=q.acquire("c",1);
  assert.deepEqual([a.status,b.status,c.status],["held","queued","queued"]);
  q.release(a);
  assert.equal(b.status,"held");
  assert.equal(c.status,"queued");
  q.release(b);
  assert.equal(c.status,"held");
  assert.equal(q.snapshot().carriersBlocked,0);
});

test("try critical fails immediately without enqueue, including contention", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("owner",1);
  const b=q.acquire("attempt",1,{tryOnly:true});
  assert.deepEqual(b,{status:"busy"});
  assert.deepEqual(q.snapshot().pending,[]);
  q.release(a);
  assert.equal(q.acquire("attempt",1,{tryOnly:true}).status,"held");
});

test("cancelled queued admission cannot run or consume another ticket", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("owner",1);
  const b=q.acquire("cancelled",1),c=q.acquire("next",1);
  assert.equal(q.cancel(b),true);
  q.release(a);
  assert.equal(b.status,"cancelled");
  assert.equal(c.status,"held");
  assert.throws(()=>q.release(b),/INVALID_RELEASE/);
});

test("cancellation racing a granted guard does not steal physical ownership", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("owner",1),b=q.acquire("next",1);
  assert.equal(q.cancel(a),false);
  assert.equal(a.cancellationRequested,true);
  assert.equal(b.status,"queued");
  q.release(a);
  assert.equal(b.status,"held");
});

test("trap releases the guard once; release is not transactional rollback", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("owner",1),b=q.acquire("next",1);
  q.release(a,{trapped:true});
  assert.equal(a.status,"released-after-trap");
  assert.equal(b.status,"held");
  assert.throws(()=>q.release(a,{trapped:true}),/INVALID_RELEASE/);
});

test("expired queued ticket never acquires, even if it was FIFO head", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("owner",1);
  const b=q.acquire("deadline",1),c=q.acquire("next",1);
  q.expire(10,seq=>seq===b.sequence?9:null);
  q.release(a);
  assert.equal(b.status,"expired");
  assert.equal(c.status,"held");
  assert.equal(q.acquire("late",1,{deadlineMs:10,nowMs:10}).status,"expired");
});

test("retirement invalidates old queued tickets and fences subsequent generations", () => {
  const q=new CriticalAdmissionModel(3),a=q.acquire("old",3),b=q.acquire("old-wait",3);
  q.retire(4);
  assert.equal(b.status,"retired");
  assert.throws(()=>q.acquire("stale",3),/STALE_GENERATION/);
  const fresh=q.acquire("fresh",4);
  assert.equal(fresh.status,"queued");
  q.release(a);
  assert.equal(fresh.status,"held");
});

test("a suspended actor turn retains logical exclusivity without a carrier", () => {
  const a=new NonreentrantActorTurnModel(1);
  assert.equal(a.enter("handler1",1),"running");
  a.suspend("handler1");
  assert.equal(a.enter("handler2",1),"queued");
  assert.equal(a.turn.status,"suspended");
  a.resume("handler1",1);
  a.finish("handler1");
  assert.equal(a.turn.task,"handler2");
});

test("supervisor CONTROL may request STOP but not invoke another DATA handler", () => {
  const a=new NonreentrantActorTurnModel(1);
  a.enter("handler1",1);
  a.suspend("handler1");
  a.controlStop();
  assert.equal(a.controlCount,1);
  assert.equal(a.turn.task,"handler1");
  assert.equal(a.turn.status,"suspended");
  assert.equal(a.enter("handler2",1),"queued");
});

test("stale actor continuation fails after restart until physical cleanup retires", () => {
  const a=new NonreentrantActorTurnModel(7);
  a.enter("old",7);
  a.suspend("old");
  a.retire(8);
  assert.equal(a.turn.status,"retiring");
  assert.throws(()=>a.resume("old",7),/STALE_RESUME/);
  assert.equal(a.enter("fresh",8),"queued");
  a.finish("old");
  assert.equal(a.turn.task,"fresh");
  assert.equal(a.turn.generation,8);
});

test("known pure/allocating work can execute inside a guard", () => {
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["pure","read","write","alloc"]}),"accept");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["ffi-safe"]}),"accept");
});

test("transitive suspend and blocking host effects must be excluded", () => {
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["suspend"]}),"E_CRITICAL_SUSPENSION");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["block"]}),"E_CRITICAL_BLOCKING");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["pure","suspend"]}),"E_CRITICAL_SUSPENSION");
});

test("missing guard, nested guard, or opaque summaries fail closed", () => {
  assert.equal(checkCriticalEffectSummary({guardOwned:false,effects:["pure"]}),"E_CRITICAL_OWNER");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,nested:true,effects:["pure"]}),"E_CRITICAL_NESTED");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,trusted:false,effects:["pure"]}),"E_EFFECT_UNKNOWN");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:["untrusted-ffi"]}),"E_EFFECT_UNKNOWN");
  assert.equal(checkCriticalEffectSummary({guardOwned:true,effects:null}),"E_EFFECT_UNKNOWN");
});

test("model rejects forged generations, invalid clocks and double release", () => {
  const q=new CriticalAdmissionModel();
  assert.throws(()=>q.acquire("owner",2),/STALE_GENERATION/);
  assert.throws(()=>q.acquire("owner",1,{nowMs:-1}),/invalid clock/);
  assert.throws(()=>q.acquire("owner",1,{deadlineMs:-1}),/invalid deadline/);
  const a=q.acquire("owner",1);
  q.release(a);
  assert.throws(()=>q.release(a),/INVALID_RELEASE/);
});
