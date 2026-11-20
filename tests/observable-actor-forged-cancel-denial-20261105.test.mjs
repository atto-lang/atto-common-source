// Host-only reference-model regression, not compiled AttoLang actor execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableActorReference} from '../models/observable-actor-reference-v1.mjs';

test('forged observer label cannot revoke a registered lease or refund its quota',()=>{
  const model=new ObservableActorReference({policy:'RELIABLE',capacity:2});
  const actual=model.subscribe('listener');
  model.publish('one');
  const forged={observer:'listener',active:true,pending:[]};
  assert.equal(model.cancel(forged),false);
  assert.equal(actual.active,true);
  assert.equal(model.retained,1);
  assert.equal(model.read(actual).value,'one');
  assert.equal(model.retained,0);
  assert.equal(model.cancel(actual),true);
  assert.equal(model.cancel(actual),false);
});

test('stale lease from previous incarnation cannot cancel a newly enrolled observer',()=>{
  const model=new ObservableActorReference();
  const old=model.subscribe('reuse');
  assert.equal(model.cancel(old),true);
  const current=model.subscribe('reuse');
  model.publish(42);
  old.active=true; // hostile mutation of an expired, caller-owned handle
  assert.equal(model.cancel(old),false);
  assert.equal(model.retained,1);
  assert.equal(model.read(current).value,42);
  assert.equal(model.cancel(current),true);
  assert.equal(model.retained,0);
});

test('foreign model lease with same observer name cannot cancel local subscription',()=>{
  const first=new ObservableActorReference(),second=new ObservableActorReference();
  const a=first.subscribe('shared'),b=second.subscribe('shared');
  first.publish('local');
  assert.equal(first.cancel(b),false);
  assert.equal(first.retained,1);
  assert.equal(first.read(a).value,'local');
  assert.equal(first.cancel(a),true);
  assert.equal(second.cancel(b),true);
});
