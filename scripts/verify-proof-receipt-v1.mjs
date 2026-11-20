// Proof-record consistency only: NOT a solver, provenance attestor, or backend verifier.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const git=/^[a-f0-9]{40}$/, digest=/^[a-f0-9]{64}$/, id=/^[a-z][a-z0-9-]{1,79}$/;
const fail=(why)=>{throw new Error(why)};
function check(ok,why){if(!ok)fail(why)}
function exact(x,names,where){
 check(x && typeof x==='object' && !Array.isArray(x),where+' must be object');
 check(JSON.stringify(Object.keys(x).sort())===JSON.stringify([...names].sort()),where+' incorrect fields');
}
function hex(s,pattern,where){check(typeof s==='string'&&pattern.test(s),where+' invalid digest')}
function pos(n,where){check(Number.isSafeInteger(n)&&n>0,where+' must be positive')}
function job(j,repo,head,required){
 exact(j,['repository','headSha','checkedOutSha','runId','runAttempt','runnerId','jobId','conclusion','steps'],'job');
 check(j.repository===repo&&j.headSha===head&&j.checkedOutSha===head,'foreign/stale checkout');
 hex(j.headSha,git,'head');
 for(const k of ['runId','runAttempt','runnerId','jobId'])pos(j[k],k);
 check(j.conclusion==='success'&&Array.isArray(j.steps)&&j.steps.length>=required.length&&j.steps.length<=64,'unexecuted job');
 const seen=new Set();
 for(const s of j.steps){
  exact(s,['id','conclusion'],'step');
  check(id.test(s.id)&&s.conclusion==='success'&&!seen.has(s.id),'missing/failed/duplicate step');
  seen.add(s.id);
 }
 for(const name of required)check(seen.has(name),'missing required step '+name);
}
export function validateIr(i){
 exact(i,['schemaVersion','kind','contractId','function','semantics','source','assumptions','obligations'],'IR');
 check(i.schemaVersion===1&&i.kind==='ores-proof-ir'&&id.test(i.contractId),'unsupported IR');
 check(typeof i.function==='string'&&/^[a-z_][a-z0-9_]{0,79}$/.test(i.function),'bad function');
 exact(i.semantics,['integer','ownership','effects'],'semantics');
 check(i.semantics.integer==='signed-i64'&&i.semantics.ownership==='pure','unsupported scalar semantics');
 check(Array.isArray(i.semantics.effects)&&i.semantics.effects.length===0,'unmodeled effects');
 exact(i.source,['repository','commit','blob','path','mode','typedDigest'],'source');
 check(/^ores-truffle-oreslang\/[a-z0-9._-]+$/.test(i.source.repository),'source repo scope');
 hex(i.source.commit,git,'source commit');hex(i.source.blob,git,'source blob');
 check(typeof i.source.path==='string'&&i.source.path.length>0&&i.source.path.length<=300&&
  !i.source.path.startsWith('/')&&i.source.path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'unsafe source path');
 check(['reviewed-blob','checked-ast','typed-hir','typed-mir'].includes(i.source.mode),'unknown source mode');
 if(i.source.mode==='reviewed-blob')check(i.source.typedDigest===null,'reviewed blob cannot claim typed derivation');
 else hex(i.source.typedDigest,digest,'typed representation');
 check(Array.isArray(i.assumptions)&&i.assumptions.length>0&&i.assumptions.length<=16,'missing assumptions');
 check(i.assumptions.every(a=>typeof a==='string'&&a.length>0&&a.length<=300),'invalid assumption');
 check(new Set(i.assumptions).size===i.assumptions.length,'duplicate assumption');
 check(Array.isArray(i.obligations)&&i.obligations.length>=2&&i.obligations.length<=128,'missing obligations');
 const seen=new Set();let proved=0,mutated=0;
 for(const o of i.obligations){
  exact(o,['id','kind','logic','expected','querySha256'],'obligation');
  check(id.test(o.id)&&!seen.has(o.id)&&o.logic==='QF_BV','duplicate/unsupported obligation');seen.add(o.id);
  hex(o.querySha256,digest,'query');
  if(o.kind==='proof'){proved++;check(o.expected==='unsat','proof expected UNSAT')}
  else if(o.kind==='negative-control'){mutated++;check(o.expected==='sat','mutation expected SAT')}
  else fail('unknown obligation kind');
 }
 check(proved>0&&mutated>0,'proof and mutation controls required');
 return {proved,mutated};
}
export function validateBundle(irBytes,receipt){
 const bytes=Buffer.isBuffer(irBytes)?irBytes:Buffer.from(irBytes);
 check(bytes.length>0&&bytes.length<=1048576,'empty/oversized IR');
 const i=JSON.parse(bytes.toString('utf8'));const counts=validateIr(i);
 exact(receipt,['schemaVersion','kind','proofIrSha256','solver','results','job','guest'],'receipt');
 check(receipt.schemaVersion===1&&receipt.kind==='ores-proof-receipt','unsupported receipt');
 check(receipt.proofIrSha256===createHash('sha256').update(bytes).digest('hex'),'IR bytes hash mismatch');
 exact(receipt.solver,['name','version','binarySha256'],'solver');
 check(['z3','cvc5'].includes(receipt.solver.name)&&typeof receipt.solver.version==='string'&&
  receipt.solver.version.length>0&&receipt.solver.version.length<=120,'unsupported solver');
 hex(receipt.solver.binarySha256,digest,'solver executable');
 check(Array.isArray(receipt.results)&&receipt.results.length===i.obligations.length,'partial/extra results');
 const want=new Map(i.obligations.map(o=>[o.id,o.expected])),seen=new Set();
 for(const r of receipt.results){
  exact(r,['id','verdict','transcriptSha256'],'result');
  check(want.has(r.id)&&!seen.has(r.id)&&want.get(r.id)===r.verdict,'duplicate/unknown/wrong solver verdict');seen.add(r.id);
  hex(r.transcriptSha256,digest,'transcript');
 }
 job(receipt.job,i.source.repository,i.source.commit,['checkout-identity','solver-proofs']);
 if(receipt.guest!==null){
  const g=receipt.guest;
  exact(g,['backend','binarySha256','fixtureSha256','observationsSha256','cases','job'],'guest');
  check(['java-graal','llvm','dotnet','wasm','js','forge'].includes(g.backend),'unknown backend');
  for(const k of ['binarySha256','fixtureSha256','observationsSha256'])hex(g[k],digest,k);
  pos(g.cases,'cases');
  job(g.job,i.source.repository,i.source.commit,['checkout-identity','guest-build','guest-execution']);
 }
 return {classification:receipt.guest===null?'MODEL_RECORD_CONSISTENT_UNATTESTED':
  'MODEL_AND_GUEST_RECORDS_CONSISTENT_UNATTESTED',sourceMode:i.source.mode,...counts};
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  check(process.argv.length===4,'usage: node verify-proof-receipt-v1.mjs IR.json RECEIPT.json');
  const ir=readFileSync(process.argv[2]), receiptBytes=readFileSync(process.argv[3]);
  check(receiptBytes.length<=1048576,'receipt too large');
  console.log(JSON.stringify(validateBundle(ir,JSON.parse(receiptBytes.toString('utf8')))));
  console.error('Offline consistency only: no authenticated solver execution or backend proof');
 }catch(e){console.error('REJECTED: '+e.message);process.exitCode=2}
}
