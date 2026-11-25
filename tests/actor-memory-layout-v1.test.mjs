import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ActorArenaOracle, DenseRegionOracle, LAYOUTS} from '../scripts/actor-memory-layout-v1.mjs';

const manifest = JSON.parse(readFileSync(new URL('../contracts/v1/actor-memory-layout-v1.json', import.meta.url)));
const denied = fn => assert.throws(fn, /ACTOR_MEMORY_V1/);

test('normative contract is explicitly source-free, five backends and four layouts', () => {
  assert.equal(manifest.schema, 'oreslang.actor-memory-layout.v1');
  assert.equal(manifest.evidence, 'SOURCE_FREE_ORACLE_ONLY');
  assert.deepEqual(manifest.backends, ['java', 'llvm', 'net', 'wasm', 'js']);
  assert.deepEqual(manifest.layouts, LAYOUTS);
  assert.ok(manifest.cases.length >= 20);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  assert.ok(manifest.cases.every(c => ['allow','deny','defer','equal'].includes(c.expect)));
});

test('unforgeable issued handles, bounded writes, and actor/instance separation', () => {
  const a = new ActorArenaOracle('a', 1, 64);
  const b = new ActorArenaOracle('a', 2, 64);
  const h = a.allocate(8);
  a.write(h, 0, 255);
  assert.equal(a.read(h, 0), 255);
  denied(() => b.read(h, 0));
  denied(() => a.read({...h}, 0));
  denied(() => a.write(h, 8, 1));
  denied(() => a.write(h, 0, 256));
  denied(() => a.allocate(57));
  assert.equal(a.used, 8);
  a.free(h);
  assert.equal(a.used, 0);
  denied(() => a.read(h, 0));
  denied(() => a.free(h));
});

test('scratch reclaims on turn; persistent survives; active loans forbid mutation and suspension', () => {
  const a = new ActorArenaOracle('actor', 1, 128);
  const persistent = a.allocate(12);
  const scratch = a.allocate(9, 'scratch');
  a.write(persistent, 0, 27);
  const lease = a.borrowRead(persistent);
  assert.equal(a.readLoan(lease, 0), 27);
  denied(() => a.write(persistent, 0, 30));
  denied(() => a.nextTurn());
  a.releaseLoan(lease);
  denied(() => a.readLoan(lease, 0));
  a.nextTurn();
  assert.equal(a.turn, 1);
  assert.equal(a.used, 12);
  assert.equal(a.read(persistent, 0), 27);
  denied(() => a.read(scratch, 0));
});

test('retirement seals authority and waits for tasks, pins and readonly loans', () => {
  const a = new ActorArenaOracle('a', 1, 128);
  const h = a.allocate(12);
  a.write(h, 0, 19);
  const loan = a.borrowRead(h);
  const pin = a.pinExternal();
  const task = a.beginTask();
  assert.equal(a.retire(), false);
  assert.equal(a.sealed, true);
  denied(() => a.allocate(1));
  denied(() => a.write(h, 0, 21));
  a.releaseLoan(loan);
  assert.equal(a.reclaimed, false);
  a.releasePin(pin);
  assert.equal(a.reclaimed, false);
  a.finishTask(task);
  assert.equal(a.reclaimed, true);
  assert.equal(a.used, 0);
  assert.equal(a.retire(), true);
  denied(() => a.releasePin(pin));
  denied(() => a.finishTask(task));
});

