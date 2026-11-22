import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generate_perf_probes} from '../tools/generate-perf-probes.mjs';

const contract=JSON.parse(readFileSync(new URL('../contracts/perf-probes-aot-v1.json',import.meta.url),'utf8'));
const input=()=>structuredClone(contract);
const run=x=>generate_perf_probes(x);
test('build-time only, AOT-first, backend-independent contract',()=>{
  assert.equal(contract.status,'CONTRACT_ONLY_NO_GUEST_EXECUTION_CREDIT');
  assert.equal(contract.rules.aot_compiled_without_runtime_jit,true);
  assert.equal(contract.rules.optional_jit_only_specializes_existing_sites,true);
  assert.equal(contract.rules.dynamic_disabled_probe_does_not_read_clock,true);
  assert.equal(contract.rules.per_actor_buffer_bounded,true);
});
test('same shuffled registry produces byte-identical Atto source and plan',()=>{
  const a=run(input()),b=input();
  b.registry.reverse();
  assert.deepEqual(run(b),a);
  assert.match(a.source,/define module PerfIds as/);
  assert.match(a.source,/pub fnc actor_user_mail_queue\(\) -> int \{ return 23; \}/);
  assert.equal(a.plan.runtime_jit_required,false);
  assert.equal(a.plan.probes.length,7);
  assert.equal(a.plan.source_registry_sha256.length,64);
});
test('adding a probe does not renumber existing IDs',()=>{
  const base=run(input()).plan.probes;
  const x=input();x.registry.unshift({id:1,name:'alloc.arena.release',kind:'counter',sampling_divisor:8});
  const updated=run(x).plan.probes;
  for(const row of base)assert.deepEqual(updated.find(p=>p.name===row.name),row);
});
const invalid=[
 ['duplicate id',x=>x.registry.push({...x.registry[0],name:'new.probe'})],
 ['duplicate name',x=>x.registry.push({...x.registry[0],id:42})],
 ['generated symbol collision',x=>x.registry.push({id:42,name:'actor_user_mail_queue',kind:'span',sampling_divisor:1})],
 ['negative id',x=>x.registry[0].id=-2],
 ['fractional id',x=>x.registry[0].id=1.5],
 ['unsafe name',x=>x.registry[0].name='trace"; rt fail("oops")'],
 ['too long name',x=>x.registry[0].name='a'.repeat(121)],
 ['unknown kind',x=>x.registry[0].kind='unbounded_log'],
 ['missing divisor',x=>delete x.registry[0].sampling_divisor],
 ['huge divisor',x=>x.registry[0].sampling_divisor=65537],
 ['too many probes',x=>x.registry=Array.from({length:4097},(_,i)=>({id:i+1,name:'p'+i,kind:'span',sampling_divisor:1}))],
 ['wrong schema',x=>x.schema='other'],
];
for(const [reason,change] of invalid)test('reject '+reason,()=>{
  const x=input();change(x);assert.throws(()=>run(x),/PERF_/);
});
test('emits static functions only: no runtime reflection, I/O, codegen or trace values',()=>{
 const {source}=run(input());
 assert.doesNotMatch(source,/process\.|stdio\.|eval\(|import|spawn|String|dynamic|String/);
 assert.match(source,/^\/\/ Generated /);
});
test('CLI fail-closed and output stable on repeated builds',()=>{
 const d=mkdtempSync(join(tmpdir(),'atto-probes-'));
 try{
  const exe=fileURLToPath(new URL('../tools/generate-perf-probes.mjs',import.meta.url));
  const registry=join(d,'registry.json'),source=join(d,'ids.atto'),plan=join(d,'plan.json');
  writeFileSync(registry,JSON.stringify(input()));
  const cli=()=>spawnSync(process.execPath,[exe,registry,source,plan],{encoding:'utf8',timeout:5000});
  const first=cli();assert.equal(first.status,0,first.stderr);
  const a=[readFileSync(source,'utf8'),readFileSync(plan,'utf8')];
  assert.equal(cli().status,0);
  assert.deepEqual([readFileSync(source,'utf8'),readFileSync(plan,'utf8')],a);
  const bad=input();bad.registry[0].name='../escape';writeFileSync(registry,JSON.stringify(bad));
  const failed=cli();assert.equal(failed.status,1);assert.match(failed.stderr,/PERF_NAME/);
  // Failures do not modify a previously emitted plan or source.
  assert.deepEqual([readFileSync(source,'utf8'),readFileSync(plan,'utf8')],a);
 } finally{rmSync(d,{recursive:true,force:true});}
});
