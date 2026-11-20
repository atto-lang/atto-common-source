import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorArenaOracle} from '../scripts/actor-memory-layout-v1.mjs';

test('suspended scratch retains only owning message lifetime',()=>{
 const a=new ActorArenaOracle('worker',1,128);
 const m1=a.startMessage(),scratch=a.allocate(8,'scratch');
 a.write(scratch,0,91);
 a.suspendMessage(m1);
 assert.throws(()=>a.read(scratch,0),/message scratch is not accessible/);
 const m2=a.startMessage();
 assert.throws(()=>a.resumeMessage(m1),/actor lane already executing/);
 a.completeMessage(m2);
 a.resumeMessage(m1);
 assert.equal(a.read(scratch,0),91);
 a.completeMessage(m1);
 assert.equal(a.used,0);
 assert.equal(a.pendingMessages,0);
});

test('sealed retirement waits for suspended message tasks and pins',()=>{
 const a=new ActorArenaOracle('worker',2,128);
 const m=a.startMessage(),pin=a.pinExternal(),task=a.beginTask();
 a.suspendMessage(m);
 assert.equal(a.retire(),false);
 assert.throws(()=>a.completeMessage(m),/outstanding external pins/);
 a.releasePin(pin);
 assert.throws(()=>a.completeMessage(m),/outstanding descendant tasks/);
 a.finishTask(task);
 a.completeMessage(m);
 assert.equal(a.reclaimed,true);
 assert.equal(a.pendingMessages,0);
});

test('outstanding loans block suspension and stale loan handles never resume',()=>{
 const a=new ActorArenaOracle('worker',3,64),m=a.startMessage();
 const h=a.allocate(8,'scratch'),loan=a.borrowRead(h);
 assert.throws(()=>a.suspendMessage(m),/loan cannot cross message suspension/);
 a.releaseLoan(loan);
 a.suspendMessage(m);
 assert.throws(()=>a.releaseLoan(loan),/stale read lease/);
 a.completeMessage(m);
 assert.equal(a.used,0);
});