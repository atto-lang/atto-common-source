import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyHttpOriginTrace} from '../tools/verify-http-origin-v1.mjs';
const sha='0123456789abcdef0123456789abcdef01234567';
function positive(count){
  const events=[];const add=(e)=>events.push({seq:events.length+1,...e});
  for(let n=0;n<count;n++){
    const actor='pooled',carrier=`carrier-${n}`,mail=n,request=`request-${n}`,task=`task-${n}`;
    add({op:'mail_start',actor,generation:1,mail});
    add({op:'request_open',actor,generation:1,mail,request});
    add({op:'turn_enter',actor,generation:1,mail,carrier,kind:'user'});
    add({op:'request_claim',request,carrier});
    add({op:'task_create',task,request,carrier});
    add({op:'request_lookup',request,carrier});
    add({op:'turn_leave',carrier});
    add({op:'producer_notify',task,carrier:'foreign-io'});
    add({op:'turn_enter',actor,generation:1,mail,task,carrier,kind:'source_task'});
    add({op:'request_lookup',request,carrier});
    add({op:'turn_leave',carrier});
    add({op:'request_close',request});
    add({op:'task_finish',task});
    add({op:'mail_finish',actor,generation:1,mail});
    add({op:'request_retire',request});
  }
  return {version:1,backend:'java',source_sha:sha,carrier_count:count,events};
}
const mutate=(m,filter,changes)=>{let t=structuredClone(m),i=t.events.findIndex(filter);assert(i>=0);Object.assign(t.events[i],changes);return t};
const insert=(m,filter,e)=>{let t=structuredClone(m),i=t.events.findIndex(filter);assert(i>=0);t.events.splice(i+1,0,{...e});t.events.forEach((x,i)=>x.seq=i+1);return t};
for(const count of [3,7,15])test(`complete request origin model at ${count} carriers`,()=>{
  const out=verifyHttpOriginTrace(positive(count));assert.equal(out.carriers,count);assert.equal(out.lookups,count*2);
});
test('rejects SourceTask resume using the wrong mail sequence',()=>{
  assert.throws(()=>verifyHttpOriginTrace(mutate(positive(3),x=>x.op==='turn_enter'&&x.kind==='source_task',{mail:99})),/FORGED_TASK_ORIGIN/);
});
test('rejects SourceTask resume using the wrong actor incarnation',()=>{
  assert.throws(()=>verifyHttpOriginTrace(mutate(positive(3),x=>x.op==='turn_enter'&&x.kind==='source_task',{generation:2})),/FORGED_TASK_ORIGIN|UNKNOWN_ACTOR_MAIL/);
});
test('rejects request lookup from unbound producer callback',()=>{
  const t=insert(positive(3),x=>x.op==='producer_notify', {op:'turn_enter',carrier:'foreign',actor:'pooled',generation:1,kind:'callback'});
  const bad=insert(t,x=>x.op==='turn_enter'&&x.carrier==='foreign',{op:'request_lookup',request:'request-0',carrier:'foreign'});
  assert.throws(()=>verifyHttpOriginTrace(bad),/NO_ADMITTED_REQUEST/);
});
test('rejects request lookup after transport cancellation',()=>{
  const t=insert(positive(3),x=>x.op==='producer_notify'&&x.task==='task-0',{op:'request_close',request:'request-0'});
  assert.throws(()=>verifyHttpOriginTrace(t),/NO_ADMITTED_REQUEST|INVALID_CLOSE/);
});
test('rejects retired request while a task is still active',()=>{
  const t=insert(positive(3),x=>x.op==='producer_notify'&&x.task==='task-0',{op:'request_retire',request:'request-0'});
  assert.throws(()=>verifyHttpOriginTrace(t),/PREMATURE_REQUEST_RETIRE/);
});
test('rejects a second source receive on a pooled actor before first settles',()=>{
  const t=insert(positive(3),x=>x.op==='producer_notify'&&x.task==='task-0',{op:'mail_start',actor:'pooled',generation:1,mail:1});
  assert.throws(()=>verifyHttpOriginTrace(t),/MAIL_OVERLAP_OR_REPLAY/);
});
test('rejects a task created by untrusted callback provenance',()=>{
  const t=insert(positive(3),x=>x.op==='producer_notify'&&x.task==='task-0',{op:'turn_enter',carrier:'foreign',actor:'pooled',generation:1,kind:'callback'});
  const bad=insert(t,x=>x.op==='turn_enter'&&x.carrier==='foreign',{op:'task_create',task:'forged',request:'request-0',carrier:'foreign'});
  assert.throws(()=>verifyHttpOriginTrace(bad),/UNAUTHENTICATED_TASK_ORIGIN/);
});
test('rejects a task whose creation is not in an admitted turn',()=>{
  const t=mutate(positive(3),x=>x.op==='task_create'&&x.task==='task-0',{carrier:'foreign-io'});
  assert.throws(()=>verifyHttpOriginTrace(t),/UNAUTHENTICATED_TASK_ORIGIN/);
});
test('rejects truncated histories and invented source hashes',()=>{
  const t=positive(3);t.events.pop();assert.throws(()=>verifyHttpOriginTrace(t),/INCOMPLETE_TRACE/);
  const v=positive(3);v.source_sha='unverified';assert.throws(()=>verifyHttpOriginTrace(v),/INVALID_SOURCE_SHA/);
});
