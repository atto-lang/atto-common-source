// Portable, source-only oracle for trusted immutable TCP payload slab admission.
// NOT compiled Oreslang, physical sockets, cross-thread proof, or native parity.
// All identities below are trusted-runtime attestations, never guest assertions.
class SlabRegistry {
  #pool = Object.freeze({});
  #records = new WeakMap();
  #pins = new WeakMap();
  #slots;
  #nextGeneration = 0;
  #usedBytes = 0;
  #pinnedBytes = 0;
  #livePins = 0;
  constructor({slots=2, totalBytes=32, slabBytes=16, pinnedBytes=48, maxPins=4}={}) {
    for (const [name,value] of Object.entries({slots,totalBytes,slabBytes,pinnedBytes,maxPins})) {
      if (!Number.isSafeInteger(value) || value < 1) throw Error('invalid-limit:'+name);
    }
    if (slabBytes > totalBytes) throw Error('slab-exceeds-total');
    this.limits = Object.freeze({slots,totalBytes,slabBytes,pinnedBytes,maxPins});
    this.#slots = Array.from({length:slots}, () => null);
  }
  get accounting() {
    return Object.freeze({usedBytes:this.#usedBytes,pinnedBytes:this.#pinnedBytes,
      livePins:this.#livePins,liveSlabs:this.#slots.filter(Boolean).length});
  }
  static identity(value) {
    if (!value || typeof value !== 'object' ||
      typeof value.actor !== 'string' || !value.actor ||
      !Number.isSafeInteger(value.incarnation) || value.incarnation < 1 ||
      typeof value.domain !== 'string' || !value.domain ||
      typeof value.tenant !== 'string' || !value.tenant)
      throw Error('unattested-identity');
    return Object.freeze({actor:value.actor,incarnation:value.incarnation,
      domain:value.domain,tenant:value.tenant});
  }
  static same(a,b) {
    return a.actor===b.actor && a.incarnation===b.incarnation &&
      a.domain===b.domain && a.tenant===b.tenant;
  }
  #record(handle) {
    const record = this.#records.get(handle);
    if (!record || record.pool !== this.#pool || record.state === 'freed' ||
      this.#slots[record.slot] !== record)
      throw Error('stale-slab');
    return record;
  }
  publish(bytes, attestedProducer) {
    const owner=SlabRegistry.identity(attestedProducer);
    // Bounds before copy: reject iterables, shared backing, sparse arrays,
    // non-byte values and unbounded length supplied by a guest.
    if (!Array.isArray(bytes) || !Number.isSafeInteger(bytes.length) ||
      bytes.length > this.limits.slabBytes || !bytes.length)
      throw Error('invalid-slab-length');
    // Read each own DATA descriptor exactly once. A getter can return a
    // valid octet during validation and an object or changed value when
    // Array.from reads it again. Never execute guest accessors here and
    // never validate different bytes than the ones actually published.
    const snapshot=[];
    for (let i=0;i<bytes.length;i++) {
      const descriptor=Object.getOwnPropertyDescriptor(bytes,i);
      if (!descriptor || !Object.hasOwn(descriptor,'value') ||
        !Number.isInteger(descriptor.value) ||
        descriptor.value < 0 || descriptor.value > 255)
        throw Error('invalid-slab-byte');
      snapshot.push(descriptor.value);
    }
    if (snapshot.length > this.limits.totalBytes - this.#usedBytes)
      throw Error('slab-byte-budget');
    const slot=this.#slots.findIndex(entry=>entry===null);
    if (slot<0) throw Error('slab-slot-budget');
    if (this.#nextGeneration === Number.MAX_SAFE_INTEGER)
      throw Error('slab-generation-exhausted');
    const handle=Object.freeze({});
    const record={pool:this.#pool,slot,generation:++this.#nextGeneration,
      owner,bytes:Object.freeze(snapshot),state:'published',pins:0,handle};
    this.#slots[slot]=record;
    this.#records.set(handle,record);
    this.#usedBytes+=record.bytes.length;
    return handle;
  }
  pin(handle, attestedReader, offset=0, length) {
    const record=this.#record(handle);
    const reader=SlabRegistry.identity(attestedReader);
    if (record.state!=='published') throw Error('slab-retiring');
    if (record.owner.domain!==reader.domain || record.owner.tenant!==reader.tenant)
      throw Error('slab-domain-denied');
    if (length===undefined) length=record.bytes.length-offset;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset<0 || length<1 || offset>record.bytes.length ||
      length>record.bytes.length-offset) throw Error('invalid-slice');
    if (this.#livePins>=this.limits.maxPins) throw Error('pin-count-budget');
    if (length>this.limits.pinnedBytes-this.#pinnedBytes)
      throw Error('pin-byte-budget');
    const receipt=Object.freeze({});
    this.#pins.set(receipt,{pool:this.#pool,record,generation:record.generation,
      reader,offset,length,active:true});
    record.pins++;this.#livePins++;this.#pinnedBytes+=length;
    return receipt;
  }
  #activePin(handle,receipt,attestedReader) {
    const record=this.#record(handle);
    const pin=this.#pins.get(receipt);
    const reader=SlabRegistry.identity(attestedReader);
    if (!pin || !pin.active || pin.pool!==this.#pool ||
      pin.record!==record || pin.generation!==record.generation ||
      !SlabRegistry.same(pin.reader,reader)) throw Error('pin-access-denied');
    return pin;
  }
  read_at(handle,receipt,attestedReader,index) {
    const pin=this.#activePin(handle,receipt,attestedReader);
    if (!Number.isSafeInteger(index) || index<0 || index>=pin.length)
      throw Error('slice-bounds');
    return pin.record.bytes[pin.offset+index];
  }
  release_pin(handle,receipt,attestedReader) {
    const pin=this.#activePin(handle,receipt,attestedReader);
    pin.active=false;
    pin.record.pins--;this.#livePins--;this.#pinnedBytes-=pin.length;
    this.#finalize(pin.record);
  }
  retire(handle,attestedProducer) {
    const record=this.#record(handle);
    if (!SlabRegistry.same(record.owner,SlabRegistry.identity(attestedProducer)))
      throw Error('slab-owner-denied');
    record.state='retiring';
    this.#finalize(record);
  }
  #finalize(record) {
    if (record.state!=='retiring' || record.pins!==0) return;
    // Host must wait for I/O completion/physical release BEFORE calling retire.
    this.#usedBytes-=record.bytes.length;
    record.bytes=null;record.state='freed';
    this.#slots[record.slot]=null;
    this.#records.delete(record.handle);
  }
}
function assert(ok,msg='assertion-failed') {if(!ok) throw Error(msg);}
function deny(callback,expected) {let got;try{callback();}catch(e){got=e.message;}
  assert(got===expected,'expected '+expected+', got '+got);}
let passed=0;
function test(name,callback) {try{callback();passed++;}
  catch(e){throw new Error(name+': '+e.message,{cause:e});}}
const person=(actor='a',incarnation=1,tenant='t',domain='shared') =>
  ({actor,incarnation,tenant,domain});
const a=person(), b=person('b'), foreign=person('f',1,'other');
const fresh=limits=>new SlabRegistry(limits);
test('accessor-backed array cannot smuggle a mutable byte after validation',()=>{
  const r=fresh(),input=[1,2];
  let calls=0;
  Object.defineProperty(input,0,{configurable:true,enumerable:true,
    get(){calls++;return calls===1?42:{mutable:true};}});
  deny(()=>r.publish(input,a),'invalid-slab-byte');
  assert(calls===0 && r.accounting.usedBytes===0 &&
    r.accounting.liveSlabs===0,'untrusted getter was never invoked');
});
test('snapshot contains precisely the validated own data descriptors',()=>{
  const r=fresh(),input=[4,5,6];
  const h=r.publish(input,a),p=r.pin(h,b);
  input[0]=7;input[1]=8;input[2]=9;
  assert(r.read_at(h,p,b,0)===4 && r.read_at(h,p,b,1)===5 &&
    r.read_at(h,p,b,2)===6,'snapshot cannot be mutated by producer');
  r.release_pin(h,p,b);r.retire(h,a);
  assert(r.accounting.usedBytes===0);
});
test('inherited sparse indexes are not accepted as guest-owned bytes',()=>{
  const r=fresh(),array=new Array(2);
  array[0]=1;
  Object.setPrototypeOf(array,{1:2});
  deny(()=>r.publish(array,a),'invalid-slab-byte');
  assert(r.accounting.liveSlabs===0);
});
test('publication always copies producer bytes',()=>{
  const r=fresh(),src=[1,2,3],h=r.publish(src,a);src[1]=77;
  const pin=r.pin(h,b);assert(r.read_at(h,pin,b,1)===2);
  r.release_pin(h,pin,b);r.retire(h,a);
});
test('private source cannot be recovered by guest object reflection',()=>{
  const r=fresh(),h=r.publish([4,5],a),pin=r.pin(h,a);
  assert(Object.keys(h).length===0 && Object.keys(pin).length===0);
  deny(()=>r.read_at(h,Object.freeze({}),a,0),'pin-access-denied');
  r.release_pin(h,pin,a);r.retire(h,a);
});
test('foreign tenant and domain cannot pin or steal bytes',()=>{
  const r=fresh(),h=r.publish([8,9],a);
  deny(()=>r.pin(h,foreign),'slab-domain-denied');
  deny(()=>r.pin(h,person('x',1,'t','other-domain')),'slab-domain-denied');
  assert(r.accounting.livePins===0);r.retire(h,a);
});
test('actor incarnation is checked on every read and unpin',()=>{
  const r=fresh(),h=r.publish([9],a),pin=r.pin(h,b);
  deny(()=>r.read_at(h,pin,person('b',2),0),'pin-access-denied');
  deny(()=>r.release_pin(h,pin,person('b',2)),'pin-access-denied');
  assert(r.accounting.livePins===1);
  r.release_pin(h,pin,b);r.retire(h,a);
});
test('actor id is checked even within the same tenant',()=>{
  const r=fresh(),h=r.publish([2],a),pin=r.pin(h,b);
  deny(()=>r.read_at(h,pin,a,0),'pin-access-denied');
  r.release_pin(h,pin,b);r.retire(h,a);
});
test('slice offset and length isolate unrelated bytes',()=>{
  const r=fresh(),h=r.publish([1,2,3,4],a),pin=r.pin(h,a,1,2);
  assert(r.read_at(h,pin,a,0)===2 && r.read_at(h,pin,a,1)===3);
  deny(()=>r.read_at(h,pin,a,2),'slice-bounds');
  deny(()=>r.read_at(h,pin,a,-1),'slice-bounds');
  r.release_pin(h,pin,a);r.retire(h,a);
});
test('invalid slices never reserve any pin credits',()=>{
  const r=fresh(),h=r.publish([1,2],a);
  for(const args of [[-1,1],[0,0],[0,3],[3,1],[0,1.5],[Number.MAX_SAFE_INTEGER,1]])
    deny(()=>r.pin(h,a,...args),'invalid-slice');
  assert(r.accounting.livePins===0 && r.accounting.pinnedBytes===0);
  r.retire(h,a);
});
test('pin quotas charge per slice and recover on exact receipt release',()=>{
  const r=fresh({pinnedBytes:3}),h=r.publish([1,2,3,4],a);
  const p=r.pin(h,a,0,2);
  deny(()=>r.pin(h,b,1,2),'pin-byte-budget');
  const q=r.pin(h,b,0,1);
  assert(r.accounting.pinnedBytes===3);
  r.release_pin(h,p,a);assert(r.accounting.pinnedBytes===1);
  r.release_pin(h,q,b);r.retire(h,a);
});
test('pin count quota is independent of byte quota',()=>{
  const r=fresh({maxPins:1}),h=r.publish([1,2],a),p=r.pin(h,a,0,1);
  deny(()=>r.pin(h,b,1,1),'pin-count-budget');
  r.release_pin(h,p,a);r.retire(h,a);
});
test('retirement prohibits fresh pins but existing reader survives',()=>{
  const r=fresh(),h=r.publish([1,2],a),p=r.pin(h,b);
  r.retire(h,a);deny(()=>r.pin(h,a),'slab-retiring');
  assert(r.read_at(h,p,b,0)===1 && r.accounting.usedBytes===2);
  r.release_pin(h,p,b);assert(r.accounting.usedBytes===0);
  deny(()=>r.pin(h,a),'stale-slab');
});
test('last reader releases storage exactly once',()=>{
  const r=fresh(),h=r.publish([1,2,3],a),p=r.pin(h,a),q=r.pin(h,b);
  r.retire(h,a);r.release_pin(h,p,a);
  assert(r.accounting.usedBytes===3 && r.accounting.livePins===1);
  deny(()=>r.read_at(h,p,a,0),'pin-access-denied');
  r.release_pin(h,q,b);
  assert(r.accounting.usedBytes===0 && r.accounting.livePins===0);
  deny(()=>r.release_pin(h,p,a),'stale-slab');
});
test('retirement cannot be performed by another producer',()=>{
  const r=fresh(),h=r.publish([1],a);
  deny(()=>r.retire(h,b),'slab-owner-denied');
  assert(r.accounting.usedBytes===1);r.retire(h,a);
});
test('stale receipt cannot read a recycled slot',()=>{
  const r=fresh({slots:1}),h=r.publish([4],a),p=r.pin(h,a);
  r.release_pin(h,p,a);r.retire(h,a);
  const next=r.publish([7],a),q=r.pin(next,a);
  deny(()=>r.read_at(next,p,a,0),'pin-access-denied');
  deny(()=>r.read_at(h,p,a,0),'stale-slab');
  assert(r.read_at(next,q,a,0)===7);
  r.release_pin(next,q,a);r.retire(next,a);
});
test('foreign registry receipts and handles are not authority',()=>{
  const r=fresh(),s=fresh(),h=r.publish([3],a),other=s.publish([8],a),p=r.pin(h,a);
  deny(()=>s.read_at(other,p,a,0),'pin-access-denied');
  deny(()=>r.read_at(other,p,a,0),'stale-slab');
  r.release_pin(h,p,a);r.retire(h,a);s.retire(other,a);
});
test('strict bytes reject floats, NaNs, sparse, negatives and >255',()=>{
  const r=fresh();
  for(const bytes of [[1.5],[NaN],[-1],[256],new Array(2),[undefined],[]]) {
    deny(()=>r.publish(bytes,a),bytes.length?'invalid-slab-byte':'invalid-slab-length');
  }
  assert(r.accounting.usedBytes===0);
});
test('oversize and untrusted iterables fail before copying',()=>{
  const r=fresh({slabBytes:3});
  deny(()=>r.publish([1,2,3,4],a),'invalid-slab-length');
  deny(()=>r.publish(new Uint8Array([1,2]),a),'invalid-slab-length');
  deny(()=>r.publish({[Symbol.iterator]:function*(){while(true)yield 5;}},a),'invalid-slab-length');
});
test('slab live-byte budget is not per-writer and includes retired pins',()=>{
  const r=fresh({slots:3,totalBytes:5,slabBytes:5});
  const h=r.publish([1,2,3,4],a),p=r.pin(h,a);
  r.retire(h,a);deny(()=>r.publish([5,6],b),'slab-byte-budget');
  r.release_pin(h,p,a);
  const next=r.publish([5,6],b);r.retire(next,b);
});
test('slot exhaustion cannot overwrite pinned old storage',()=>{
  const r=fresh({slots:1}),h=r.publish([1],a),p=r.pin(h,a);
  r.retire(h,a);deny(()=>r.publish([2],b),'slab-slot-budget');
  r.release_pin(h,p,a);const next=r.publish([2],b);r.retire(next,b);
});
test('private generation counter is not exposed as guest state',()=>{
  const r=fresh();
  // Private generation counter is deliberately inaccessible to guest code.
  assert(!Object.hasOwn(r,'nextGeneration'));
  assert(r.accounting.usedBytes===0);
});
test('invalid unattested identities never mutate accounting',()=>{
  const r=fresh(),h=r.publish([2],a);
  for(const identity of [null,{},person('b',0),person('',1),person('b',1,'')])
    deny(()=>r.pin(h,identity),'unattested-identity');
  assert(r.accounting.livePins===0);r.retire(h,a);
});
test('repeated retire while pinned never underflows',()=>{
  const r=fresh(),h=r.publish([1,2],a),p=r.pin(h,a);
  r.retire(h,a);r.retire(h,a);
  assert(r.accounting.usedBytes===2);r.release_pin(h,p,a);
  assert(r.accounting.usedBytes===0);
});
test('read and release reject replay after prior pin completion',()=>{
  const r=fresh(),h=r.publish([7],a),p=r.pin(h,a);
  r.release_pin(h,p,a);
  deny(()=>r.read_at(h,p,a,0),'pin-access-denied');
  deny(()=>r.release_pin(h,p,a),'pin-access-denied');
  assert(r.accounting.pinnedBytes===0 && r.accounting.livePins===0);
  r.retire(h,a);
});
// Deterministic permutations of independent readers / retirement order.
for(let seed=1;seed<=32;seed++){
  test('reader retirement schedule '+seed,()=>{
    const r=fresh({slots:1,maxPins:4,pinnedBytes:64,slabBytes:16,totalBytes:16});
    const h=r.publish([1,2,3,4],a),items=[];
    for(let i=0;i<4;i++){
      const who=person('actor-'+i,seed);
      items.push({who,receipt:r.pin(h,who,i,1)});
    }
    r.retire(h,a);
    let n=seed;
    while(items.length){n=(Math.imul(n,1664525)+1013904223)>>>0;
      const j=n%items.length,entry=items.splice(j,1)[0];
      assert(r.read_at(h,entry.receipt,entry.who,0)===1+Number(entry.who.actor.slice(6)));
      r.release_pin(h,entry.receipt,entry.who);
      assert(r.accounting.livePins===items.length);
    }
    assert(r.accounting.usedBytes===0 && r.accounting.pinnedBytes===0);
  });
}
console.log('TCP readonly slab registry source-only scenarios passed:',passed);
