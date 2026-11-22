// Real .atto source inputs and pinned expectations: inventory only, NOT guest proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('contracts/native-future-family-guest-matrix-v1.json',root),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');
test('all ten real .atto fixtures are exact-byte-pinned with no forged guest status',()=>{
  assert.equal(manifest.schema,'atto.native-future-family.guest-matrix.v1');
  assert.equal(manifest.status,'TARGET_NOT_EXECUTED');
  const files=readdirSync(new URL('tests/fixtures/native-future-family-v1/',root)).filter(x=>x.endsWith('.atto')).sort();
  assert.deepEqual(manifest.cases.map(x=>x.path.split('/').at(-1)).sort(),files);
  assert.equal(manifest.cases.length,10);
  assert.equal(manifest.cases.filter(x=>x.expected==='ACCEPT').length,4);
  assert.equal(manifest.cases.filter(x=>x.expected==='REJECT_NO_ARTIFACT').length,6);
  for(const entry of manifest.cases){
    assert.match(entry.path,/^tests\/fixtures\/native-future-family-v1\/[a-z_]+\.atto$/);
    assert.equal(entry.execution,'NOT_EXECUTED');
    assert.ok(['ACCEPT','REJECT_NO_ARTIFACT'].includes(entry.expected));
    const source=readFileSync(new URL(entry.path,root));
    assert.equal(entry.bytes,source.length,entry.path);
    assert.equal(entry.sha256,sha(source),entry.path);
    assert.match(source.toString('utf8'),/import module future_family from "stdlib\/std\/future_family\.atto";/);
  }
});
test('owned future calls and negative cases encode distinct ownership and stream boundaries',()=>{
  const cases=Object.fromEntries(manifest.cases.map(x=>[
    x.path.split('/').at(-1),readFileSync(new URL(x.path,root),'utf8')]));
  for(const name of ['await_future_owned.atto','await_task_owned.atto','await_actor_owned.atto','await_actor_result_preserved.atto'])
    assert.match(cases[name],/future_family\.await_\w+\(take! /,name);
  assert.match(cases['reject_implicit_borrow.atto'],/await_future\(receipt\)/);
  assert.match(cases['reject_double_await.atto'],/return await receipt;/);
  assert.match(cases['reject_control_after_task_move.atto'],/child\.cancel_task\(\);/);
  assert.match(cases['reject_stream_as_actor_future.atto'],/ActorStream<int>/);
  assert.match(cases['reject_result_unwrap.atto'],/main\(\): int/);
  assert.match(cases['reject_forged_actor_future.atto'],/ActorFuture<int>\.of/);
});
