import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SharedPayloadRefOracle as Payload, SharedPayloadInboxOracle as Inbox } from '../scripts/shared-immutable-payload-v1.mjs';

const contract = JSON.parse(await readFile(new URL('../contracts/shared-immutable-payload-v1.json', import.meta.url)));
const rejected = (f, msg) => assert.throws(f, new RegExp('SHARED_PAYLOAD_V1: ' + msg));

test('contract requires explicit unexecuted backend evidence', () => {
  assert.equal(contract.schema, 'atto.actor.shared_immutable_payload.v1');
  assert.equal(contract.status, 'DESIGN_ONLY_NOT_EXECUTED');
  assert.equal(contract.guestImplementation, 'NOT_EXECUTED');
  assert.deepEqual(Object.keys(contract.backendReceipts).sort(), ['llvm','java','net','wasm','forge'].sort());
  assert.ok(Object.values(contract.backendReceipts).every(v => v === 'NOT_EXECUTED'));
  assert.equal(contract.localOnly, true);
  assert.equal(contract.rawGuestPointers, false);
  assert.equal(contract.actorPrivateArenasRemainSealed, true);
  assert.deepEqual(contract.cases.map(c=>c.id), Array.from({length:14}, (_,i)=>'SIP'+String(i+1).padStart(2,'0')));
});

test('SIP01/03/04: 1 MiB immutable fanout, conservative quota and rollback', () => {
  const mib = 1024*1024;
  const source = new Uint8Array(mib).fill(42);
  const original = Payload.freeze(source);
  source.fill(9); // JS oracle copies once to freeze; not native zero-copy evidence.
  const tiny = original.slice(100, 1);
  assert.equal(tiny.readByte(0),42);
  assert.equal(tiny.backingId, original.backingId);
  assert.equal(tiny.backingBytes, mib);
  const box = new Inbox({slots:2, bytes:2*mib});
  assert.equal(box.trySend(tiny), 'admitted');
  assert.equal(box.trySend(original), 'admitted');
  const count = original.backingRefsForTest;
  assert.equal(box.trySend(tiny), 'full');
  assert.equal(original.backingRefsForTest, count);
  assert.equal(box.bufferedBytes,2*mib);
  const one = box.tryReceive();
  assert.equal(one.readByte(0),42);
  box.close();
  assert.equal(box.bufferedBytes,0);
  assert.equal(one.readByte(0),42);
  assert.equal(box.trySend(tiny), 'closed');
  one.drop(); tiny.drop(); original.drop();
});

test('SIP02/06/07/08: checked slices, stale handles, frozen snapshot survives sender drop', () => {
  const source = [1,2,3,255];
  const a = Payload.freeze(source);
  source[0]=99;
  const b = a.slice(1,2);
  a.drop();
  assert.equal(b.readByte(0),2);
  assert.equal(b.readByte(1),3);
  rejected(()=>b.readByte(2),'read out of bounds');
  rejected(()=>b.slice(Number.MAX_SAFE_INTEGER,1),'slice out of bounds');
  rejected(()=>b.slice(2,1),'slice out of bounds');
  b.drop();
  rejected(()=>b.drop(),'stale handle');
  rejected(()=>b.readByte(0),'stale handle');
});

test('SIP03/04: tiny slice full-backing accounting denies overcommit', () => {
  const p=Payload.freeze([4,5,6]);
  const s=p.slice(0,1);
  const box=new Inbox({slots:5,bytes:2});
  assert.equal(box.trySend(s),'full');
  assert.equal(box.bufferedBytes,0);
  assert.equal(box.queued,0);
  assert.equal(p.backingRefsForTest,2);
  s.drop(); p.drop();
});

test('SIP05/06: cancel queued while received reference keeps its own lifetime', () => {
  const p=Payload.freeze([11]);
  const box=new Inbox({slots:3,bytes:3});
  assert.equal(box.trySend(p),'admitted');
  assert.equal(box.trySend(p),'admitted');
  const delivered=box.tryReceive();
  p.drop();
  box.close(); box.close();
  assert.equal(box.queued,0);
  assert.equal(delivered.readByte(0),11);
  delivered.drop();
  assert.equal(box.trySend(null),'invalid');
});

test('source octet validation and mailbox quota rejection', () => {
  rejected(()=>Payload.freeze([256]),'invalid octet');
  rejected(()=>Payload.freeze([-1]),'invalid octet');
  rejected(()=>Payload.freeze([NaN]),'invalid octet');
  rejected(()=>Payload.freeze([1,2],1),'slab quota');
  rejected(()=>new Inbox({slots:0,bytes:10}),'invalid mailbox quota');
  rejected(()=>new Inbox({slots:1,bytes:-1}),'invalid mailbox quota');
});
