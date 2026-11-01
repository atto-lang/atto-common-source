// Source-only reference state machine for the TCP shared pool v1 contract.
// NOT a production socket pool, concurrent host proof, or backend parity test.
// Execute with: node tests/tcp_shared_pool_model_v1.test.mjs
class FrozenBytes {
  // Frozen input is copied in this reference model. A production native
  // transport can use a proven frozen/pinned shared region instead.
  #values; #pins = 0; #retiring = false; #freed = false;
  constructor(values) { this.#values = Object.freeze(Array.from(values)); }
  get pins() { return this.#pins; }
  get freed() { return this.#freed; }
  pin() {
    if (this.#retiring || this.#freed) throw Error("revoked-buffer");
    if (this.#pins >= Number.MAX_SAFE_INTEGER) throw Error("pin-overflow");
    this.#pins++;
  }
  release_pin() {
    if (!this.#pins) throw Error("pin-underflow");
    this.#pins--;
    if (this.#retiring && !this.#pins) this.#freed = true;
  }
  retire() {
    this.#retiring = true;
    if (!this.#pins) this.#freed = true;
  }
  read_at(index) {
    if (this.#freed || !Number.isSafeInteger(index)
        || index < 0 || index >= this.#values.length) throw Error("invalid-read");
    return this.#values[index];
  }
}
class LeaseLedger {
  constructor({partition="authority/tls/tenant",tenant="tenant",epoch=1,multiplex=false,codec="raw-tcp",streams=1,descriptors=2}={}){
    // Raw TCP has no stream IDs or response demultiplexer. Multiplexing
    // must be approved by an actual trusted protocol codec.
    if(multiplex && !["http2","quic","framed-rpc"].includes(codec))
      throw Error("multiplex-codec-required");
    if(!multiplex && streams!==1)throw Error("exclusive-stream-capacity");
    this.codec=codec;
    this.partition=partition;this.tenant=tenant;this.epoch=epoch;this.multiplex=multiplex;
    this.streams=streams;this.maxDescriptors=descriptors;this.descriptors=0;this.generation=0;
    this.slot=null;this.tokens=new Map();this.stopped=false;
  }
  open(){
    if(this.stopped)throw Error("pool-stopped");
    if(this.slot && this.slot.state!=="retired")throw Error("slot-not-retired");
    if(this.generation===Number.MAX_SAFE_INTEGER)throw Error("generation-exhausted");
    this.slot={generation:++this.generation,state:"idle",active:0,leases:new Set(),epoch:this.epoch};
  }
  acquire(identity){
    if(this.stopped)throw Error("pool-stopped");
    const s=this.slot;
    if(!s || !["idle","leased"].includes(s.state))throw Error("not-available");
    if(identity.partition!==this.partition || identity.tenant!==this.tenant ||
       identity.epoch!==this.epoch || s.epoch!==this.epoch)throw Error("partition-denied");
    if(!this.multiplex && s.leases.size)throw Error("exclusive-busy");
    if(s.leases.size>=this.streams)throw Error("stream-capacity");
    const token=Object.freeze({});
    this.tokens.set(token,{identity:{...identity},generation:s.generation,active:false,released:false,buffer:null});
    s.leases.add(token);s.state="leased";return token;
  }
  validated(token,identity){
    const l=this.tokens.get(token),s=this.slot;
    if(!l || !s || l.generation!==s.generation || l.released)throw Error("stale-token");
    if(!identity || Object.keys(l.identity).some(k=>l.identity[k]!==identity[k]))throw Error("wrong-actor");
    if(s.state==="draining" || s.state==="retired" || l.identity.epoch!==this.epoch)throw Error("revoked");
    return l;
  }
  begin(token,identity,buffer=null){
    const l=this.validated(token,identity);
    if(l.active)throw Error("overlap");
    if(this.descriptors>=this.maxDescriptors)throw Error("queue-full");
    if(buffer)buffer.pin();
    l.active=true;l.buffer=buffer;this.slot.active++;this.descriptors++;
  }
  complete(token){
    const l=this.tokens.get(token);
    if(!l || !l.active)throw Error("duplicate-completion");
    l.active=false;this.slot.active--;this.descriptors--;
    if(l.buffer)l.buffer.release_pin();
    l.buffer=null;
    if(l.released)this.drop(token);
  }
  release(token,identity){
    const l=this.validated(token,identity);
    l.released=true;
    if(l.active)this.slot.state="draining";
    else this.drop(token);
  }
  cancel(token,identity){
    const l=this.validated(token,identity);
    l.released=true;this.slot.state="draining";
    if(!l.active)this.drop(token);
  }
  // Called only after the TRUSTED protocol engine proves stream-reset
  // completion and all physical writes/reads are quiescent for this stream.
  // Actor caller bits must never supply the proof themselves.
  complete_stream_reset(token,identity,proof){
    const l=this.validated(token,identity);
    if(!this.multiplex || !["http2","quic"].includes(this.codec)
        || proof!=="trusted-reset-complete" || l.active)
      throw Error("stream-reset-unproven");
    l.released=true;
    this.drop(token);
  }
  trusted_revoke(token){
    const l=this.tokens.get(token);
    if(!l)throw Error("stale-token");
    l.released=true;this.slot.state="draining";
    if(!l.active)this.drop(token);
  }
  drop(token){this.tokens.delete(token);this.slot.leases.delete(token);this.settle();}
  settle(){
    if(this.slot.state==="draining" && !this.slot.active && !this.slot.leases.size)this.slot.state="retired";
    else if(this.slot.state==="leased" && !this.slot.leases.size)this.slot.state="idle";
  }
  revoke_epoch(epoch){
    if(epoch<=this.epoch)throw Error("epoch-not-monotonic");
    this.epoch=epoch;
    if(this.slot && this.slot.state!=="retired"){this.slot.state="draining";this.settle();}
  }
  shutdown(){
    this.stopped=true;
    if(this.slot && this.slot.state!=="retired"){
      this.slot.state="draining";
      this.settle();
    }
  }
}
function assert(condition,msg="failed assertion"){if(!condition)throw Error(msg);}
function deny(fn,message){let seen;try{fn();}catch(e){seen=e.message;}assert(seen===message,`wanted ${message}, saw ${seen}`);}
function run_tests(){
  let count=0;
  const identity=(actor="actor-a",inc=1,tenant="tenant",epoch=1)=>({actor,inc,tenant,epoch,partition:"authority/tls/tenant",rights:"exchange"});
  const fresh=(config={})=>{const p=new LeaseLedger(config);p.open();return p;};
  const test=(name,fn)=>{fn();count++;};
  test("one raw TCP lease at a time",()=>{
    const p=fresh(),a=p.acquire(identity());deny(()=>p.acquire(identity("actor-b")),"exclusive-busy");
    p.release(a,identity());assert(p.slot.state==="idle");p.release(p.acquire(identity("actor-b")),identity("actor-b"));
  });
  test("multiplex requires explicit configuration and separate stream slots",()=>{
    const p=fresh({multiplex:true,codec:"http2",streams:2}),a=p.acquire(identity()),b=p.acquire(identity("actor-b"));
    deny(()=>p.acquire(identity("actor-c")),"stream-capacity");p.release(a,identity());p.release(b,identity("actor-b"));
  });
  test("forged token rejected",()=>{
    const p=fresh(),a=p.acquire(identity());deny(()=>p.begin(Object.freeze({}),identity()),"stale-token");p.release(a,identity());
  });
  test("cross-pool token rejected",()=>{
    const a=fresh(),b=fresh(),token=a.acquire(identity());deny(()=>b.begin(token,identity()),"stale-token");a.release(token,identity());
  });
  test("foreign actor cannot use or release capability",()=>{
    const p=fresh(),a=p.acquire(identity());deny(()=>p.begin(a,identity("actor-b")),"wrong-actor");
    deny(()=>p.release(a,identity("actor-b")),"wrong-actor");p.release(a,identity());
  });
  test("actor incarnation fences after restart",()=>{
    const p=fresh(),a=p.acquire(identity());deny(()=>p.begin(a,identity("actor-a",2)),"wrong-actor");p.release(a,identity());
  });
  test("tenant and partition cannot share authenticated sockets",()=>{
    const p=fresh();deny(()=>p.acquire(identity("b",1,"tenant-2")),"partition-denied");
    deny(()=>p.acquire({...identity(),partition:"other-origin"}),"partition-denied");
    assert(p.slot.leases.size===0);
  });
  test("same logical lease cannot overlap physical IO",()=>{
    const p=fresh(),a=p.acquire(identity());p.begin(a,identity());
    deny(()=>p.begin(a,identity()),"overlap");p.complete(a);p.release(a,identity());assert(p.slot.state==="idle");
  });
  test("full descriptor ring denies without blocking or pinning",()=>{
    const p=fresh({multiplex:true,codec:"http2",streams:2,descriptors:1}),a=p.acquire(identity()),b=p.acquire(identity("b"));
    const buf=new FrozenBytes([3]);p.begin(a,identity(),buf);
    deny(()=>p.begin(b,identity("b"),buf),"queue-full");assert(buf.pins===1);
    p.complete(a);p.begin(b,identity("b"));p.complete(b);p.release(a,identity());p.release(b,identity("b"));
  });
  test("release during IO poisons and pins physical slot",()=>{
    const p=fresh(),a=p.acquire(identity());p.begin(a,identity());p.release(a,identity());
    assert(p.slot.state==="draining");deny(()=>p.acquire(identity("b")),"not-available");
    p.complete(a);assert(p.slot.state==="retired");
  });
  test("cancel in-flight unpins only on reactor completion",()=>{
    const p=fresh(),a=p.acquire(identity()),buf=new FrozenBytes([42]);
    p.begin(a,identity(),buf);buf.retire();p.cancel(a,identity());
    assert(!buf.freed && buf.pins===1 && p.slot.state==="draining");
    p.complete(a);assert(buf.freed && p.slot.state==="retired");
  });
  test("cancel before IO revokes and retires immediately",()=>{
    const p=fresh(),a=p.acquire(identity());p.cancel(a,identity());assert(p.slot.state==="retired");
    deny(()=>p.begin(a,identity()),"stale-token");
  });
  test("physical slot generation prevents ABA",()=>{
    const p=fresh(),a=p.acquire(identity()),old=p.generation;p.cancel(a,identity());p.open();
    assert(p.generation===old+1);deny(()=>p.begin(a,identity()),"stale-token");
  });
  test("revoked policy prevents stale borrow and new physical reuses epoch",()=>{
    const p=fresh();p.revoke_epoch(2);assert(p.slot.state==="retired");p.open();
    deny(()=>p.acquire(identity()),"partition-denied");
    const id=identity("actor-a",1,"tenant",2);p.release(p.acquire(id),id);
  });
  test("epoch change while in-flight cannot cause premature reuse",()=>{
    const p=fresh(),a=p.acquire(identity());p.begin(a,identity());p.revoke_epoch(2);
    deny(()=>p.begin(a,identity()),"revoked");p.complete(a);
    assert(p.slot.state==="draining");p.trusted_revoke(a);assert(p.slot.state==="retired");
  });
  test("shutdown with active IO defers final physical close",()=>{
    const p=fresh(),a=p.acquire(identity());p.begin(a,identity());p.shutdown();
    assert(p.slot.state==="draining");p.trusted_revoke(a);assert(p.slot.state==="draining");
    p.complete(a);assert(p.slot.state==="retired");
  });
  test("duplicate completion and double release rejected",()=>{
    const p=fresh(),a=p.acquire(identity());p.begin(a,identity());p.complete(a);
    deny(()=>p.complete(a),"duplicate-completion");p.release(a,identity());deny(()=>p.release(a,identity()),"stale-token");
  });
  test("shared frozen byte lifetime requires all pins to unwind",()=>{
    const b=new FrozenBytes([1,2,3]);b.pin();b.pin();b.retire();
    assert(b.read_at(2)===3 && !b.freed && typeof b.write==="undefined");
    b.release_pin();assert(!b.freed);b.release_pin();assert(b.freed);
    deny(()=>b.read_at(0),"invalid-read");deny(()=>b.pin(),"revoked-buffer");deny(()=>b.release_pin(),"pin-underflow");
  });
  test("stale mutable buffer cannot be pinned for fresh IO",()=>{
    const p=fresh(),a=p.acquire(identity()),b=new FrozenBytes([5]);b.retire();
    deny(()=>p.begin(a,identity(),b),"revoked-buffer");assert(p.descriptors===0 && p.slot.active===0);p.release(a,identity());
  });
  test("generation counter must not wrap",()=>{
    const p=fresh(),a=p.acquire(identity());p.cancel(a,identity());p.generation=Number.MAX_SAFE_INTEGER;deny(()=>p.open(),"generation-exhausted");
  });
  test("policy epoch must increase monotonically",()=>{
    const p=fresh();deny(()=>p.revoke_epoch(1),"epoch-not-monotonic");
  });
  test("shutdown cannot resurrect retired physical slots",()=>{
    const p=fresh(),a=p.acquire(identity());
    p.shutdown();p.trusted_revoke(a);
    assert(p.slot.state==="retired" && p.stopped);
    deny(()=>p.open(),"pool-stopped");
    deny(()=>p.acquire(identity()),"pool-stopped");
    p.shutdown();assert(p.slot.state==="retired");
  });
  test("shutdown before physical creation permanently rejects dial",()=>{
    const p=new LeaseLedger();p.shutdown();
    deny(()=>p.open(),"pool-stopped");
    deny(()=>p.acquire(identity()),"pool-stopped");
  });
  test("raw TCP can never opt into arbitrary stream multiplexing",()=>{
    deny(()=>new LeaseLedger({multiplex:true,codec:"raw-tcp",streams:2}),
      "multiplex-codec-required");
    deny(()=>new LeaseLedger({multiplex:true,streams:2}),
      "multiplex-codec-required");
    deny(()=>new LeaseLedger({multiplex:false,streams:2}),
      "exclusive-stream-capacity");
  });
  test("protocol-reset receipt is mandatory for safe independent stream cancel",()=>{
    const p=fresh({multiplex:true,codec:"http2",streams:2});
    const a=p.acquire(identity()),b=p.acquire(identity("actor-b"));
    deny(()=>p.complete_stream_reset(a,identity(),null),"stream-reset-unproven");
    deny(()=>p.complete_stream_reset(a,identity("actor-b"),
      "trusted-reset-complete"),"wrong-actor");
    assert(p.slot.leases.size===2 && p.slot.state==="leased");
    p.complete_stream_reset(a,identity(),"trusted-reset-complete");
    assert(p.slot.state==="leased" && p.slot.leases.size===1);
    p.begin(b,identity("actor-b"));p.complete(b);
    p.release(b,identity("actor-b"));
    assert(p.slot.state==="idle");
  });
  test("in-flight partial stream reset cannot release the socket prematurely",()=>{
    const p=fresh({multiplex:true,codec:"http2",streams:2});
    const a=p.acquire(identity()),b=p.acquire(identity("actor-b"));
    p.begin(a,identity());
    deny(()=>p.complete_stream_reset(a,identity(),
      "trusted-reset-complete"),"stream-reset-unproven");
    p.complete(a);
    p.complete_stream_reset(a,identity(),"trusted-reset-complete");
    assert(p.slot.state==="leased" && p.slot.leases.size===1);
    p.release(b,identity("actor-b"));
    assert(p.slot.state==="idle");
  });
  test("quic stream cancellation requires trusted reset just like http2",()=>{
    const p=fresh({multiplex:true,codec:"quic",streams:2});
    const a=p.acquire(identity());
    deny(()=>p.complete_stream_reset(a,identity(),"guest-fabricated"),
      "stream-reset-unproven");
    p.complete_stream_reset(a,identity(),"trusted-reset-complete");
    assert(p.slot.state==="idle");
  });
  test("framed RPC remains fail-closed without independent reset proof",()=>{
    const p=fresh({multiplex:true,codec:"framed-rpc",streams:2});
    const a=p.acquire(identity());
    deny(()=>p.complete_stream_reset(a,identity(),"trusted-reset-complete"),
      "stream-reset-unproven");
    p.cancel(a,identity());
    assert(p.slot.state==="retired");
  });
  return count;
}
export { FrozenBytes, LeaseLedger, assert, deny, run_tests };
console.log("TCP shared pool model scenarios passed:", run_tests());
