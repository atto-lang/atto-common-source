import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ActorArenaOracle, DenseRegionOracle, LAYOUTS} from '../scripts/actor-memory-layout-v1.mjs';

const rejects = (f) => assert.throws(f, /^Error: ACTOR_MEMORY_V1:/);

test('accessor-backed input is rejected without partially changing a row', () => {
  const actor = new ActorArenaOracle('actor', 1, 1024);
  const region = new DenseRegionOracle(actor,['x','y'],4);
  const id = region.insert([1,2]);
  const input = [9,10];
  Object.defineProperty(input,'1',{get(){throw new Error('untrusted code ran');}});
  rejects(() => region.write(id, input));
  assert.deepEqual(region.read(id), [1,2]);
  rejects(() => region.insert(input));
  assert.equal(region.length, 1);
  assert.deepEqual(region.read(id), [1,2]);
  region.close();
});

test('sparse arrays and inherited element values fail closed', () => {
  const actor = new ActorArenaOracle('actor', 1, 1024);
  const region = new DenseRegionOracle(actor,['x','y'],4);
  const id = region.insert([3,4]);
  const sparse = [7,,];
  rejects(() => region.write(id,sparse));
  const inherited = [5,,];
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), {'1':6}));
  rejects(() => region.write(id,inherited));
  assert.deepEqual(region.read(id),[3,4]);
  region.close();
});

test('descriptor traps cannot reenter a mutable region or alter the pending mutation', () => {
  const a = new ActorArenaOracle('a',1,1024);
  const r = new DenseRegionOracle(a,['x','y'],6);
  const h = r.insert([1,2]);
  const adversarial = new Proxy([9,8], {
    getOwnPropertyDescriptor(target,prop) {
      if (prop === '1') r.write(h,[77,88]);
      return Reflect.getOwnPropertyDescriptor(target,prop);
    }
  });
  rejects(() => r.write(h,adversarial));
  assert.deepEqual(r.read(h),[1,2]);
  // State must also recover to allow a later valid write.
  r.write(h,[5,6]);
  assert.deepEqual(r.read(h),[5,6]);
  r.close();
});

test('borrowed conversion never temporarily consumes actor allocation quota', () => {
  const a = new ActorArenaOracle('a',1,2048);
  const r = new DenseRegionOracle(a,['x','y'],8,'aosoa',4);
  const h = r.insert([17,19]);
  const lease = r.borrowRead();
  const used = a.used;
  const epoch = r.epoch;
  const allocate = a.allocate.bind(a);
  let transientAllocations = 0;
  a.allocate = (...args) => { transientAllocations++; return allocate(...args); };
  for (const target of LAYOUTS.filter(x => x!=='aosoa')) {
    rejects(() => r.changeLayout(target));
    assert.equal(a.used, used);
    assert.equal(r.epoch,epoch);
    assert.equal(r.physicalLayout,'aosoa');
  }
  assert.equal(transientAllocations,0);
  r.releaseRead(lease);
  r.changeLayout('soa');
  assert.deepEqual(r.read(h),[17,19]);
  r.close();
  assert.equal(a.used,0);
});

test('live issued authority counts are bounded independently of guest bytes', () => {
  const a = new ActorArenaOracle('a',1,8192);
  const handles = Array.from({length:4096},()=>a.allocate(1));
  assert.equal(a.used,4096);
  rejects(()=>a.allocate(1));
  for (const h of handles) a.free(h);
  const h = a.allocate(1);
  const leases = Array.from({length:4096},()=>a.borrowRead(h));
  rejects(()=>a.borrowRead(h));
  leases.forEach(x=>a.releaseLoan(x));
  const pins = Array.from({length:4096},()=>a.pinExternal());
  rejects(()=>a.pinExternal());
  pins.forEach(x=>a.releasePin(x));
  const tasks = Array.from({length:4096},()=>a.beginTask());
  rejects(()=>a.beginTask());
  tasks.forEach(x=>a.finishTask(x));
  a.free(h);
  assert.equal(a.used,0);
});

test('signed zero and fractional finite F64 values survive every layout roundtrip',()=>{
  const a = new ActorArenaOracle('a',1,8192);
  const r = new DenseRegionOracle(a,['x','y'],5,'soa',4);
  const h = r.insert([-0, -1.25]);
  for (const name of LAYOUTS) {
    r.changeLayout(name);
    const [x,y]=r.read(h);
    assert.equal(Object.is(x,-0),true);
    assert.equal(y,-1.25);
  }
  r.close();
});

test('SoAoS field-group geometry differs from both AoS and AoSoA at 3 fields',()=>{
  const a=new ActorArenaOracle('a',1,8192);
  const names=['x','y','z'];
  const aos=new DenseRegionOracle(a,names,4,'aos',2);
  const aosoa=new DenseRegionOracle(a,names,4,'aosoa',2);
  const soaos=new DenseRegionOracle(a,names,4,'soaos',2);
  assert.equal(aos.physicalIndexOf(1,0),3);
  assert.equal(aosoa.physicalIndexOf(1,0),1);
  assert.equal(soaos.physicalIndexOf(1,0),2);
  assert.equal(soaos.physicalIndexOf(0,2),4);
  for (const r of [aos,aosoa,soaos]) {
    const indices=new Set();
    for(let row=0;row<4;row++)for(let f=0;f<3;f++)indices.add(r.physicalIndexOf(row,f));
    assert.equal(indices.size,12);
    rejects(()=>r.physicalIndexOf(4,0));
    r.close();
  }
  assert.equal(a.used,0);
});

test('normative manifest has source-free evidence and all adversarial vectors',()=>{
  const m=JSON.parse(readFileSync(new URL('../contracts/v1/actor-memory-layout-v1.json',import.meta.url)));
  assert.equal(m.evidence,'SOURCE_FREE_ORACLE_ONLY');
  assert.equal(m.promotion_gate.zero_step_ci,'NOT_EXECUTED');
  assert.equal(m.cases.length,41);
  const ids=new Set(m.cases.map(x=>x.id));
  for(const id of ['accessor-backed-row-input','sparse-or-inherited-component-input',
                   'reentrant-descriptor-side-effect','borrowed-layout-conversion-no-temporary-allocation',
                   'live-allocation-authority-limit','live-read-loan-limit','live-external-pin-limit',
                   'live-task-lifetime-limit','soaos-field-group-address-nonalias']) assert.ok(ids.has(id));
});
