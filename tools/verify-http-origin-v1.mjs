/** Source-free audit of proposed logical request/mail/task origin traces. */
import { readFileSync } from 'node:fs';
const fail=(code,index)=>{throw new Error(`${code} event=${index}`)};
const id=(actor,generation)=>`${actor}\u0000${generation}`;
const present=v=>typeof v==='string' && v.length>0;
export function verifyHttpOriginTrace(trace){
  if(!trace || trace.version!==1 || !['java','llvm','wasm','net','forge'].includes(trace.backend) || !Array.isArray(trace.events))fail('INVALID_HEADER',0);
  if(!/^[0-9a-f]{40}$/.test(trace.source_sha||''))fail('INVALID_SOURCE_SHA',0);
  if(![3,7,15].includes(trace.carrier_count))fail('INVALID_CARRIER_COUNT',0);
  const actors=new Map(), requests=new Map(), tasks=new Map(), carriers=new Map(), seenCarriers=new Set();
  let seq=0, lookups=0;
  for(const [i,e] of trace.events.entries()){
    if(!e || !Number.isSafeInteger(e.seq) || e.seq<=seq)fail('NONMONOTONIC_EVENT',i);
    seq=e.seq;
    if(e.op==='mail_start'){
      if(!present(e.actor)||!Number.isSafeInteger(e.generation)||e.generation<1||!Number.isSafeInteger(e.mail)||e.mail<0)fail('INVALID_MAIL',i);
      const key=id(e.actor,e.generation), a=actors.get(key)||{active:null,last:-1};
      if(a.active!==null || e.mail<=a.last)fail('MAIL_OVERLAP_OR_REPLAY',i);
      a.active=e.mail;a.last=e.mail;actors.set(key,a);
    } else if(e.op==='request_open'){
      if(!present(e.request)||!present(e.actor)||!Number.isSafeInteger(e.generation)||e.generation<1 || !Number.isSafeInteger(e.mail)||e.mail<0 ||requests.has(e.request))fail('INVALID_REQUEST',i);
      const a=actors.get(id(e.actor,e.generation));
      if(!a||a.active!==e.mail || [...requests.values()].some(r=>r.actor===e.actor&&r.generation===e.generation&&r.mail===e.mail))fail('REQUEST_NOT_IN_MAIL',i);
      requests.set(e.request,{actor:e.actor,generation:e.generation,mail:e.mail,claimed:false,closed:false,retired:false});
    } else if(e.op==='turn_enter'){
      if(!present(e.carrier)||!present(e.actor)||!Number.isSafeInteger(e.generation)||e.generation<1||!['user','source_task','callback'].includes(e.kind)||carriers.has(e.carrier))fail('INVALID_TURN',i);
      if([...carriers.values()].some(x=>x.actor===e.actor&&x.generation===e.generation))fail('TWO_ACTOR_CARRIERS',i);
      const actor=actors.get(id(e.actor,e.generation));
      if(!actor)fail('UNKNOWN_ACTOR_MAIL',i);
      let mail=-1;
      if(e.kind==='user'){
        if(actor.active!==e.mail)fail('WRONG_MAIL',i);
        mail=e.mail;
      }
      if(e.kind==='source_task'){
        const t=tasks.get(e.task);
        if(!t||t.closed||t.actor!==e.actor||t.generation!==e.generation||t.mail!==e.mail||actor.active!==e.mail)fail('FORGED_TASK_ORIGIN',i);
        mail=t.mail;
      }
      // Producer/callback turns never inherit the source mail, regardless of payload.
      carriers.set(e.carrier,{actor:e.actor,generation:e.generation,mail,kind:e.kind});seenCarriers.add(e.carrier);
    } else if(e.op==='turn_leave'){
      if(!carriers.delete(e.carrier))fail('MISSING_TURN',i);
    } else if(e.op==='request_claim' || e.op==='request_lookup'){
      const r=requests.get(e.request),scope=carriers.get(e.carrier);
      if(!r||r.closed||r.retired||!scope||scope.mail!==r.mail||scope.actor!==r.actor||scope.generation!==r.generation)fail('NO_ADMITTED_REQUEST',i);
      if(e.op==='request_claim'){
        if(r.claimed||scope.kind!=='user')fail('DUPLICATE_OR_FOREIGN_CLAIM',i);
        r.claimed=true;
      }else{
        if(!r.claimed)fail('UNCLAIMED_REQUEST',i);
        lookups++;
      }
    } else if(e.op==='task_create'){
      const scope=carriers.get(e.carrier),r=requests.get(e.request);
      if(!present(e.task)||tasks.has(e.task)||!scope||!r||!r.claimed||r.closed||r.retired||scope.mail!==r.mail||scope.actor!==r.actor||scope.generation!==r.generation||scope.kind==='callback')fail('UNAUTHENTICATED_TASK_ORIGIN',i);
      tasks.set(e.task,{actor:r.actor,generation:r.generation,mail:r.mail,request:e.request,closed:false});
    } else if(e.op==='task_finish'){
      const t=tasks.get(e.task);if(!t||t.closed)fail('INVALID_TASK_FINISH',i);
      t.closed=true;
    } else if(e.op==='request_close'){
      const r=requests.get(e.request);if(!r||r.closed||r.retired)fail('INVALID_CLOSE',i);
      r.closed=true;
    } else if(e.op==='mail_finish'){
      const a=actors.get(id(e.actor,e.generation));
      if(!a||a.active!==e.mail||[...carriers.values()].some(x=>x.actor===e.actor&&x.generation===e.generation)||[...tasks.values()].some(t=>t.actor===e.actor&&t.generation===e.generation&&t.mail===e.mail&&!t.closed))fail('PREMATURE_MAIL_FINISH',i);
      a.active=null;
    } else if(e.op==='request_retire'){
      const r=requests.get(e.request);
      if(!r||!r.closed||r.retired || [...tasks.values()].some(t=>t.request===e.request&&!t.closed)||[...carriers.values()].some(x=>x.actor===r.actor&&x.generation===r.generation&&x.mail===r.mail))fail('PREMATURE_REQUEST_RETIRE',i);
      r.retired=true;
    } else if(e.op==='producer_notify'){
      // Completion is only notification; it does not install or read request authority.
      if(!tasks.has(e.task))fail('UNKNOWN_PRODUCER_TASK',i);
    } else fail('UNKNOWN_EVENT',i);
  }
  if(carriers.size || [...actors.values()].some(a=>a.active!==null)||[...requests.values()].some(r=>!r.retired)||[...tasks.values()].some(t=>!t.closed))fail('INCOMPLETE_TRACE',trace.events.length);
  if(seenCarriers.size!==trace.carrier_count)fail('CARRIER_PARTICIPATION_MISMATCH',trace.events.length);
  return {status:'consistent_model_trace_not_backend_pass',checked_events:trace.events.length,lookups,carriers:seenCarriers.size};
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  try{if(process.argv.length!==3)throw Error('usage: node verify-http-origin.mjs FILE.json');console.log(JSON.stringify(verifyHttpOriginTrace(JSON.parse(readFileSync(process.argv[2],'utf8')))));}
  catch(e){console.error(String(e));process.exitCode=1;}
}
