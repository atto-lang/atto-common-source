// HOST-ONLY protocol model for typed data/tensor actor delivery.
// This file is NOT real Oreslang guest execution, no actual RW scheduler,
// transport, durable database or hardware memory lease.
//
// All guest-visible persistent bookkeeping is in ONE "state" object.
// The runtime-owned state reader/writer gate remains an independent trusted
// scheduler primitive and never becomes a second guest actor field.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const schema=JSON.parse(readFileSync(new URL("../contracts/v1/tensor-data/tensor-data-envelope.schema.json",import.meta.url),"utf8"));
const permitted=new Set(["kind","runId","graphEpoch","actorEpoch","partitionId","sequence","stepId","microbatchId","watermarkMs","tensor","lease","digest"]);
function die(c){throw Error(c);}
function validateData(e){
  if(!e||Object.getPrototypeOf(e)!==Object.prototype)die("INVALID_DATA_ENVELOPE");
  for(const k of Object.keys(e))if(!permitted.has(k))die("UNKNOWN_DATA_FIELD");
  for(const k of permitted)if(!Object.hasOwn(e,k))die("MISSING_DATA_FIELD");
  if(e.kind!=="data")die("INVALID_KIND");
  if(typeof e.runId!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(e.runId))die("INVALID_RUN");
  for(const k of ["graphEpoch","actorEpoch"]){
    if(!Number.isSafeInteger(e[k])||e[k]<1)die("INVALID_EPOCH");
  }
  for(const k of ["partitionId","sequence","stepId","microbatchId","watermarkMs"]){
    if(!Number.isSafeInteger(e[k])||e[k]<0)die("INVALID_INDEX_OR_WATERMARK");
  }
  if(typeof e.digest!=="string"||!/^[a-f0-9]{8,64}$/.test(e.digest))die("INVALID_DIGEST");
  const t=e.tensor;
  if(!t||Object.getPrototypeOf(t)!==Object.prototype||
    Object.keys(t).sort().join(",")!=="byteLength,dtype,shape,strides")die("INVALID_TENSOR_DESCRIPTOR");
  if(t.dtype!=="f64"||!Array.isArray(t.shape)||!Array.isArray(t.strides)||
     t.shape.length!==2||t.strides.length!==2)die("INVALID_TENSOR_LAYOUT");
  const [rows,cols]=t.shape,[major,minor]=t.strides;
  if(![rows,cols,major,minor].every(Number.isSafeInteger)||
     [rows,cols,major,minor].some(x=>x<0||x>2147483647)||
     major!==cols||minor!==1)die("INVALID_TENSOR_LAYOUT");
  if(!Number.isSafeInteger(t.byteLength)||t.byteLength<0||t.byteLength>2147483647||
     (BigInt(rows)*BigInt(cols)*8n)!==BigInt(t.byteLength))
    die("INVALID_TENSOR_BYTES");
  const l=e.lease;
  if(!l||Object.getPrototypeOf(l)!==Object.prototype||
    Object.keys(l).sort().join(",")!=="epoch,id,mode"||
    typeof l.id!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(l.id)||
    !Number.isSafeInteger(l.epoch)||l.epoch<1||
    l.mode!=="frozen")die("INVALID_LEASE");
  if(l.epoch!==e.actorEpoch)die("LEASE_EPOCH_MISMATCH");
}
const id=e=>e.partitionId+":"+e.sequence;
function event(partitionId,sequence,overrides={}) {
  return {
    kind:"data",runId:"runA",graphEpoch:2,actorEpoch:3,
    partitionId,sequence,stepId:1,microbatchId:sequence,
    watermarkMs:sequence*10,
    tensor:{dtype:"f64",shape:[2,2],strides:[2,1],byteLength:32},
    lease:{id:"token_"+partitionId+"_"+sequence,epoch:3,mode:"frozen"},
    digest:("00000000"+(partitionId*100+sequence).toString(16)).slice(-8),
    ...overrides
  };
}
class DataStage {
  constructor({maxItems=2,maxBytes=80,maxReceipts=1024,runId="runA",graphEpoch=2,actorEpoch=3,restore=null}={}) {
    if(![maxItems,maxBytes,maxReceipts].every(Number.isSafeInteger)||
       maxItems<1||maxBytes<0||maxReceipts<1||maxItems>maxReceipts)
      die("INVALID_STAGE_LIMITS");
    if(restore&&(!Array.isArray(restore.receipts)||restore.receipts.length>maxReceipts))
      die("INVALID_RESTORE_RECEIPTS");
    this.state={
      runId,graphEpoch,actorEpoch,
      usedItems:0,usedBytes:0,maxItems,maxBytes,maxReceipts,
      partitions:new Map(),active:new Map(),receipts:new Map(),
      cancelled:false,checkpointEpoch:restore?.checkpointEpoch??0
    };
    if(restore){
      if(restore.runId!==runId||restore.graphEpoch!==graphEpoch||
         restore.actorEpoch>=actorEpoch)die("INVALID_RESTORE");
      for(const p of restore.partitions)this.state.partitions.set(p.id,{next:p.next,watermark:p.watermark});
      for(const r of restore.receipts)this.state.receipts.set(r.id,Object.freeze({...r}));
    }
  }
  partition(s,p){return s.partitions.get(p)||{next:0,watermark:0};}
  envelope(s,e){
    if(s.cancelled)die("STAGE_CANCELLED");
    validateData(e);
    if(e.runId!==s.runId)die("RUN_MISMATCH");
    if(e.graphEpoch!==s.graphEpoch)die("GRAPH_GENERATION_MISMATCH");
    if(e.actorEpoch!==s.actorEpoch)die("ACTOR_INCARNATION_MISMATCH");
  }
  accept(e){
    const s=this.state;
    this.envelope(s,e);
    const pid=id(e),p=this.partition(s,e.partitionId);
    if(e.sequence<p.next){
      const prior=s.receipts.get(pid);
      if(prior?.digest===e.digest&&prior?.acked)return Object.freeze({status:"duplicate",id:pid});
      die(prior?"REPLAY_PAYLOAD_MISMATCH":"STALE_SEQUENCE_NO_RECEIPT");
    }
    if(e.sequence!==p.next)die("PARTITION_SEQUENCE_GAP");
    if(e.watermarkMs<p.watermark)die("LATE_EVENT_BELOW_WATERMARK");
    const bytes=e.tensor.byteLength;
    if(s.usedItems>=s.maxItems||bytes>s.maxBytes-s.usedBytes)die("DATA_BACKPRESSURE");
    // A receipt slot is reserved at admission, so ACK never fails simply
    // because it needs to record a dedup receipt and release held credits.
    if(s.receipts.size+s.active.size>=s.maxReceipts)
      die("DATA_RECEIPT_BACKPRESSURE");
    if(s.active.has(pid))die("DUPLICATE_ACTIVE_DATA");
    // All preflight above happens BEFORE state or credits mutate.
    s.active.set(pid,{bytes,digest:e.digest,partitionId:e.partitionId,sequence:e.sequence,
                      watermarkMs:e.watermarkMs,leaseId:e.lease.id});
    s.usedItems+=1;s.usedBytes+=bytes;
    s.partitions.set(e.partitionId,{next:p.next+1,watermark:p.watermark});
    return Object.freeze({status:"admitted",id:pid,bytes});
  }
  ack(partitionId,sequence,digest){
    const s=this.state;
    if(s.cancelled)die("STAGE_CANCELLED");
    const pid=partitionId+":"+sequence,record=s.active.get(pid);
    if(!record) {
      const prior=s.receipts.get(pid);
      if(prior&&prior.digest===digest&&prior.acked)return Object.freeze({status:"duplicate-ack",id:pid});
      die(prior?"ACK_DIGEST_MISMATCH":"UNKNOWN_BATCH_ACK");
    }
    if(record.digest!==digest)die("ACK_DIGEST_MISMATCH");
    // This is local accounting only. Durable effects need a sink transaction.
    s.active.delete(pid);s.usedItems-=1;s.usedBytes-=record.bytes;
    s.receipts.set(pid,Object.freeze({id:pid,digest,acked:true}));
    if(s.usedItems<0||s.usedBytes<0)die("CREDIT_UNDERFLOW");
    return Object.freeze({status:"acked",id:pid});
  }
  watermark(partitionId,watermarkMs){
    const s=this.state;
    if(s.cancelled)die("STAGE_CANCELLED");
    if(!Number.isSafeInteger(partitionId)||partitionId<0||
       !Number.isSafeInteger(watermarkMs)||watermarkMs<0)die("INVALID_WATERMARK");
    const p=this.partition(s,partitionId);
    if(watermarkMs<p.watermark)die("WATERMARK_REGRESSION");
    for(const r of s.active.values())
      if(r.partitionId===partitionId)die("UNACKED_DATA_AT_WATERMARK");
    s.partitions.set(partitionId,{...p,watermark:watermarkMs});
    return watermarkMs;
  }
  checkpoint(){
    const s=this.state;
    if(s.cancelled)die("STAGE_CANCELLED");
    if(s.active.size!==0)die("CHECKPOINT_HAS_INFLIGHT");
    const c={
      runId:s.runId,graphEpoch:s.graphEpoch,actorEpoch:s.actorEpoch,
      checkpointEpoch:s.checkpointEpoch+1,
      partitions:[...s.partitions.entries()].map(([id,p])=>({id,...p})).sort((a,b)=>a.id-b.id),
      receipts:[...s.receipts.values()].map(r=>({...r})).sort((a,b)=>a.id.localeCompare(b.id))
    };
    s.checkpointEpoch+=1;
    return Object.freeze(c);
  }
  cancel(){
    const s=this.state;
    if(s.cancelled)return false;
    s.cancelled=true;s.active.clear();s.usedBytes=0;s.usedItems=0;
    return true;
  }
  status(){
    const s=this.state;
    return Object.freeze({items:s.usedItems,bytes:s.usedBytes,cancelled:s.cancelled,
      active:s.active.size,checkpointEpoch:s.checkpointEpoch});
  }
}
test("schema draft and field registry remain explicit and do not claim guest execution",()=>{
  assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$defs.data.properties.kind.const,"data");
  assert(schema.$defs.data.additionalProperties===false);
  assert.equal(schema.$defs.data.properties.tensor.$ref,"#/$defs/tensor");
  assert.equal(schema["x-oreslang-guestExecution"],"NOT_EXECUTED");
});
test("independent partitions advance with separate ordered sequences",()=>{
  const s=new DataStage();
  assert.equal(s.accept(event(0,0)).status,"admitted");
  assert.equal(s.accept(event(1,0)).status,"admitted");
  assert.deepEqual(s.status(),{items:2,bytes:64,cancelled:false,active:2,checkpointEpoch:0});
  assert.throws(()=>s.accept(event(0,1)),/DATA_BACKPRESSURE/);
  s.ack(1,0,event(1,0).digest);
  assert.equal(s.accept(event(0,1)).status,"admitted");
  s.ack(0,0,event(0,0).digest);s.ack(0,1,event(0,1).digest);
  assert.equal(s.status().bytes,0);
});
test("byte admission independently limits batches even when count permits",()=>{
  const s=new DataStage({maxItems:8,maxBytes:48});
  s.accept(event(0,0));
  assert.throws(()=>s.accept(event(1,0)),/DATA_BACKPRESSURE/);
  assert.equal(s.status().bytes,32);
  s.ack(0,0,event(0,0).digest);
  assert.equal(s.accept(event(1,0)).status,"admitted");
});
test("invalid descriptor, extra field, overflow and stale actor lease fail before credits",()=>{
  const s=new DataStage();
  const cases=[
    event(0,0,{unknown:"bad"}),
    event(0,0,{tensor:{dtype:"f64",shape:[2,2],strides:[2,1],byteLength:16}}),
    event(0,0,{tensor:{dtype:"f64",shape:[2,3],strides:[2,1],byteLength:48}}),
    event(0,0,{tensor:{dtype:"f64",shape:[Number.MAX_SAFE_INTEGER,2],strides:[2,1],byteLength:32}}),
    event(0,0,{lease:{id:"bad",epoch:2,mode:"frozen"}}),
    event(0,0,{lease:{id:"bad",epoch:3,mode:"mutable"}}),
    event(0,0,{graphEpoch:999}),
    event(0,0,{runId:"other"}),
    event(0,0,{actorEpoch:2})
  ];
  for(const e of cases){
    assert.throws(()=>s.accept(e));
    assert.equal(s.status().bytes,0);
    assert.equal(s.status().items,0);
  }
});
test("duplicate replay and ack are idempotent; changed payload digest never accepted",()=>{
  const s=new DataStage();
  s.accept(event(1,0));
  assert.throws(()=>s.accept(event(1,0)),/STALE_SEQUENCE_NO_RECEIPT/);
  const digest=event(1,0).digest;
  assert.equal(s.ack(1,0,digest).status,"acked");
  assert.equal(s.ack(1,0,digest).status,"duplicate-ack");
  assert.equal(s.accept(event(1,0)).status,"duplicate");
  assert.throws(()=>s.accept(event(1,0,{digest:"deadbeef"})),/REPLAY_PAYLOAD_MISMATCH/);
  assert.throws(()=>s.ack(1,0,"deadbeef"),/ACK_DIGEST_MISMATCH/);
  assert.equal(s.status().bytes,0);
});
test("watermark never advances past inflight batch and cannot regress",()=>{
  const s=new DataStage();
  s.accept(event(0,0));
  assert.throws(()=>s.watermark(0,20),/UNACKED_DATA_AT_WATERMARK/);
  s.ack(0,0,event(0,0).digest);
  assert.equal(s.watermark(0,20),20);
  assert.throws(()=>s.watermark(0,10),/WATERMARK_REGRESSION/);
  assert.throws(()=>s.accept(event(0,1,{watermarkMs:10})),/LATE_EVENT_BELOW_WATERMARK/);
  assert.equal(s.accept(event(0,1,{watermarkMs:20})).status,"admitted");
});
test("gap rejection doesn't consume credits or sequence",()=>{
  const s=new DataStage();
  assert.throws(()=>s.accept(event(0,1)),/PARTITION_SEQUENCE_GAP/);
  assert.equal(s.accept(event(0,0)).status,"admitted");
  assert.equal(s.status().items,1);
});
test("checkpoint rejects inflight and recover into fenced new actor incarnation",()=>{
  const s=new DataStage();
  s.accept(event(0,0));
  assert.throws(()=>s.checkpoint(),/CHECKPOINT_HAS_INFLIGHT/);
  s.ack(0,0,event(0,0).digest);
  s.watermark(0,5);
  const c=s.checkpoint();
  const next=new DataStage({actorEpoch:4,restore:c});
  assert.throws(()=>next.accept(event(0,1)),/ACTOR_INCARNATION_MISMATCH/);
  const e=event(0,1,{actorEpoch:4,lease:{id:"next1",epoch:4,mode:"frozen"}});
  assert.equal(next.accept(e).status,"admitted");
  assert.equal(next.status().checkpointEpoch,1);
});
test("cancel refunds budgets exactly once and denies late acks/data",()=>{
  const s=new DataStage();
  s.accept(event(0,0));
  assert.equal(s.cancel(),true);
  assert.equal(s.cancel(),false);
  assert.equal(s.status().bytes,0);
  assert.throws(()=>s.ack(0,0,event(0,0).digest),/STAGE_CANCELLED/);
  assert.throws(()=>s.accept(event(0,1)),/STAGE_CANCELLED/);
  assert.throws(()=>s.checkpoint(),/STAGE_CANCELLED/);
});
test("seeded 1000 bounded admit/ack/replay cycles maintain counts and byte invariants",()=>{
  const s=new DataStage({maxItems:3,maxBytes:96});
  let seq=0;
  for(let i=0;i<1000;i++){
    const e=event(0,seq);
    const r=s.accept(e);
    assert.equal(r.status,"admitted");
    assert.equal(s.status().items,1);
    assert.equal(s.status().bytes,32);
    assert.equal(s.ack(0,seq,e.digest).status,"acked");
    assert.equal(s.accept(e).status,"duplicate");
    assert.equal(s.status().bytes,0);
    seq++;
  }
  assert.equal(s.checkpoint().partitions[0].next,1000);
});

