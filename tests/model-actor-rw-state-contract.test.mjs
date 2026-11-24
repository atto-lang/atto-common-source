// HOST-ONLY reference scheduler for the proposed actor-state shared-read/
// exclusive-write gate. NOT an Oreslang compiler/actor runtime test.
import test from "node:test";
import assert from "node:assert/strict";

class ActorStateRwGate {
  constructor(epoch=1, capacity=6) {
    this.epoch=epoch;
    this.capacity=capacity;
    this.readers=new Map();
    this.writer=null;
    this.queue=[];
    this.retiring=false;
    this.nextId=0;
  }
  fail(code) { throw Error(code); }
  matches(ticket) {
    const seen = ticket.mode==="read" ? this.readers.get(ticket.id) : this.writer;
    return seen === ticket;
  }
  heldBy(owner) {
    return [...this.readers.values(), ...(this.writer?[this.writer]:[])].some(t=>t.owner===owner);
  }
  request(mode, owner, epoch=this.epoch) {
    if (this.retiring) this.fail("STATE_EPOCH_RETIRED");
    if (epoch!==this.epoch) this.fail("STATE_WRONG_EPOCH");
    if (mode!=="read" && mode!=="write") this.fail("STATE_UNKNOWN_MODE");
    if (!owner) this.fail("STATE_MISSING_OWNER");
    // The current substrate conservatively rejects same-owner nesting;
    // read->write upgrades are especially unsafe.
    if (this.heldBy(owner) || this.queue.some(q=>q.ticket.owner===owner))
      this.fail("STATE_NESTED_LOAN_UNSUPPORTED");
    if (this.queue.length>=this.capacity) this.fail("STATE_GATE_QUEUE_FULL");
    const ticket=Object.freeze({id:++this.nextId,mode,owner,epoch});
    let resolve,reject;
    const ready=new Promise((a,b)=>{resolve=a;reject=b;});
    // Avoid unhandled rejected pending promises if the requester only
    // checks cancellation synchronously.
    ready.catch(()=>{});
    const item={ticket,resolve,reject,phase:"queued"};
    this.queue.push(item);
    this.drain();
    return {ticket,ready,cancel:()=>this.cancelQueued(item)};
  }
  cancelQueued(item) {
    if(item.phase!=="queued") return false;
    const idx=this.queue.indexOf(item);
    if(idx<0) this.fail("STATE_QUEUE_CORRUPT");
    this.queue.splice(idx,1);
    item.phase="cancelled";
    item.reject(Error("STATE_ADMISSION_CANCELLED"));
    this.drain();
    return true;
  }
  drain() {
    if(this.retiring||this.writer) return;
    // A writer at the head blocks all readers which arrived later.
    if(this.queue.length===0) return;
    if(this.queue[0].ticket.mode==="write") {
      if(this.readers.size) return;
      const item=this.queue.shift();
      item.phase="granted";
      this.writer=item.ticket;
      item.resolve(item.ticket);
      return;
    }
    // Admit exactly the leading cohort of readers. A queued writer is a
    // fairness barrier even while previously granted readers remain live.
    while(this.queue.length && this.queue[0].ticket.mode==="read") {
      const item=this.queue.shift();
      item.phase="granted";
      this.readers.set(item.ticket.id,item.ticket);
      item.resolve(item.ticket);
    }
  }
  release(ticket) {
    if(!ticket||ticket.epoch!==this.epoch||!this.matches(ticket))
      this.fail("STATE_INVALID_OR_DOUBLE_RELEASE");
    if(ticket.mode==="read") this.readers.delete(ticket.id);
    else this.writer=null;
    this.drain();
  }
  retire() {
    if(this.retiring) return false;
    this.retiring=true;
    for(const item of this.queue) {
      item.phase="cancelled";
      item.reject(Error("STATE_EPOCH_RETIRED"));
    }
    this.queue=[];
    // Do not revoke a currently executing callback's permit prematurely:
    // final reclamation waits for readers/writer to release.
    return true;
  }
  canReclaim() { return this.retiring && !this.writer && this.readers.size===0 && !this.queue.length; }
  snapshot() { return {readers:this.readers.size,writer:!!this.writer,waiting:this.queue.map(q=>q.ticket.mode)}; }
}
function mustStillWait(promise) {
  let settled=false;
  promise.then(()=>{settled=true;},()=>{settled=true;});
  return Promise.resolve().then(()=>assert.equal(settled,false));
}
test("reader cohort admits multiple readers, excludes writer and prevents newcomer bypass",async()=>{
  const g=new ActorStateRwGate();
  const r1=await g.request("read","r1").ready;
  const r2=await g.request("read","r2").ready;
  const w=g.request("write","w");
  const r3=g.request("read","r3");
  assert.deepEqual(g.snapshot(),{readers:2,writer:false,waiting:["write","read"]});
  await mustStillWait(w.ready);
  await mustStillWait(r3.ready);
  g.release(r1);
  await mustStillWait(w.ready);
  g.release(r2);
  const wt=await w.ready;
  assert.deepEqual(g.snapshot(),{readers:0,writer:true,waiting:["read"]});
  await mustStillWait(r3.ready);
  g.release(wt);
  const last=await r3.ready;
  g.release(last);
  assert.deepEqual(g.snapshot(),{readers:0,writer:false,waiting:[]});
});
test("same-owner nesting and read-to-write upgrades fail without deadlocking",async()=>{
  const g=new ActorStateRwGate();
  const held=await g.request("read","actor-turn-1").ready;
  assert.throws(()=>g.request("write","actor-turn-1"),/STATE_NESTED_LOAN_UNSUPPORTED/);
  assert.throws(()=>g.request("read","actor-turn-1"),/STATE_NESTED_LOAN_UNSUPPORTED/);
  g.release(held);
});
test("queued writer cancellation wakes later readers; no duplicate completion",async()=>{
  const g=new ActorStateRwGate();
  const active=await g.request("read","a").ready;
  const w=g.request("write","w");
  const after=g.request("read","later");
  assert.equal(w.cancel(),true);
  await assert.rejects(w.ready,/STATE_ADMISSION_CANCELLED/);
  assert.equal(w.cancel(),false);
  const reader=await after.ready;
  assert.equal(g.snapshot().readers,2);
  g.release(active);g.release(reader);
});
test("queue admission is bounded independently from live reader permits",async()=>{
  const g=new ActorStateRwGate(1,2);
  const held=await g.request("read","initial").ready;
  const w=g.request("write","writer");
  const later=g.request("read","later");
  assert.throws(()=>g.request("read","overflow"),/STATE_GATE_QUEUE_FULL/);
  assert.equal(later.cancel(),true);
  await assert.rejects(later.ready,/STATE_ADMISSION_CANCELLED/);
  g.release(held);
  const wt=await w.ready;
  g.release(wt);
});
test("retiring epoch denies new grants, rejects waiters, then waits for active callback to exit",async()=>{
  const g=new ActorStateRwGate(9);
  const active=await g.request("read","active",9).ready;
  const queued=g.request("write","waiting",9);
  assert.throws(()=>g.request("read","stale",8),/STATE_WRONG_EPOCH/);
  assert.equal(g.retire(),true);
  assert.equal(g.retire(),false);
  await assert.rejects(queued.ready,/STATE_EPOCH_RETIRED/);
  assert.throws(()=>g.request("read","new",9),/STATE_EPOCH_RETIRED/);
  assert.equal(g.canReclaim(),false);
  g.release(active);
  assert.equal(g.canReclaim(),true);
});
test("forged/cross-gate tickets and double release are refused",async()=>{
  const g=new ActorStateRwGate();
  const other=new ActorStateRwGate();
  const t=await g.request("write","owner").ready;
  assert.throws(()=>g.release({...t}),/STATE_INVALID_OR_DOUBLE_RELEASE/);
  assert.throws(()=>other.release(t),/STATE_INVALID_OR_DOUBLE_RELEASE/);
  g.release(t);
  assert.throws(()=>g.release(t),/STATE_INVALID_OR_DOUBLE_RELEASE/);
});
test("write permits serialize counter updates; read snapshots do not mutate state",async()=>{
  const g=new ActorStateRwGate();
  const state={activeVersion:1,weights:10,gradient:0};
  const r1=await g.request("read","forward-1").ready;
  const r2=await g.request("read","forward-2").ready;
  const v1=Object.freeze({weight:state.weights,version:state.activeVersion});
  const v2=Object.freeze({weight:state.weights,version:state.activeVersion});
  assert.deepEqual(v1,v2);
  const update=g.request("write","optimizer");
  await mustStillWait(update.ready);
  g.release(r2); g.release(r1);
  const permit=await update.ready;
  state.weights=state.weights-5;
  state.activeVersion+=1;
  g.release(permit);
  assert.equal(v1.weight,10);
  assert.equal(v2.version,1);
  assert.deepEqual(state,{activeVersion:2,weights:5,gradient:0});
});
test("writer with pending readers cannot be barged by newly queued writer",async()=>{
  const g=new ActorStateRwGate();
  const first=await g.request("write","one").ready;
  const reader=g.request("read","reader");
  const second=g.request("write","two");
  g.release(first);
  const rd=await reader.ready;
  await mustStillWait(second.ready);
  g.release(rd);
  const wt=await second.ready;
  g.release(wt);
});
