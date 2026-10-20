// HOST-ONLY admission reference: this is NOT Oreslang graph IR or actor-runtime evidence.
// The numerical algorithms of LP/MIP and autograd are NOT implemented here.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const MAX = 2147483647;
function fail(code) { throw new Error(code); }
function integer(x, min, max, code) {
  if (!Number.isSafeInteger(x) || x < min || x > max) fail(code);
}
function validId(x) { if (typeof x !== "string" || !ID.test(x)) fail("GRAPH_INVALID_ID"); }
function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    Object.values(obj).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}
function portShape(p) {
  if (!p || typeof p !== "object" || !["tensor","job"].includes(p.kind))
    fail("GRAPH_INVALID_PORT");
  if (p.kind === "tensor") {
    if (!["f64","f32"].includes(p.dtype) ||
        !Array.isArray(p.shape) || p.shape.length < 1 || p.shape.length > 8 ||
        p.shape.some(d => !Number.isSafeInteger(d) || d < 1 || d > MAX))
      fail("GRAPH_INVALID_TENSOR_SHAPE");
    if (p.layout !== "row-major") fail("GRAPH_INVALID_LAYOUT");
  } else {
    validId(p.type);
    if ("shape" in p || "dtype" in p || "layout" in p)
      fail("GRAPH_JOB_TENSOR_CONFUSION");
  }
  return JSON.stringify(p.kind === "tensor"
    ? {kind:p.kind,dtype:p.dtype,shape:p.shape,layout:p.layout}
    : {kind:p.kind,type:p.type});
}
function canonicalAttrs(value, depth=0) {
  if (depth>4) fail("GRAPH_ATTR_DEPTH");
  if (value===null || typeof value==="boolean") return value;
  if (typeof value==="string") {
    if(value.length>256) fail("GRAPH_INVALID_ATTR");
    return value;
  }
  if (typeof value==="number") {
    if(!Number.isFinite(value)) fail("GRAPH_INVALID_ATTR");
    return value;
  }
  if (Array.isArray(value)) {
    if(value.length>64) fail("GRAPH_ATTR_SIZE");
    return value.map(v=>canonicalAttrs(v,depth+1));
  }
  if (!value || typeof value!=="object" || Object.getPrototypeOf(value)!==Object.prototype ||
      Object.keys(value).length>32) fail("GRAPH_INVALID_ATTR");
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>{validId(k);return [k,canonicalAttrs(v,depth+1)];}));
}
function onlyKeys(obj, allowed) {
  if (!obj || typeof obj!=="object" ||
      Object.keys(obj).some(k=>!allowed.includes(k))) fail("GRAPH_UNDECLARED_METADATA");
}
function validateGraph(input) {
  if (!input || !["dag","worklist"].includes(input.mode)) fail("GRAPH_BAD_MODE");
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 1024 ||
      !Array.isArray(input.edges) || input.edges.length > 8192)
    fail("GRAPH_SIZE_LIMIT");
  const nodes=new Map(), edgeIds=new Set(), portEdges=new Map();
  for (const n of input.nodes) {
    validId(n?.id);
    validId(n?.op);
    onlyKeys(n,["id","op","attrs","inputs","outputs"]);
    if(n.attrs!==undefined) canonicalAttrs(n.attrs);
    if (nodes.has(n.id)) fail("GRAPH_DUPLICATE_NODE");
    if (!n.inputs || !n.outputs || typeof n.inputs !== "object" ||
        typeof n.outputs !== "object" || Array.isArray(n.inputs) || Array.isArray(n.outputs))
      fail("GRAPH_BAD_PORTS");
    for (const [name,p] of Object.entries(n.inputs)) {
      validId(name);
      onlyKeys(p,["kind","type","dtype","shape","layout","fanIn"]);
      portShape(p);
      if (!["one","many"].includes(p.fanIn)) fail("GRAPH_INVALID_FANIN");
    }
    for (const [name,p] of Object.entries(n.outputs)) {
      validId(name);
      onlyKeys(p,["kind","type","dtype","shape","layout","fanIn"]);
      portShape(p);
    }
    nodes.set(n.id,n);
  }
  const indegree=new Map([...nodes.keys()].map(k=>[k,0]));
  const onward=new Map([...nodes.keys()].map(k=>[k,[]]));
  for (const e of input.edges) {
    validId(e?.id);
    onlyKeys(e,["id","from","fromPort","to","toPort","kind","capacity","delayTokens"]);
    if (edgeIds.has(e.id)) fail("GRAPH_DUPLICATE_EDGE");
    edgeIds.add(e.id);
    const a=nodes.get(e.from),b=nodes.get(e.to);
    if (!a || !b) fail("GRAPH_UNKNOWN_NODE");
    const output=a.outputs[e.fromPort], target=b.inputs[e.toPort];
    if (!output || !target) fail("GRAPH_UNKNOWN_PORT");
    if (portShape(output)!==portShape(target)) fail("GRAPH_PORT_TYPE_MISMATCH");
    const key=JSON.stringify([e.to,e.toPort]);
    const count=(portEdges.get(key)||0)+1;
    if (count>1 && target.fanIn!=="many") fail("GRAPH_INPUT_MULTIPLE_PRODUCERS");
    portEdges.set(key,count);
    integer(e.capacity,1,MAX,"GRAPH_BAD_EDGE_CAPACITY");
    if (e.kind==="feedback") {
      if (input.mode!=="worklist") fail("GRAPH_FEEDBACK_IN_DAG");
      integer(e.delayTokens,1,e.capacity,"GRAPH_FEEDBACK_UNBOUNDED");
    } else if (e.kind==="data") {
      if ("delayTokens" in e) fail("GRAPH_UNDECLARED_DELAY");
      indegree.set(e.to,indegree.get(e.to)+1);
      onward.get(e.from).push(e.to);
    } else fail("GRAPH_UNKNOWN_EDGE_KIND");
  }
  const ready=[...nodes.keys()].filter(id=>indegree.get(id)===0).sort(), order=[];
  while (ready.length) {
    const id=ready.shift();
    order.push(id);
    for (const next of onward.get(id)) {
      indegree.set(next,indegree.get(next)-1);
      if (indegree.get(next)===0) { ready.push(next); ready.sort(); }
    }
  }
  if (order.length!==nodes.size) fail("GRAPH_UNDECLARED_CYCLE");
  // Canonical copy: caller mutations cannot rewrite admitted edges or identity.
  const normal={
    mode:input.mode,
    schemaVersion:1,
    nodes:[...nodes.values()].map(n=>({
      id:n.id, op:n.op, attrs:canonicalAttrs(n.attrs??{}),
      inputs:Object.fromEntries(Object.entries(n.inputs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,{...v,...(v.shape?{shape:[...v.shape]}:{})}])),
      outputs:Object.fromEntries(Object.entries(n.outputs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,{...v,...(v.shape?{shape:[...v.shape]}:{})}]))
    })).sort((a,b)=>a.id.localeCompare(b.id)),
    edges:input.edges.map(e=>({...e})).sort((a,b)=>a.id.localeCompare(b.id))
  };
  const digest=createHash("sha256").update(JSON.stringify(normal)).digest("hex");
  return deepFreeze({...normal,order,digest});
}
class DeliveryLedger {
  constructor(plan,{run="r1",epoch=1,maxItems=2,maxBytes=128,maxReceipts=8}={}) {
    integer(maxItems,1,MAX,"GRAPH_BAD_QUOTA");
    integer(maxBytes,1,MAX,"GRAPH_BAD_QUOTA");
    integer(maxReceipts,1,MAX,"GRAPH_BAD_QUOTA");
    this.state={plan,run,epoch,maxItems,maxBytes,maxReceipts,
      active:new Map(),receipts:new Map(),usedBytes:0,retired:false};
    this._runtimeGateHeld=false; // Host harness, not guest-owned actor state.
  }
  critical(fn) {
    if(this._runtimeGateHeld) fail("GRAPH_STATE_REENTRANT");
    this._runtimeGateHeld=true;
    try {
      const result=fn(this.state);
      if (result && typeof result.then==="function") fail("GRAPH_STATE_SUSPENDS");
      if (result===this.state) fail("GRAPH_STATE_ESCAPE");
      return result;
    } finally { this._runtimeGateHeld=false; }
  }
  identity(s,msg) {
    if(msg.run!==s.run || msg.epoch!==s.epoch || msg.graph!==s.plan.digest)
      fail("GRAPH_STALE_DELIVERY");
  }
  admit(msg) {
    return this.critical(s=>{
      if(s.retired) fail("GRAPH_EPOCH_RETIRED");
      this.identity(s,msg);
      if(typeof msg.delivery!=="string" || !ID.test(msg.delivery) ||
         typeof msg.payloadDigest!=="string" || !/^[a-f0-9]{64}$/.test(msg.payloadDigest))
        fail("GRAPH_INVALID_DELIVERY");
      if(!s.plan.edges.some(e=>e.id===msg.edge)) fail("GRAPH_UNKNOWN_EDGE");
      integer(msg.bytes,1,MAX,"GRAPH_INVALID_BYTES");
      const old=s.receipts.get(msg.delivery);
      if(old) {
        if(old.digest!==msg.payloadDigest || old.edge!==msg.edge || old.bytes!==msg.bytes)
          fail("GRAPH_REPLAY_TAMPERING");
        return Object.freeze({status:"acked",delivery:msg.delivery});
      }
      if(s.active.has(msg.delivery)) {
        const existing=s.active.get(msg.delivery);
        if(existing.digest!==msg.payloadDigest || existing.edge!==msg.edge || existing.bytes!==msg.bytes)
          fail("GRAPH_REPLAY_TAMPERING");
        fail("GRAPH_DUPLICATE_INFLIGHT");
      }
      const maxEdge=s.plan.edges.find(e=>e.id===msg.edge).capacity;
      const edgeActive=[...s.active.values()].filter(a=>a.edge===msg.edge).length;
      if(edgeActive>=maxEdge) fail("GRAPH_EDGE_BACKPRESSURE");
      // Reserve a future receipt slot BEFORE consuming in-flight credits.
      if(s.receipts.size+s.active.size>=s.maxReceipts) fail("GRAPH_RECEIPT_BACKPRESSURE");
      if(s.active.size>=s.maxItems || msg.bytes>s.maxBytes-s.usedBytes)
        fail("GRAPH_RESOURCE_BACKPRESSURE");
      const token=Symbol("authenticated-consumer-completion");
      s.active.set(msg.delivery,{edge:msg.edge,bytes:msg.bytes,
        digest:msg.payloadDigest,token});
      s.usedBytes+=msg.bytes;
      return Object.freeze({status:"admitted",delivery:msg.delivery,token});
    });
  }
  ack(msg,token) {
    return this.critical(s=>{
      if(s.retired) fail("GRAPH_EPOCH_RETIRED");
      this.identity(s,msg);
      const active=s.active.get(msg.delivery);
      if (!active) {
        const rec=s.receipts.get(msg.delivery);
        if (rec && rec.token===token && rec.edge===msg.edge && rec.digest===msg.payloadDigest && rec.bytes===msg.bytes)
          return Object.freeze({status:"already-acked",delivery:msg.delivery});
        fail("GRAPH_INVALID_COMPLETION");
      }
      if(active.token!==token || active.edge!==msg.edge || active.digest!==msg.payloadDigest || active.bytes!==msg.bytes)
        fail("GRAPH_INVALID_COMPLETION");
      s.active.delete(msg.delivery);
      s.usedBytes-=active.bytes;
      s.receipts.set(msg.delivery,active);
      return Object.freeze({status:"acked",delivery:msg.delivery});
    });
  }
  retire() {
    return this.critical(s=>{
      if(s.retired) return false;
      s.retired=true;s.active.clear();s.usedBytes=0;
      return true;
    });
  }
  status() { return this.critical(s=>Object.freeze({
    active:s.active.size,receipts:s.receipts.size,bytes:s.usedBytes,retired:s.retired
  }));}
}
function tensor(shape=[2,2],fanIn="one") {
  return {kind:"tensor",dtype:"f64",shape,layout:"row-major",fanIn};
}
function work(type="MipNode",fanIn="one") {return {kind:"job",type,fanIn};}
function graph(mode="dag") {
  return {mode,nodes:[
    {id:"input",op:mode==="worklist"?"SeedQueue":"Input",inputs:mode==="worklist"?{retry:work()}:{},outputs:{out:mode==="worklist"?work():tensor()}},
    {id:"compute",op:mode==="worklist"?"Relaxation":"Dense",inputs:{input:mode==="worklist"?work():tensor()},outputs:{out:mode==="worklist"?work():tensor()}},
    {id:"sink",op:mode==="worklist"?"Incumbent":"Loss",inputs:{input:mode==="worklist"?work():tensor()},outputs:{}}
  ],edges:[
    {id:"first",from:"input",fromPort:"out",to:"compute",toPort:"input",kind:"data",capacity:2},
    {id:"second",from:"compute",fromPort:"out",to:"sink",toPort:"input",kind:"data",capacity:2}
  ]};
}
const digest="a".repeat(64);
test("typed neural DAG accepts valid ordering, creates immutable canonical graph digest",()=>{
  const a=graph(), p=validateGraph(a);
  const reordered={...a,nodes:[...a.nodes].reverse(),edges:[...a.edges].reverse()};
  assert.equal(p.digest,validateGraph(reordered).digest);
  assert.deepEqual(p.order,["input","compute","sink"]);
  a.nodes[0].id="changed";
  a.nodes[0].outputs.out.shape[0]=8;
  assert.equal(p.nodes[0].id,"compute");
  assert.deepEqual(p.nodes[2].outputs.out.shape,[2,2]);
  assert(Object.isFrozen(p.nodes[0].outputs));
});
test("structural duplicate, unknown target, type mismatch and implicit many-to-one fail",()=>{
  const a=graph();a.nodes.push({...a.nodes[0]});
  assert.throws(()=>validateGraph(a),/GRAPH_DUPLICATE_NODE/);
  const b=graph();b.edges[0].to="ghost";
  assert.throws(()=>validateGraph(b),/GRAPH_UNKNOWN_NODE/);
  const c=graph();c.nodes[1].inputs.input.shape=[2,3];
  assert.throws(()=>validateGraph(c),/GRAPH_PORT_TYPE_MISMATCH/);
  const d=graph();d.edges.push({...d.edges[0],id:"third"});
  assert.throws(()=>validateGraph(d),/GRAPH_INPUT_MULTIPLE_PRODUCERS/);
  d.nodes[1].inputs.input.fanIn="many";
  assert.equal(validateGraph(d).edges.length,3);
});
test("data cycles fail closed; explicit bounded delay supports userland worklist recursion",()=>{
  const a=graph();a.nodes[0].inputs.retry=tensor();
  a.edges.push({id:"cycle",from:"compute",fromPort:"out",to:"input",toPort:"retry",kind:"data",capacity:2});
  assert.throws(()=>validateGraph(a),/GRAPH_UNDECLARED_CYCLE/);
  const b=graph("worklist");
  b.edges.push({id:"requeue",from:"compute",fromPort:"out",to:"input",toPort:"retry",kind:"feedback",capacity:2,delayTokens:1});
  assert.equal(validateGraph(b).mode,"worklist");
  b.edges[2].delayTokens=0;
  assert.throws(()=>validateGraph(b),/GRAPH_FEEDBACK_UNBOUNDED/);
  b.edges[2].delayTokens=1;b.mode="dag";
  assert.throws(()=>validateGraph(b),/GRAPH_FEEDBACK_IN_DAG/);
});
test("tensor shape overflow, rank and layout are rejected before buffer admission",()=>{
  const a=graph();a.nodes[1].inputs.input.shape=[Number.MAX_SAFE_INTEGER];
  assert.throws(()=>validateGraph(a),/GRAPH_INVALID_TENSOR_SHAPE/);
  const b=graph();b.nodes[1].outputs.out.layout="column-major";
  assert.throws(()=>validateGraph(b),/GRAPH_INVALID_LAYOUT/);
});
test("admission enforces immutable plan binding, incarnation, credits, receipt cap",()=>{
  const p=validateGraph(graph()), l=new DeliveryLedger(p,{maxItems:1,maxBytes:8,maxReceipts:2});
  const first={run:"r1",epoch:1,graph:p.digest,edge:"first",delivery:"delivery1",payloadDigest:digest,bytes:8};
  const token=l.admit(first).token;
  assert.throws(()=>l.admit({...first,delivery:"delivery2"}),/GRAPH_RESOURCE_BACKPRESSURE/);
  assert.throws(()=>l.admit({...first,epoch:2}),/GRAPH_STALE_DELIVERY/);
  assert.throws(()=>l.admit({...first,graph:"old"}),/GRAPH_STALE_DELIVERY/);
  assert.throws(()=>l.admit(first),/GRAPH_DUPLICATE_INFLIGHT/);
  assert.deepEqual(l.status(),{active:1,receipts:0,bytes:8,retired:false});
  assert.throws(()=>l.ack(first,Symbol("fake")) ,/GRAPH_INVALID_COMPLETION/);
  assert.equal(l.ack(first,token).status,"acked");
  assert.equal(l.ack(first,token).status,"already-acked");
  assert.equal(l.admit(first).status,"acked");
  assert.throws(()=>l.admit({...first,payloadDigest:"b".repeat(64)}),/GRAPH_REPLAY_TAMPERING/);
  const second={...first,delivery:"delivery2",bytes:5};
  const t=l.admit(second).token;
  l.ack(second,t);
  assert.throws(()=>l.admit({...first,delivery:"delivery3"}),/GRAPH_RECEIPT_BACKPRESSURE/);
  assert.deepEqual(l.status(),{active:0,receipts:2,bytes:0,retired:false});
});
test("cancel/retire refunds in-flight resources and rejects late receipts",()=>{
  const p=validateGraph(graph("worklist")),l=new DeliveryLedger(p);
  const m={run:"r1",epoch:1,graph:p.digest,edge:"first",delivery:"job1",payloadDigest:digest,bytes:12};
  const t=l.admit(m).token;
  assert.equal(l.retire(),true);
  assert.equal(l.retire(),false);
  assert.deepEqual(l.status(),{active:0,receipts:0,bytes:0,retired:true});
  assert.throws(()=>l.ack(m,t),/GRAPH_EPOCH_RETIRED/);
  assert.throws(()=>l.admit(m),/GRAPH_EPOCH_RETIRED/);
});
test("single state, synchronous critical, no state object escape",()=>{
  const l=new DeliveryLedger(validateGraph(graph()));
  assert.deepEqual(Object.keys(l).sort(),["_runtimeGateHeld","state"]);
  assert.throws(()=>l.critical(s=>s),/GRAPH_STATE_ESCAPE/);
  assert.throws(()=>l.critical(()=>l.critical(()=>1)),/GRAPH_STATE_REENTRANT/);
  assert.throws(()=>l.critical(()=>Promise.resolve()),/GRAPH_STATE_SUSPENDS/);
});
test("job edges cannot masquerade as tensor descriptors",()=>{
  const a=graph("worklist");a.nodes[1].inputs.input.dtype="f64";
  assert.throws(()=>validateGraph(a),/GRAPH_JOB_TENSOR_CONFUSION/);
  const b=graph("worklist");b.nodes[1].inputs.input.type="OtherNode";
  assert.throws(()=>validateGraph(b),/GRAPH_PORT_TYPE_MISMATCH/);
});


