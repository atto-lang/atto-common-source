import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {plan_perf_sites} from '../tools/plan-perf-sites.mjs';

const registry=JSON.parse(readFileSync(new URL('../contracts/perf-probes-aot-v1.json',import.meta.url),'utf8'));
const sha='a'.repeat(64);
function base(){
 return {schema:'atto.perf-sites.v1',typed_ir_sha256:sha,mode:'aot',sites:[
   {site_id:100,module_id:1,function_id:1,probe_id:23,kind:'actor_mail',
    span_time:'wall',edges:['return','throw','cancel'],sampling_divisor:1,static_enabled:true},
   {site_id:101,module_id:1,function_id:2,probe_id:25,kind:'scheduler',
    span_time:'active',edges:['return','suspend','resume'],sampling_divisor:1,static_enabled:true}
 ]};
}
const plan=p=>plan_perf_sites(p,registry);
const bad=(name,change)=>test('fail closed: '+name,()=>{
 const v=base();change(v);assert.throws(()=>plan(v),/PERF_SITE_/);
});
test('typed-site AOT plan contains fixed numerics and no runtime JIT requirement',()=>{
 const p=plan(base());
 assert.equal(p.schema,'atto.perf-aot-site-plan.v1');
 assert.equal(p.mode,'aot');
 assert.equal(p.sites.length,2);
 assert.equal(p.has_runtime_jit_requirement,false);
 assert.equal(p.generated_guest_code,false);
 assert.match(p.assurance,/STRUCTURAL_PLAN_ONLY/);
 assert.match(p.plan_digest,/^[0-9a-f]{64}$/);
});
test('ordering of sites and edges cannot perturb closed AOT identities',()=>{
 const a=base(),b=base();b.sites.reverse();b.sites[1].edges.reverse();
 assert.deepEqual(plan(a),plan(b));
});
test('compile-time OFF cannot carry sites or require a JIT',()=>{
 const v=base();v.mode='off';v.sites=[];
 const out=plan(v);assert.equal(out.sites.length,0);
 assert.equal(out.has_runtime_jit_requirement,false);
});
test('optional JIT may optimize same AOT sites but never add/remove probes',()=>{
 const aot=plan(base()),v=base();v.mode='jit';
 v.aot_baseline={typed_ir_sha256:sha,plan_digest:aot.plan_digest};
 assert.equal(plan(v).plan_digest,aot.plan_digest);
 v.sites[0].probe_id=24;
 assert.throws(()=>plan(v),/PERF_SITE_JIT_DRIFT/);
});
test('disabled static site is fully excluded from compiled plan',()=>{
 const v=base();v.sites[0].static_enabled=false;
 const p=plan(v);
 assert.deepEqual(p.sites.map(x=>x.site_id),[101]);
});
bad('unknown probe',v=>v.sites[0].probe_id=404);
bad('duplicate site ids',v=>v.sites[1].site_id=100);
bad('out-of-range module id',v=>v.sites[0].module_id=0);
bad('invalid sampling divisor',v=>v.sites[0].sampling_divisor=2);
bad('runtime injected site key',v=>v.sites[0].actor_name='tenant:secret');
bad('unpaired suspension',v=>v.sites[1].edges=['return','suspend']);
bad('duplicate exit edge',v=>v.sites[0].edges=['return','return']);
bad('no terminal edge',v=>v.sites[0].edges=['suspend','resume']);
bad('unknown edge',v=>v.sites[0].edges=['return','secret_dump']);
bad('invalid typed IR sha',v=>v.typed_ir_sha256='not-a-digest');
bad('too many sites',v=>v.sites=Array.from({length:4097},(_,i)=>({...v.sites[0],site_id:i+1})));
bad('off still has sites',v=>v.mode='off');
bad('aot carries baseline',v=>v.aot_baseline={typed_ir_sha256:sha,plan_digest:'f'.repeat(64)});
bad('jit has no baseline',v=>v.mode='jit');
bad('jit stale baseline',v=>{v.mode='jit';v.aot_baseline={typed_ir_sha256:'b'.repeat(64),plan_digest:'c'.repeat(64)};});
test('JIT cannot change suspend timing, exit edges, or static site enablement',()=>{
 const v=base(),digest=plan(v).plan_digest;
 for(const change of [
  x=>x.sites[1].span_time='wall',
  x=>x.sites[1].edges=['return','cancel','suspend','resume'],
  x=>x.sites[0].static_enabled=false
 ]){
  const p=base();p.mode='jit';p.aot_baseline={typed_ir_sha256:sha,plan_digest:digest};
  change(p);assert.throws(()=>plan(p),/PERF_SITE_JIT_DRIFT/);
 }
});
test('planner CLI writes only after complete validation',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'atto-sites-'));
 try{
  const executable=fileURLToPath(new URL('../tools/plan-perf-sites.mjs',import.meta.url));
  const inFile=join(tmp,'sites.json'),regFile=join(tmp,'registry.json'),out=join(tmp,'out.json');
  writeFileSync(inFile,JSON.stringify(base()));
  writeFileSync(regFile,JSON.stringify(registry));
  const command=()=>spawnSync(process.execPath,[executable,inFile,regFile,out],{encoding:'utf8',timeout:5000});
  const good=command();assert.equal(good.status,0,good.stderr);
  const earlier=readFileSync(out,'utf8');
  const invalid=base();invalid.sites[0].site_id=invalid.sites[1].site_id;
  writeFileSync(inFile,JSON.stringify(invalid));
  const denied=command();assert.equal(denied.status,1);
  assert.match(denied.stderr,/PERF_SITE_ID/);
  assert.equal(readFileSync(out,'utf8'),earlier,'failed regeneration changed existing plan');
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
