// Additional negative-first, source-only TCP shared pool model tests.
// These are NOT native socket I/O, thread-race, or Oreslang guest evidence.
import { FrozenBytes, LeaseLedger, assert, deny } from "./tcp_shared_pool_model_v1.test.mjs";

const identity = (actor="a", incarnation=1, epoch=1) =>
  ({actor,inc:incarnation,epoch,tenant:"tenant",
    partition:"authority/tls/tenant",rights:"exchange"});
const fresh = (options={}) => {
  const pool = new LeaseLedger(options);
  pool.open();
  return pool;
};
let cases = 0;
function test(name, callback) {
  try { callback(); cases++; }
  catch (error) { throw new Error(name + ": " + error.message, {cause:error}); }
}
function check_invariants(pool) {
  const slot=pool.slot;
  assert(!!slot, "physical slot exists");
  assert(pool.descriptors >= 0 && pool.descriptors <= pool.maxDescriptors,
         "descriptor credits bounded");
  assert(slot.active === pool.descriptors,
         "pending descriptor and physical operation counts equal");
  assert(slot.leases.size === pool.tokens.size,
         "trusted token ledger matches leased slot membership");
  let active = 0;
  for (const [token, lease] of pool.tokens) {
    assert(slot.leases.has(token), "ledger contains same exact token object");
    assert(lease.generation === slot.generation, "no stale generation is live");
    assert(lease.active === true || lease.active === false);
    if (lease.active) active++;
  }
  assert(slot.active === active, "every physical operation has one live lease");
  if (pool.stopped) assert(slot.state==="draining" || slot.state==="retired",
         "shutdown must never leave a reusable connection");
  if (slot.state === "idle" || slot.state === "retired") {
    assert(slot.active === 0 && slot.leases.size === 0,
           "idle or retired slot cannot own a logical exchange");
  }
  if (slot.state === "leased") {
    assert(slot.leases.size > 0, "leased slot must have live capabilities");
  }
}
test("caller mutation cannot change a frozen slab", () => {
  const source=[10,20,30], slab=new FrozenBytes(source);
  source[1]=99;
  assert(slab.read_at(1)===20);
  assert(!Object.hasOwn(slab,"values"), "slab must not expose mutable backing array");
  deny(()=>slab.read_at(0.5),"invalid-read");
  deny(()=>slab.read_at(Number.MAX_SAFE_INTEGER),"invalid-read");
});
test("one stream cancellation retains other stream pins", () => {
  const p=fresh({multiplex:true,streams:2,descriptors:2});
  const a=p.acquire(identity()), b=p.acquire(identity("b"));
  const left=new FrozenBytes([10]), right=new FrozenBytes([20]);
  p.begin(a,identity(),left);p.begin(b,identity("b"),right);
  left.retire();right.retire();p.cancel(a,identity());
  assert(p.slot.state==="draining" && left.pins===1 && right.pins===1);
  p.complete(a);
  assert(left.freed && !right.freed && p.slot.state==="draining");
  p.complete(b);
  assert(right.freed && p.slot.state==="draining");
  p.trusted_revoke(b);
  assert(p.slot.state==="retired");
});
test("clean completion of one multiplexed stream preserves the other", () => {
  const p=fresh({multiplex:true,streams:2});
  const a=p.acquire(identity()),b=p.acquire(identity("b"));
  p.begin(a,identity());p.complete(a);p.release(a,identity());
  assert(p.slot.state==="leased" && p.slot.leases.size===1);
  p.begin(b,identity("b"));p.complete(b);p.release(b,identity("b"));
  assert(p.slot.state==="idle");
});
test("stale clean-release token cannot control next actor's lease", () => {
  const p=fresh(),a=p.acquire(identity());p.release(a,identity());
  const b=p.acquire(identity("b"));
  deny(()=>p.begin(a,identity()),"stale-token");
  p.begin(b,identity("b"));p.complete(b);p.release(b,identity("b"));
});
test("wrong actor cancellation must not poison legitimate lease", () => {
  const p=fresh(),a=p.acquire(identity());
  deny(()=>p.cancel(a,identity("b")),"wrong-actor");
  assert(p.slot.state==="leased");
  p.begin(a,identity());p.complete(a);p.release(a,identity());
  assert(p.slot.state==="idle");
});
test("wrong epoch cannot steal an existing stream's credits", () => {
  const p=fresh(),a=p.acquire(identity());
  deny(()=>p.acquire(identity("b",1,2)),"partition-denied");
  assert(p.slot.leases.size===1 && p.slot.state==="leased");
  p.release(a,identity());
});
test("repeated retirement cannot double-unpin", () => {
  const b=new FrozenBytes([0]);b.pin();b.retire();b.retire();
  assert(b.pins===1 && !b.freed);
  b.release_pin();b.retire();
  assert(b.freed && b.pins===0);
  deny(()=>b.release_pin(),"pin-underflow");
});
test("an existing pin may read after retire, new pins cannot", () => {
  const b=new FrozenBytes([5,6]);b.pin();b.retire();
  assert(b.read_at(0)===5);
  deny(()=>b.pin(),"revoked-buffer");
  b.release_pin();deny(()=>b.read_at(0),"invalid-read");
});
test("failed pin admission leaves descriptor credits untouched", () => {
  const p=fresh(),a=p.acquire(identity()),b=new FrozenBytes([2]);b.retire();
  deny(()=>p.begin(a,identity(),b),"revoked-buffer");
  assert(p.descriptors===0 && p.slot.active===0 && p.tokens.size===1);
  p.begin(a,identity());p.complete(a);p.release(a,identity());
  assert(p.slot.state==="idle");
});
test("multiplexed slot cannot recycle before final stream retirement", () => {
  const p=fresh({multiplex:true,streams:2});
  const a=p.acquire(identity()),b=p.acquire(identity("b"));
  p.begin(a,identity());p.cancel(a,identity());p.complete(a);
  assert(p.slot.state==="draining" && p.slot.leases.size===1);
  deny(()=>p.open(),"slot-not-retired");
  p.trusted_revoke(b);assert(p.slot.state==="retired");
  p.open();assert(p.slot.state==="idle" && p.generation===2);
});
test("shutdown waits for all three outstanding completions", () => {
  const p=fresh({multiplex:true,streams:3,descriptors:3});
  const ids=[identity(),identity("b"),identity("c")];
  const tokens=ids.map(who=>p.acquire(who));
  tokens.forEach((token,i)=>p.begin(token,ids[i]));
  p.shutdown();
  tokens.forEach(token=>p.trusted_revoke(token));
  assert(p.slot.state==="draining" && p.slot.active===3);
  tokens.forEach(token=>p.complete(token));
  assert(p.slot.state==="retired" && p.descriptors===0 && p.tokens.size===0);
});
test("policy revocation denies new work and stale releases", () => {
  const p=fresh(),a=p.acquire(identity());p.revoke_epoch(2);
  deny(()=>p.begin(a,identity()),"revoked");
  p.trusted_revoke(a);assert(p.slot.state==="retired");
  deny(()=>p.release(a,identity()),"stale-token");
});
function rng(seed) {
  let value=seed>>>0;
  return () => {
    value^=value<<13;value^=value>>>17;value^=value<<5;
    return value>>>0;
  };
}
test("stop forbids resurrection even after all reactor completions",()=>{
  const p=fresh({multiplex:true,streams:2});
  const a=p.acquire(identity()), b=p.acquire(identity("b"));
  p.begin(a,identity());p.begin(b,identity("b"));
  p.shutdown();
  p.trusted_revoke(a);p.trusted_revoke(b);
  p.complete(a);p.complete(b);
  check_invariants(p);
  assert(p.slot.state==="retired");
  deny(()=>p.open(),"pool-stopped");
  deny(()=>p.acquire(identity("c")),"pool-stopped");
  p.shutdown();check_invariants(p);
});
test("stop before dial is terminal and cannot allocate a lease",()=>{
  const p=new LeaseLedger();
  p.shutdown();
  deny(()=>p.open(),"pool-stopped");
  deny(()=>p.acquire(identity()),"pool-stopped");
});
// 64 deterministic schedules * 300 transitions. No wall-clock nondeterminism,
// no sleeps, no unbounded asynchronous work. Seeds make failures reproducible.
for (let seed=1;seed<=64;seed++) {
  test("interleaving seed " + seed, () => {
    const next=rng(seed), multiplex=(seed&1)===0;
    const p=fresh({multiplex,streams:multiplex?3:1,descriptors:2});
    let next_actor=0;
    for(let step=0;step<300;step++) {
      const operation=next()%9;
      const entries=Array.from(p.tokens);
      const entry=entries.length ? entries[next()%entries.length] : null;
      const token=entry?.[0],lease=entry?.[1];
      if (operation===0) {
        try { p.acquire(identity("actor-"+(++next_actor),1,p.epoch)); }
        catch (e) {
          assert(["exclusive-busy","stream-capacity","not-available","pool-stopped"]
            .includes(e.message), "unexpected acquisition failure: "+e.message);
        }
      } else if (operation===1 && lease && !lease.released
          && !lease.active && p.slot.state==="leased"
          && lease.identity.epoch===p.epoch) {
        try { p.begin(token,lease.identity); }
        catch(e) { assert(e.message==="queue-full",e.message); }
      } else if (operation===2 && lease?.active) {
        p.complete(token);
      } else if (operation===3 && lease && !lease.released
          && p.slot.state==="leased" && lease.identity.epoch===p.epoch) {
        p.release(token,lease.identity);
      } else if (operation===4 && lease && !lease.released
          && p.slot.state==="leased" && lease.identity.epoch===p.epoch) {
        p.cancel(token,lease.identity);
      } else if (operation===5 && lease) {
        p.trusted_revoke(token);
      } else if (operation===6 && (next()%19===0)) {
        p.revoke_epoch(p.epoch+1);
      } else if (operation===7 && p.slot.state==="retired" && !p.stopped) {
        p.open();
      } else if (operation===8 && (next()%41===0)) {
        p.shutdown();
      }
      check_invariants(p);
    }
    p.shutdown();
    for(const token of Array.from(p.tokens.keys())) p.trusted_revoke(token);
    for(const [token,lease] of Array.from(p.tokens)) {
      if(lease.active)p.complete(token);
    }
    check_invariants(p);
    assert(p.slot.state==="retired" && p.tokens.size===0
      && p.descriptors===0,"final physical quiescence");
  });
}
console.log("TCP shared pool additional scenarios passed:", cases,
            "(14 targeted + 64 seeded interleavings; 19,200 transitions)");
