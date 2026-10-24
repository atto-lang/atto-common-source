import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorArenaOracle} from '../scripts/actor-memory-layout-v1.mjs';

const denied = (fn, reason) => assert.throws(fn, new RegExp('ACTOR_MEMORY_V1: .*' + reason));

test('one actor executes only one message at a time, even when many are outstanding', () => {
  const actor = new ActorArenaOracle('actor', 1, 1024);
  const first = actor.startMessage();
  assert.equal(actor.pendingMessages, 1);
  assert.equal(actor.executingMessage, true);
  denied(() => actor.startMessage(), 'lane already');
  denied(() => actor.resumeMessage(first), 'lane already');
  actor.suspendMessage(first);
  assert.equal(actor.executingMessage, false);
  const second = actor.startMessage();
  assert.equal(actor.pendingMessages, 2);
  denied(() => actor.resumeMessage(first), 'lane already');
  denied(() => actor.suspendMessage(first), 'not the executing');
  actor.completeMessage(second);
  actor.resumeMessage(first);
  actor.completeMessage(first);
  assert.equal(actor.pendingMessages, 0);
});

test('suspended messages retain ONLY their own scratch, not the newer message scratch', () => {
  const actor = new ActorArenaOracle('actor', 1, 64);
  const first = actor.startMessage();
  const old = actor.allocate(12, 'scratch');
  const stable = actor.allocate(8, 'persistent');
  actor.write(old, 0, 17);
  actor.write(stable, 0, 33);
  actor.suspendMessage(first);
  const second = actor.startMessage();
  const fresh = actor.allocate(16, 'scratch');
  actor.write(fresh, 0, 42);
  assert.equal(actor.used, 36);
  denied(() => actor.read(old, 0), 'owning execution');
  denied(() => actor.free(old), 'owning execution');
  denied(() => actor.nextTurn(), 'in-flight messages');
  actor.completeMessage(second);
  assert.equal(actor.used, 20);
  denied(() => actor.read(fresh, 0), 'stale allocation');
  actor.resumeMessage(first);
  assert.equal(actor.read(old, 0), 17);
  assert.equal(actor.read(stable, 0), 33);
  actor.completeMessage(first);
  assert.equal(actor.used, 8);
  denied(() => actor.read(old, 0), 'stale allocation');
  assert.equal(actor.read(stable, 0), 33);
});

test('suspension cannot hide a read loan from the actor lane', () => {
  const actor = new ActorArenaOracle('actor', 1, 128);
  const msg = actor.startMessage();
  const persistent = actor.allocate(8);
  const transient = actor.allocate(8, 'scratch');
  const loan = actor.borrowRead(persistent);
  denied(() => actor.suspendMessage(msg), 'loan cannot cross');
  denied(() => actor.completeMessage(msg), 'outstanding loans');
  denied(() => actor.nextTurn(), 'in-flight messages');
  actor.releaseLoan(loan);
  const scratchLoan = actor.borrowRead(transient);
  denied(() => actor.suspendMessage(msg), 'loan cannot cross');
  actor.releaseLoan(scratchLoan);
  actor.suspendMessage(msg);
  denied(() => actor.read(transient, 0), 'owning execution');
  denied(() => actor.allocate(1, 'scratch'), 'requires an executing message');
  actor.resumeMessage(msg);
  actor.completeMessage(msg);
  assert.equal(actor.used, 8);
});

test('retirement seals guest authority but preserves pending scratch until message done', () => {
  const actor = new ActorArenaOracle('actor', 1, 128);
  const msg = actor.startMessage();
  const scratch = actor.allocate(12, 'scratch');
  actor.write(scratch, 0, 64);
  const task = actor.beginTask();
  const pin = actor.pinExternal();
  actor.suspendMessage(msg);
  assert.equal(actor.retire(), false);
  assert.equal(actor.sealed, true);
  assert.equal(actor.reclaimed, false);
  denied(() => actor.resumeMessage(msg), 'actor retired');
  denied(() => actor.startMessage(), 'actor retired');
  assert.equal(actor.used, 12);
  actor.finishTask(task);
  actor.releasePin(pin);
  assert.equal(actor.reclaimed, false);
  // Late cancellation completion may release an outstanding message without
  // ever resuming guest code after the retirement barrier.
  actor.completeMessage(msg);
  assert.equal(actor.reclaimed, true);
  assert.equal(actor.used, 0);
  denied(() => actor.completeMessage(msg), 'stale message');
});

test('stale/forged message tokens cannot control an actor or release memory', () => {
  const a = new ActorArenaOracle('a', 1, 64);
  const b = new ActorArenaOracle('a', 1, 64);
  const t = a.startMessage();
  const h = a.allocate(8, 'scratch');
  const fake = Object.freeze({...t});
  denied(() => b.resumeMessage(t), 'stale message');
  denied(() => a.completeMessage(fake), 'stale message');
  denied(() => a.suspendMessage(fake), 'not the executing');
  assert.equal(a.used, 8);
  a.suspendMessage(t);
  denied(() => a.resumeMessage(fake), 'stale message');
  a.resumeMessage(t);
  a.completeMessage(t);
  denied(() => a.resumeMessage(t), 'stale message');
  denied(() => a.read(h, 0), 'stale allocation');
});

test('no caller can use message scratch while suspended, including F64 helpers', () => {
  const a = new ActorArenaOracle('actor', 3, 64);
  const msg = a.startMessage();
  const h = a.allocate(16, 'scratch');
  a.writeF64(h, 1, 12.5);
  a.suspendMessage(msg);
  denied(() => a.readF64(h, 1), 'owning execution');
  denied(() => a.writeF64(h, 1, 15.5), 'owning execution');
  denied(() => a.borrowRead(h), 'owning execution');
  a.resumeMessage(msg);
  assert.equal(a.readF64(h, 1), 12.5);
  a.completeMessage(msg);
});

test('global serial nextTurn remains supported only when no messages are pending', () => {
  const actor = new ActorArenaOracle('serial', 1, 64);
  const first = actor.allocate(4, 'scratch');
  actor.write(first, 0, 11);
  actor.nextTurn();
  denied(() => actor.read(first, 0), 'stale allocation');
  const msg = actor.startMessage();
  denied(() => actor.nextTurn(), 'in-flight messages');
  actor.completeMessage(msg);
  actor.nextTurn();
  const final = actor.allocate(1, 'scratch');
  actor.nextTurn();
  denied(() => actor.read(final, 0), 'stale allocation');
});

test('message scratch uses actor quota and retires under deterministic stress', () => {
  const actor = new ActorArenaOracle('stress', 1, 4096);
  const pending = [];
  for (let i = 0; i < 200; i++) {
    if (pending.length && i % 5 === 0) {
      const oldest = pending.shift();
      actor.resumeMessage(oldest.msg);
      assert.equal(actor.read(oldest.h, 0), oldest.value);
      actor.completeMessage(oldest.msg);
    }
    const msg = actor.startMessage();
    const h = actor.allocate(5, 'scratch');
    actor.write(h, 0, i % 256);
    pending.push({msg, h, value:i % 256});
    actor.suspendMessage(msg);
  }
  assert.equal(actor.used, pending.length * 5);
  assert.equal(actor.retire(), false);
  for (const {msg} of pending) actor.completeMessage(msg);
  assert.equal(actor.reclaimed, true);
  assert.equal(actor.used, 0);
});
