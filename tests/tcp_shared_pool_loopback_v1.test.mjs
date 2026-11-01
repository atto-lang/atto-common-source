// Native Node.js loopback oracle. Host-only: not an Oreslang guest/runtime test.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_FRAME = 1024;
function frame(body) {
  assert(body.length > 0 && body.length <= MAX_FRAME);
  const output = Buffer.alloc(body.length + 2);
  output.writeUInt16BE(body.length, 0);
  Buffer.from(body).copy(output, 2);
  return output;
}
class Frames {
  constructor(socket) {
    this.socket = socket;
    this.pending = Buffer.alloc(0);
    this.messages = [];
    this.waiter = null;
    this.error = null;
    socket.on('data', bytes => {
      if (this.error) return;
      this.pending = Buffer.concat([this.pending, bytes]);
      if (this.pending.length > MAX_FRAME * 3) return this.fail(Error('frame-budget'));
      while (this.pending.length >= 2) {
        const length = this.pending.readUInt16BE(0);
        if (length === 0 || length > MAX_FRAME) return this.fail(Error('invalid-frame'));
        if (this.pending.length < length + 2) break;
        const body = Buffer.from(this.pending.subarray(2, length + 2));
        this.pending = this.pending.subarray(2 + length);
        if (this.waiter) { const done = this.waiter; this.waiter = null; done.resolve(body); }
        else this.messages.push(body);
        if (this.messages.length > 1) return this.fail(Error('unsolicited-frame'));
      }
    });
    socket.on('error', e => this.fail(e));
    socket.on('close', () => this.fail(Error('socket-closed')));
  }
  fail(error) {
    if (this.error) return;
    this.error = error;
    if (this.waiter) { const done = this.waiter; this.waiter = null; done.reject(error); }
    this.socket.destroy();
  }
  read(signal) {
    if (this.error) return Promise.reject(this.error);
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    if (this.waiter) return Promise.reject(Error('concurrent-reader'));
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      const aborted = () => { cleanup(); this.fail(Error('cancelled')); };
      this.waiter = {resolve: value => { cleanup(); resolve(value); },
                     reject: error => { cleanup(); reject(error); }};
      if (signal?.aborted) aborted();
      else signal?.addEventListener('abort', aborted, {once:true});
    });
  }
  clean() { return !this.error && !this.waiter && this.messages.length === 0 && this.pending.length === 0; }
}
async function dial(port) {
  const socket = net.connect({host:'127.0.0.1', port, allowHalfOpen:false});
  try { await once(socket, 'connect'); return socket; }
  catch (error) { socket.destroy(); throw error; }
}
class ExclusiveSlot {
  constructor(port) { this.port = port; this.generation = 0; this.socket = null;
    this.reader = null; this.current = null; this.active = false; this.stopped = false; }
  async open() {
    if (this.stopped || this.current || this.socket || this.retiring)
      throw Error('slot-not-retired');
    this.socket = await dial(this.port);
    // Remember the actual close event BEFORE a cancellation may destroy the
    // socket. Node's socket.destroyed flag alone is not physical quiescence.
    this.closeObserved = new Promise(resolve =>
      this.socket.once('close', resolve));
    this.reader = new Frames(this.socket);
    this.generation++;
  }
  acquire(actor) {
    if (this.stopped || !this.socket || this.socket.destroyed || this.current || !this.reader.clean()) return null;
    const token = Object.freeze({});
    this.current = {actor, token, generation:this.generation};
    return token;
  }
  valid(token, actor) { return !!this.current && this.current.token === token &&
    this.current.actor === actor && this.current.generation === this.generation; }
  async exchange(token, actor, nonce, signal) {
    if (!this.valid(token, actor) || this.active || this.stopped) throw Error('lease-denied');
    this.active = true;
    try {
      const expected = Buffer.from([actor, nonce]);
      const reply = this.reader.read(signal);
      this.socket.write(frame(expected));
      const result = await reply;
      if (!result.equals(expected)) throw Error('response-owner-mismatch');
      return result;
    } catch (error) {
      this.socket?.destroy();
      throw error;
    } finally { this.active = false; }
  }
  release(token, actor) {
    if (!this.valid(token, actor)) return false;
    if (this.active) { this.socket.destroy(); return false; }
    this.current = null;
    if (!this.reader.clean()) this.socket.destroy();
    return true;
  }
  async retire() {
    if (this.retiring) return this.retiring;
    const socket = this.socket;
    const closeObserved = this.closeObserved;
    if (!socket) { this.reader = null; this.current = null; return; }
    // Do not return a quarantined slot to open() until the OS-close event
    // has actually been delivered. Concurrent retire() calls join the same
    // promise; none can clear a newer generation's socket.
    this.retiring = (async () => {
      socket.destroy();
      await closeObserved;
      if (this.socket === socket) {
        this.socket = null; this.closeObserved = null;
        this.reader = null; this.current = null;
      }
    })();
    try { await this.retiring; }
    finally { this.retiring = null; }
  }
  async stop() { this.stopped = true; await this.retire(); }
}
async function serverFor(t, handler) {
  let accepted = 0;
  const clients = new Set();
  const server = net.createServer(socket => {
    accepted++; clients.add(socket);
    socket.on('close',()=>clients.delete(socket));
    handler(socket, new Frames(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server,'listening');
  t.after(async () => {
    for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return {port:server.address().port, count:()=>accepted};
}
function echoServer(socket, incoming) {
  (async()=>{while(!socket.destroyed) {
    let body; try {body=await incoming.read();} catch {break;}
    if (body[0]===99) await delay(120);
    if (!socket.destroyed) socket.write(frame(body));
  }})().catch(()=>socket.destroy());
}

test('two actors reuse one framed physical TCP socket without mailbox payload serialization', {timeout:5000}, async t => {
  const srv=await serverFor(t,echoServer), slot=new ExclusiveSlot(srv.port);
  t.after(()=>slot.stop());
  await slot.open();
  const a=slot.acquire(1); assert.ok(a);
  assert.equal(slot.acquire(2),null);
  assert.deepEqual([...await slot.exchange(a,1,11)], [1,11]);
  assert.equal(slot.release(a,1),true);
  const b=slot.acquire(2); assert.ok(b);
  assert.equal(slot.release(a,1),false);
  await assert.rejects(()=>slot.exchange(a,1,12),/lease-denied/);
  assert.deepEqual([...await slot.exchange(b,2,22)], [2,22]);
  assert.equal(slot.release(b,2),true);
  assert.equal(srv.count(),1, 'sequential actor ownership uses one socket');
});

test('aborted exchange destroys socket; old late response cannot reach new actor', {timeout:5000}, async t => {
  const srv=await serverFor(t,echoServer), slot=new ExclusiveSlot(srv.port);
  t.after(()=>slot.stop());
  await slot.open();
  const a=slot.acquire(99), abort=new AbortController();
  const pending=slot.exchange(a,99,1,abort.signal);
  await delay(10); abort.abort();
  await assert.rejects(pending,/cancelled/);
  assert.equal(slot.release(a,99),true);
  assert.equal(slot.acquire(2),null,'closed socket cannot be reused');
  const closePending = slot.retire();
  await assert.rejects(slot.open(),/slot-not-retired/,
    'new dial is blocked until the old physical close event');
  await closePending; await slot.open();
  const b=slot.acquire(2);assert.ok(b);
  assert.deepEqual([...await slot.exchange(b,2,2)],[2,2]);
  assert.equal(slot.release(b,2),true);
  assert.equal(srv.count(),2,'new generation opens a new socket');
});

test('invalid oversized reply poisons physical connection and refuses reuse', {timeout:5000}, async t => {
  const srv=await serverFor(t,(socket,incoming)=>{(async()=>{
    await incoming.read();
    socket.write(Buffer.from([0xff,0xff]));
  })().catch(()=>socket.destroy());});
  const slot=new ExclusiveSlot(srv.port);t.after(()=>slot.stop());
  await slot.open(); const a=slot.acquire(1);
  await assert.rejects(slot.exchange(a,1,3),/invalid-frame/);
  assert.equal(slot.release(a,1),true);
  assert.equal(slot.acquire(2),null);
});

test('shutdown is terminal and stale generation tokens never regain authority', {timeout:5000}, async t => {
  const srv=await serverFor(t,echoServer),slot=new ExclusiveSlot(srv.port);
  t.after(()=>slot.stop());
  await slot.open(); const a=slot.acquire(1);
  assert.equal(slot.release(a,2),false, 'wrong actor cannot release');
  assert.equal(slot.release(a,1),true);
  await slot.retire(); await slot.open();
  assert.equal(slot.release(a,1),false, 'stale generation cannot release');
  const b=slot.acquire(2);assert.ok(b);
  assert.deepEqual([...await slot.exchange(b,2,5)],[2,5]);
  await slot.stop();
  assert.equal(slot.acquire(2),null);
  await assert.rejects(slot.open(),/slot-not-retired/);
});

test('fragmented header and body preserve exact frame boundary across actor leases', {timeout:5000}, async t => {
  const srv=await serverFor(t,(socket,incoming)=>{(async()=>{
    while (!socket.destroyed) {
      const body=await incoming.read();
      const packed=frame(body);
      socket.write(packed.subarray(0,1));
      await delay(1);
      socket.write(packed.subarray(1,3));
      await delay(1);
      socket.write(packed.subarray(3));
    }
  })().catch(()=>socket.destroy());});
  const slot=new ExclusiveSlot(srv.port);t.after(()=>slot.stop());
  await slot.open();
  for (let actor=1;actor<=8;actor++) {
    const lease=slot.acquire(actor);assert.ok(lease);
    assert.deepEqual([...await slot.exchange(lease,actor,actor+20)],[actor,actor+20]);
    assert.equal(slot.release(lease,actor),true);
  }
  assert.equal(srv.count(),1);
});

test('unexpected duplicate frames cannot be reinterpreted as the next actor response', {timeout:5000}, async t => {
  const srv=await serverFor(t,(socket,incoming)=>{(async()=>{
    const body=await incoming.read();
    socket.write(Buffer.concat([frame(body),frame(body)]));
  })().catch(()=>socket.destroy());});
  const slot=new ExclusiveSlot(srv.port);t.after(()=>slot.stop());
  await slot.open();const a=slot.acquire(1);
  assert.deepEqual([...await slot.exchange(a,1,22)],[1,22]);
  assert.equal(slot.release(a,1),true);
  assert.equal(slot.acquire(2),null,'unsolicited frame forbids socket reuse');
});

test('cross-actor response identity mismatch poisons connection', {timeout:5000}, async t => {
  const srv=await serverFor(t,(socket,incoming)=>{(async()=>{
    const body=await incoming.read();
    socket.write(frame(Buffer.from([body[0]+1,body[1]])));
  })().catch(()=>socket.destroy());});
  const slot=new ExclusiveSlot(srv.port);t.after(()=>slot.stop());
  await slot.open();const a=slot.acquire(1);
  await assert.rejects(slot.exchange(a,1,4),/response-owner-mismatch/);
  assert.equal(slot.release(a,1),true);
  assert.equal(slot.acquire(2),null,'mismatched response forbids future actor lease');
});


test('late frame from former lease cannot satisfy another actor exchange', {timeout:5000}, async t => {
  // A clean userspace frame queue at release is not evidence that the
  // peer will never emit another response. The new owner must validate
  // an independently associated response and retire on any mismatch.
  const srv=await serverFor(t,(socket,incoming)=>{(async()=>{
    const first=await incoming.read();
    socket.write(frame(first));
    await delay(80);
    if (!socket.destroyed) socket.write(frame(first));
  })().catch(()=>socket.destroy());});
  const slot=new ExclusiveSlot(srv.port);t.after(()=>slot.stop());
  await slot.open();
  const first=slot.acquire(1);assert.ok(first);
  assert.deepEqual([...await slot.exchange(first,1,13)],[1,13]);
  assert.equal(slot.release(first,1),true);
  const second=slot.acquire(2);assert.ok(second);
  await assert.rejects(()=>slot.exchange(second,2,14),/response-owner-mismatch/);
  assert.equal(slot.release(second,2),true);
  assert.equal(slot.acquire(3),null,'mismatched delayed response quarantines socket');
  assert.equal(srv.count(),1,'no hidden second connection');
});
