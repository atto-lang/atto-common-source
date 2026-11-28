import test from "node:test";
import assert from "node:assert/strict";
import {
  CriticalAdmissionModel,NonreentrantActorTurnModel
} from "../models/critical-suspends-actor-turn-v1.mjs";

// Source-free oracle tests only; they are never native Oreslang guest evidence.
test("critical queue capacity is strictly bounded", () => {
  const q=new CriticalAdmissionModel(1,{maxQueued:2});
  const a=q.acquire("owner",1), b=q.acquire("b",1), c=q.acquire("c",1);
  assert.deepEqual(q.acquire("d",1),{status:"saturated"});
  assert.deepEqual(q.snapshot().pending,[b.sequence,c.sequence]);
  q.release(a);
  assert.equal(b.status,"held");
  assert.equal(q.acquire("d",1).status,"queued");
});
test("capacity and incarnation configuration reject invalid values", () => {
  for(const n of [0,-1,1.5,NaN,Infinity,65537,"3"])
    assert.throws(()=>new CriticalAdmissionModel(1,{maxQueued:n}),/capacity/);
  for(const n of [0,-1,1.5,NaN,Infinity])
    assert.throws(()=>new NonreentrantActorTurnModel(n),/generation/);
});
test("a critical owner cannot recursively acquire or enqueue behind itself", () => {
  const q=new CriticalAdmissionModel();
  q.acquire("owner",1);
  assert.throws(()=>q.acquire("owner",1),/E_CRITICAL_NESTED/);
  assert.throws(()=>q.acquire("owner",1,{tryOnly:true}),/E_CRITICAL_NESTED/);
  assert.equal(q.snapshot().pending.length,0);
});
test("duplicate critical queue requests do not mint two tickets", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("a",1);
  const b=q.acquire("b",1);
  assert.throws(()=>q.acquire("b",1),/E_CRITICAL_NESTED/);
  assert.deepEqual(q.snapshot().pending,[b.sequence]);
  q.release(a);
  assert.equal(b.status,"held");
});
test("capacity opens immediately after cancellation without granting cancelled work", () => {
  const q=new CriticalAdmissionModel(1,{maxQueued:1}),a=q.acquire("a",1);
  const b=q.acquire("b",1);
  assert.equal(q.acquire("c",1).status,"saturated");
  assert.equal(q.cancel(b),true);
  const c=q.acquire("c",1);
  q.release(a);
  assert.equal(c.status,"held");
  assert.equal(b.status,"cancelled");
});
test("invalid deadline descriptors fail atomically without expiring any ticket", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("a",1);
  const b=q.acquire("b",1),c=q.acquire("c",1);
  assert.throws(()=>q.expire(20,seq=>seq===b.sequence?10:-1),/invalid deadline/);
  assert.deepEqual(q.snapshot().pending,[b.sequence,c.sequence]);
  assert.equal(b.status,"queued");
  q.release(a);
  assert.equal(b.status,"held");
});
test("expiry removes only expired FIFO entries and does not block later valid entries", () => {
  const q=new CriticalAdmissionModel(),a=q.acquire("a",1);
  const b=q.acquire("b",1),c=q.acquire("c",1),d=q.acquire("d",1);
  q.expire(20,seq=>seq===c.sequence?20:100);
  assert.equal(c.status,"expired");
  assert.deepEqual(q.snapshot().pending,[b.sequence,d.sequence]);
  q.release(a);
  assert.equal(b.status,"held");
  q.release(b);
  assert.equal(d.status,"held");
});
test("actor turn queue capacity and duplicate admission are bounded", () => {
  const a=new NonreentrantActorTurnModel(1,{maxQueued:1});
  assert.equal(a.enter("holder",1),"running");
  assert.equal(a.enter("next",1),"queued");
  assert.equal(a.enter("third",1),"saturated");
  assert.throws(()=>a.enter("next",1),/E_ACTOR_DUPLICATE_TICKET/);
  a.finish("holder");
  assert.equal(a.turn.task,"next");
});
test("actor self admission is a cycle error even if the owner is suspended", () => {
  const a=new NonreentrantActorTurnModel();
  a.enter("holder",1);
  a.suspend("holder");
  assert.throws(()=>a.enter("holder",1),/E_ACTOR_SELF_WAIT/);
  assert.equal(a.turn.status,"suspended");
  assert.equal(a.dataQueue.length,0);
});
test("old generation cleanup cannot erase the new actor's queued DATA", () => {
  const a=new NonreentrantActorTurnModel(3);
  a.enter("old",3);
  a.suspend("old");
  a.retire(4);
  assert.equal(a.enter("new",4),"queued");
  assert.throws(()=>a.resume("old",3),/STALE_RESUME/);
  a.finish("old");
  assert.equal(a.turn.task,"new");
  a.finish("new");
  assert.equal(a.physicallyRetired,true);
});