test("ack receipt retention is bounded; full ledger fails closed before new admission",()=>{
  const s=new DataStage({maxItems:2,maxBytes:128,maxReceipts:2});
  for(let i=0;i<2;i++){
    const e=event(0,i);
    assert.equal(s.accept(e).status,"admitted");
    assert.equal(s.ack(0,i,e.digest).status,"acked");
  }
  assert.throws(()=>s.accept(event(0,2)),/DATA_RECEIPT_BACKPRESSURE/);
  assert.equal(s.status().bytes,0);
  assert.equal(s.checkpoint().receipts.length,2);
  // No unverified eviction of dedup history or automatic durable checkpoint.
});
test("stage bounds and JSON Schema maximums are validated before memory reservation",()=>{
  assert.throws(()=>new DataStage({maxItems:0}),/INVALID_STAGE_LIMITS/);
  assert.throws(()=>new DataStage({maxItems:3,maxReceipts:2}),/INVALID_STAGE_LIMITS/);
  const s=new DataStage();
  const tooWide=event(0,0,{tensor:{
    dtype:"f64",shape:[3000000000,1],strides:[1,1],byteLength:24000000000
  }});
  assert.throws(()=>s.accept(tooWide),/INVALID_TENSOR_LAYOUT/);
  const tooBig=event(0,0,{tensor:{
    dtype:"f64",shape:[1,300000000],strides:[300000000,1],byteLength:2400000000
  }});
  assert.throws(()=>s.accept(tooBig),/INVALID_TENSOR_BYTES/);
  assert.equal(s.status().bytes,0);
});
