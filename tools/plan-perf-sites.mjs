// Build-time typed-site instrumentation planner. NOT a guest compiler.
// Used after typed/effect/ownership IR; no runtime source expansion or JIT.
// Its IR digest is structural input, never an authenticated compilation receipt.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA=/^[a-f0-9]{64}$/;
const EDGES=new Set(['return','throw','raise','panic','cancel','suspend','resume']);
const SITE_KINDS=new Set(['function','actor_mail','scheduler','future','map','allocation']);
const KEYS=(obj,required,optional=[])=>{
 if(!obj||typeof obj!=='object'||Array.isArray(obj))
   throw Error('PERF_SITE_SHAPE: object expected');
 const actual=Object.keys(obj);
 if(actual.some(key=>!required.includes(key)&&!optional.includes(key)) ||
    required.some(key=>!Object.hasOwn(obj,key)))
   throw Error('PERF_SITE_SHAPE: unexpected or missing keys');
};
const int=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const digest=obj=>createHash('sha256').update(JSON.stringify(obj),'utf8').digest('hex');

export function plan_perf_sites(input,registry) {
 KEYS(input,['schema','typed_ir_sha256','mode','sites'],['aot_baseline']);
 if(input.schema!=='atto.perf-sites.v1'||!SHA.test(input.typed_ir_sha256))
   throw Error('PERF_SITE_SCHEMA: invalid typed IR digest');
 if(!['off','aot','jit'].includes(input.mode)||!Array.isArray(input.sites)||input.sites.length>4096)
   throw Error('PERF_SITE_BUDGET: mode or sites invalid');
 if(!registry||registry.schema!=='atto.perf-probes.v1'||!Array.isArray(registry.registry))
   throw Error('PERF_SITE_REGISTRY: missing versioned probe registry');
 const probes=new Map();
 for(const p of registry.registry) {
   if(!p||!int(p.id,1,2147483647)||probes.has(p.id)||!int(p.sampling_divisor,1,65536))
     throw Error('PERF_SITE_REGISTRY: duplicate/unsafe probe id or sampling divisor');
   probes.set(p.id,p);
 }
 if(input.mode==='off' && input.sites.length!==0)
   throw Error('PERF_SITE_OFF: no site may emit or read clock in OFF');
 if(input.mode!=='jit' && Object.hasOwn(input,'aot_baseline'))
   throw Error('PERF_SITE_BASELINE: baseline only used for JIT');
 if(input.mode==='jit'){
   KEYS(input.aot_baseline,['plan_digest','typed_ir_sha256']);
   if(!SHA.test(input.aot_baseline.plan_digest) ||
      input.aot_baseline.typed_ir_sha256!==input.typed_ir_sha256)
     throw Error('PERF_SITE_BASELINE: invalid/mismatched baseline');
 }
 const seen=new Set(), sites=[];
 for(const site of input.sites){
   KEYS(site,['site_id','module_id','function_id','probe_id','kind',
              'span_time','edges','sampling_divisor','static_enabled']);
   if(!int(site.site_id,1,2147483647)||!int(site.module_id,1,2147483647)||
      !int(site.function_id,1,2147483647)||!int(site.probe_id,1,2147483647)||
      seen.has(site.site_id))
     throw Error('PERF_SITE_ID: duplicate or out of bounds site identity');
   seen.add(site.site_id);
   const probe=probes.get(site.probe_id);
   if(!probe||!SITE_KINDS.has(site.kind)||!['wall','active'].includes(site.span_time)||
      site.sampling_divisor!==probe.sampling_divisor||typeof site.static_enabled!=='boolean')
     throw Error('PERF_SITE_CAPABILITY: unknown probe/kind/time/sampling');
   if(!Array.isArray(site.edges)||site.edges.length<1||site.edges.length>7||
      new Set(site.edges).size!==site.edges.length||
      site.edges.some(e=>typeof e!=='string'||!EDGES.has(e)))
     throw Error('PERF_SITE_EDGES: invalid/duplicate exit edge');
   const hasSuspend=site.edges.includes('suspend'),hasResume=site.edges.includes('resume');
   if(hasSuspend!==hasResume)
     throw Error('PERF_SITE_SUSPEND: suspend and resume must be paired');
   if(!site.edges.some(e=>['return','throw','raise','panic','cancel'].includes(e)))
     throw Error('PERF_SITE_EDGES: at least one terminal exit required');
   if(site.static_enabled){
     sites.push({
       site_id:site.site_id,module_id:site.module_id,function_id:site.function_id,
       probe_id:site.probe_id,kind:site.kind,span_time:site.span_time,
       edges:[...site.edges].sort(),sampling_divisor:site.sampling_divisor
     });
   }
 }
 sites.sort((a,b)=>a.site_id-b.site_id);
 const canonical={schema:'atto.perf-aot-site-plan.v1',
   typed_ir_sha256:input.typed_ir_sha256,sites};
 const plan_digest=digest(canonical);
 if(input.mode==='jit'&&input.aot_baseline.plan_digest!==plan_digest)
   throw Error('PERF_SITE_JIT_DRIFT: optional JIT changed an AOT site');
 return {
   ...canonical, mode:input.mode, plan_digest,
   has_runtime_jit_requirement:false,
   generated_guest_code:false,
   assurance:'STRUCTURAL_PLAN_ONLY_NOT_TYPED_IR_AUTHENTICATION'
 };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==5){
   process.stderr.write('Usage: node tools/plan-perf-sites.mjs <sites.json> <probe-registry.json> <out.json>\n');
   process.exitCode=2;
 }else{
   try{
     const sites=JSON.parse(readFileSync(process.argv[2],'utf8'));
     const probes=JSON.parse(readFileSync(process.argv[3],'utf8'));
     const plan=plan_perf_sites(sites,probes);
     writeFileSync(process.argv[4],JSON.stringify(plan,null,2)+'\n');
   }catch(e){
     process.stderr.write(String(e.message)+'\n');
     process.exitCode=1;
   }
 }
}
