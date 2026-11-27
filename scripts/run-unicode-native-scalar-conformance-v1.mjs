// Exact-source differential audit for the ordinary Forge and Cranelift AOT scalar lanes.
// No source rewriting, reference evaluator, JIT, or strict-profile injection.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const [profile,rootArg,head,tree,compilerArg,cxx='c++']=process.argv.slice(2);
if(!['forge','cranelift'].includes(profile)||!rootArg||!compilerArg||![head,tree].every(x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)))throw Error('usage: runner forge|cranelift ROOT HEAD TREE COMPILER [CXX]');
const root=resolve(rootArg),compiler=resolve(compilerArg),hash=b=>createHash('sha256').update(b).digest('hex');
const run=(cmd,args,timeout=30000)=>spawnSync(cmd,args,{cwd:root,encoding:null,timeout,maxBuffer:16*1024*1024});
const str=b=>b.toString('utf8').trim();
const checked=(r,label)=>{if(r.error||r.signal||r.status!==0)throw Error(label+': '+str(r.stderr));return str(r.stdout)};
const git=(...args)=>checked(run('git',args),'git');
const verify=()=>{if(git('rev-parse','HEAD')!==head||git('rev-parse','HEAD^{tree}')!==tree||git('write-tree')!==tree||git('status','--porcelain','--untracked-files=all')!=='')throw Error('source identity mismatch')};
verify();
const bytes=readFileSync(new URL('../contracts/conformance/unicode-identifiers-negation-v1.json',import.meta.url)),m=JSON.parse(bytes);
if(m.schema!=='atto.unicode-identifiers-negation.v1'||m.cases.length!==19||new Set(m.cases.map(c=>c.id)).size!==19)throw Error('invalid manifest');
const tmp=mkdtempSync(join(tmpdir(),'atto-native-scalar-')),rows=[];
try{
 const driver=join(tmp,'driver.c');
 writeFileSync(driver,'#include <stdint.h>\n#include <stdio.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);\nint main(void){int64_t out=0;int32_t s=oreslang_scalar_entry(0,0,0,0,&out);if(s!=0)return 70;printf("%lld\\n",(long long)out);return 0;}\n');
 for(const c of m.cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||typeof c.source!=='string'||!(Number.isSafeInteger(c.expect)||c.expect==='reject'&&typeof c.diagnostic==='string'))throw Error('invalid case');
  const source=join(tmp,c.id+'.atto'),output=join(tmp,c.id+(profile==='forge'?'.cpp':'.o'));
  writeFileSync(source,c.source,'utf8');
  const r=run(compiler,profile==='forge'?[source,'-o',output]:['emit-object',source]);
  const row={id:c.id,expected:c.expect,sourceSha256:hash(readFileSync(source)),compilerExit:r.status,artifact:profile==='forge'?existsSync(output):r.stdout.length>0,status:'FAIL'};
  try{
   if(r.error||r.signal)throw Error('compiler infrastructure failure');
   if(c.expect==='reject'){
    const d=str(r.stderr).replace(/\s*\[file: [^\r\n]*\]\s*$/,'');
    row.diagnostic=d;
    if(r.status!==(profile==='forge'?2:1)||row.artifact||!d||!new RegExp(c.diagnostic,'i').test(d)||/entrypoint|main must|unsupported|limit|budget|panic|usage|file not found/i.test(d))throw Error('rejection reason not demonstrated');
    // Generic syntax alone cannot prove typed rejection, duplicate, bidi or unbound.
   }else{
    if(r.status!==0||!row.artifact)throw Error('compiler rejected positive: '+str(r.stderr));
    if(profile==='cranelift')writeFileSync(output,r.stdout);
    row.artifactSha256=hash(readFileSync(output));
    const app=join(tmp,c.id+'-guest');
    checked(run(profile==='forge'?cxx:'cc',profile==='forge'?['-std=c++20','-O2','-I'+join(root,'include'),output,'-o',app]:[driver,output,'-o',app]),'native link');
    const g=run(app,[],20000);
    row.actual=checked(g,'guest execution');
    if(row.actual!==String(c.expect))throw Error('wrong full-width guest result');
    row.guestSha256=hash(readFileSync(app));
   }
   row.status='PASS';
  }catch(e){row.failure=e.message}
  rows.push(row);console.log('UNICODE_CASE '+JSON.stringify(row));
 }
 verify();
 console.log(JSON.stringify({schema:'atto.unicode-native-scalar-execution.v1',profile,compilerHead:head,compilerTree:tree,compilerSha256:hash(readFileSync(compiler)),corpusSha256:hash(bytes),rows},null,2));
 if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
}finally{rmSync(tmp,{recursive:true,force:true})}
