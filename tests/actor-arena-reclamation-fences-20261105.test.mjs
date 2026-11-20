import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorArenaOracle} from '../scripts/actor-memory-layout-v1.mjs';

test('loan pins forbid byte mutation and freed allocation handles never revive',()=>{
 const arena=new ActorArenaOracle('worker',1,64);
 const handle=arena.allocate(8);
 arena.write(handle,0,255);
 const loan=arena.borrowRead(handle);
 assert.equal(arena.readLoan(loan,0),255);
 assert.throws(()=>arena.write(handle,0,2),/active loan forbids mutation/);
 arena.releaseLoan(loan);
 arena.write(handle,0,2);
 assert.equal(arena.read(handle,0),2);
 arena.free(handle);
 assert.equal(arena.used,0);
 assert.throws(()=>arena.read(handle,0),/foreign, forged, or stale allocation handle/);
 assert.throws(()=>arena.releaseLoan(loan),/stale read lease/);
});

test('legacy scratch reset cannot race an outstanding external pin',()=>{
 const arena=new ActorArenaOracle('worker',2,64);
 arena.allocate(8,'scratch');
 const pin=arena.pinExternal();
 assert.throws(()=>arena.nextTurn(),/legacy scratch reset blocked/);
 assert.equal(arena.used,8);
 arena.releasePin(pin);
 arena.nextTurn();
 assert.equal(arena.used,0);
 assert.equal(arena.turn,1);
 assert.throws(()=>arena.releasePin(pin),/stale external pin/);
});

test('retirement waits for both live read leases and descendant tasks',()=>{
 const arena=new ActorArenaOracle('worker',3,64);
 const handle=arena.allocate(8),loan=arena.borrowRead(handle),task=arena.beginTask();
 assert.equal(arena.retire(),false);
 assert.equal(arena.sealed,true);
 arena.releaseLoan(loan);
 assert.equal(arena.reclaimed,false);
 arena.finishTask(task);
 assert.equal(arena.reclaimed,true);
 assert.equal(arena.used,0);
 assert.throws(()=>arena.allocate(1),/actor retired/);
 assert.throws(()=>arena.read(handle,0),/actor retired/);
});