test("graph digest commits operator, optimizer attrs and nested values",()=>{
  const a=graph();a.nodes[1].attrs={lr:0.01,flags:{checkpoint:true}};
  const p=validateGraph(a);
  a.nodes[1].attrs.lr=4;
  assert.equal(p.nodes[0].attrs.flags.checkpoint,true);
  assert.notEqual(p.digest,validateGraph(a).digest);
  a.nodes[1].attrs.lr=0.01;a.nodes[1].op="Subtraction";
  assert.notEqual(p.digest,validateGraph(a).digest);
  a.nodes[1].attrs={lr:NaN};
  assert.throws(()=>validateGraph(a),/GRAPH_INVALID_ATTR/);
});
test("undeclared graph metadata cannot escape snapshot fingerprint",()=>{
  const a=graph();a.nodes[1].gpu="surprise";
  assert.throws(()=>validateGraph(a),/GRAPH_UNDECLARED_METADATA/);
  delete a.nodes[1].gpu;a.edges[0].transport="tcp";
  assert.throws(()=>validateGraph(a),/GRAPH_UNDECLARED_METADATA/);
});
test("each edge capacity applies even when global credit remains",()=>{
  const a=graph();a.edges[0].capacity=1;
  const p=validateGraph(a),l=new DeliveryLedger(p,{maxItems:3,maxBytes:100});
  const m={run:"r1",epoch:1,graph:p.digest,edge:"first",delivery:"one",payloadDigest:digest,bytes:1};
  const r=l.admit(m);
  assert.throws(()=>l.admit({...m,delivery:"two"}),/GRAPH_EDGE_BACKPRESSURE/);
  l.ack(m,r.token);
  assert.equal(l.admit({...m,delivery:"two"}).status,"admitted");
});