test('all four physical layouts preserve stable entity identities and numerical rows', () => {
  for (const kind of LAYOUTS) {
    const a = new ActorArenaOracle('a', 1, 32768);
    const r = new DenseRegionOracle(a, ['x', 'y', 'vx'], 19, kind, 8);
    const handles = [];
    for (let i = 0; i < 19; i++) handles.push(r.insert([i, -i, i + .25]));
    denied(() => r.insert([20, 30, 40]));
    for (let i = 0; i < handles.length; i++) assert.deepEqual(r.read(handles[i]), [i,-i,i+.25]);
    for (const target of LAYOUTS) {
      const was = r.epoch;
      const before = r.physicalLayout;
      assert.equal(r.changeLayout(target), was + Number(before !== target));
      for (let i = 0; i < handles.length; i++) assert.deepEqual(r.read(handles[i]), [i,-i,i+.25]);
    }
    r.eraseSwap(handles[4]);
    denied(() => r.read(handles[4]));
    assert.deepEqual(r.read(handles[18]), [18,-18,18.25]);
    const newly = r.insert([91,92,93]);
    assert.deepEqual(r.read(newly), [91,92,93]);
    denied(() => r.read({...newly}));
    r.close();
    assert.equal(a.used,0);
    denied(() => r.read(newly));
  }
});

test('layout conversion is transactional under active readonly loan and byte quota', () => {
  const a = new ActorArenaOracle('a',1,512);
  const r = new DenseRegionOracle(a,['x','y'],8,'aos',4);
  const h = r.insert([4,7]);
  const lease = r.borrowRead();
  denied(() => r.changeLayout('soa'));
  assert.equal(r.physicalLayout,'aos');
  assert.deepEqual(r.read(h),[4,7]);
  denied(() => r.close());
  denied(() => r.write(h, [8,9]));
  denied(() => r.eraseSwap(h));
  denied(() => r.insert([2,3]));
  r.releaseRead(lease);
  r.changeLayout('soa');
  assert.deepEqual(r.read(h),[4,7]);
  r.close();
  assert.equal(a.used,0);

  const small = new ActorArenaOracle('small',1,140);
  const x = new DenseRegionOracle(small,['x','y'],8,'aos',4); // 128 bytes
  const y = x.insert([3,5]);
  denied(() => x.changeLayout('soa')); // Copy-on-reconcile needs 128 additional bytes.
  assert.equal(x.physicalLayout,'aos');
  assert.deepEqual(x.read(y),[3,5]);
  x.close();
});

test('invalid schema and layout admissions fail before usable backing allocation',()=>{
  const a = new ActorArenaOracle('a',1,512);
  denied(()=>new DenseRegionOracle(a,['x','x'],2));
  denied(()=>new DenseRegionOracle(a,['bad-name'],2));
  denied(()=>new DenseRegionOracle(a,['x'],2,'bad'));
  denied(()=>new DenseRegionOracle(a,['x'],0));
  denied(()=>new DenseRegionOracle(a,['x'],2,'aosoa',0));
  assert.equal(a.used,0);
  const r = new DenseRegionOracle(a,['x'],2);
  denied(()=>r.insert([NaN]));
  denied(()=>r.insert([Infinity]));
  denied(()=>r.insert([]));
  assert.equal(r.length,0);
  r.close();
});

test('deterministic stress: layout swaps, writes and swap-delete preserve scalar reference',()=>{
  let seed = 0x12345678;
  const rand = n => {
    seed ^= seed << 13;seed ^= seed >>> 17;seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const a = new ActorArenaOracle('a',1,131072);
  const r = new DenseRegionOracle(a,['x','y'],256,'soa',8);
  const truth = new Map();
  for (let i=0;i<4000;i++) {
    const entries = [...truth.keys()];
    const op = rand(4);
    if ((op===0 || entries.length===0) && truth.size<256) {
      const row = [rand(10000),rand(10000)];
      truth.set(r.insert(row),row);
    } else if (op===1 && entries.length) {
      const id=entries[rand(entries.length)];
      const row=[rand(10000),rand(10000)];
      r.write(id,row);truth.set(id,row);
    } else if (op===2 && entries.length) {
      const id=entries[rand(entries.length)];
      r.eraseSwap(id);truth.delete(id);
      denied(()=>r.read(id));
    } else {
      r.changeLayout(LAYOUTS[rand(LAYOUTS.length)]);
    }
    for (const [id,row] of truth) assert.deepEqual(r.read(id),row);
  }
  r.close();
  assert.equal(a.used,0);
});
