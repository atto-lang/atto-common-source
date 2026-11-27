// Native LLVM CLI, linked guests at O0/O2, no host evaluator.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const [rootArg,head,tree,compilerArg,clang]=process.argv.slice(2);
if(!rootArg||!compilerArg||!clang||![head,tree].every(x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)))throw Error('usage: runner ROOT HEAD TREE COMPILER CLANG');
const root=resolve(rootArg),compiler=resolve(compilerArg),hash=b=>createHash('sha256').update(b).digest('hex');
const run=(cmd,args,timeout=60000)=>spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16*1024*1024});
const git=(...a)=>{const r=run('git',a);if(r.error||r.signal||r.status!==0)throw Error('git failure');return r.stdout.trim()};
const verify=()=>{if(git('rev-parse','HEAD')!==head||git('rev-parse','HEAD^{tree}')!==tree||git('write-tree')!==tree||git('status','--porcelain','--untracked-files=all')!=='')throw Error('source identity mismatch')};
verify();
const bytes=readFileSync(new URL('../contracts/conformance/unicode-identifiers-negation-v1.json',import.meta.url)),m=JSON.parse(bytes);
if(m.schema!=='atto.unicode-identifiers-negation.v1'||m.cases.length!==19||new Set(m.cases.map(c=>c.id)).size!==19)throw Error('invalid manifest');
const tmp=mkdtempSync(join(tmpdir(),'atto-llvm-native-')),rows=[];
try{
 for(const c of m.cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||typeof c.source!=='string'||!(Number.isSafeInteger(c.expect)||c.expect==='reject'&&typeof c.diagnostic==='string'))throw Error('invalid case');
  const source=join(tmp,c.id+'.atto'),ir=join(tmp,c.id+'.ll');
  writeFileSync(source,c.source,'utf8');
  const r=run(compiler,['--target=host',source]);
  const row={id:c.id,expected:c.expect,sourceSha256:hash(readFileSync(source)),compilerExit:r.status,artifact:r.stdout.length>0,status:'FAIL'};
  try{
   if(r.error||r.signal)throw Error('compiler infrastructure failure');
   if(c.expect==='reject'){
    const d=r.stderr.trim().replace(/\s*\[file: [^\r\n]*\]\s*$/,'');
    if(r.status!==1||row.artifact||!d||!new RegExp(c.diagnostic,'i').test(d)||/entrypoint|main must|file not found|unsupported feature/i.test(d))throw Error('unexpected rejection: '+d);
    row.diagnostic=d;
   }else{
    if(r.status!==0||!row.artifact)throw Error('compile failed: '+r.stderr);
    writeFileSync(ir,r.stdout);row.irSha256=hash(readFileSync(ir));row.guests=[];
    for(const opt of [0,2]){
     const app=join(tmp,c.id+'-O'+opt);
     const link=run(clang,['-O'+opt,'-x','ir',ir,'-o',app]);
     if(link.error||link.signal||link.status!==0||!existsSync(app))throw Error('link failed: '+link.stderr);
     const g=run(app,[],20000);
     if(g.error||g.signal||g.status!==(c.expect>=0&&c.expect<=255?c.expect:1))throw Error('guest exit mismatch: '+g.status);
     row.guests.push({opt,actualExit:g.status,sha256:hash(readFileSync(app))});
    }
    // The emitted C main deliberately rejects results outside [0,255].
    // Preserve that check above. The separate scalar-only witness calls
    // the actual emitted i64 guest, not the process-status wrapper.
    const irText=readFileSync(ir,'utf8');
    if(!/^define\s+[^\n@]*\bi64\s+@__oreslang_guest_main\(\s*\)/m.test(irText)||
       !/^define\s+[^\n@]*\bi32\s+@main\(\s*\)/m.test(irText)||
       /@atto_test_guest_result\b|@atto_test_process_main\b/.test(irText))
      throw Error('unexpected native guest ABI');
    const renamed=join(tmp,c.id+'-wide.ll'),harness=join(tmp,c.id+'-harness.c');
    writeFileSync(renamed,irText.replace(/@main\b/g,'@atto_test_process_main')+
      '\ndefine i64 @atto_test_guest_result() {\nentry:\n  %v = call i64 @__oreslang_guest_main()\n  ret i64 %v\n}\n');
    writeFileSync(harness,'#include <stdint.h>\n#include <stdio.h>\nextern int64_t atto_test_guest_result(void);\nint main(void){printf("%lld\\n",(long long)atto_test_guest_result());return 0;}\n');
    for(const opt of [0,2]){
     const app=join(tmp,c.id+'-wide-O'+opt);
     const link=run(clang,['-O'+opt,renamed,harness,'-o',app]);
     if(link.error||link.signal||link.status!==0)throw Error('wide witness link failed: '+link.stderr);
     const g=run(app,[],20000);
     if(g.error||g.signal||g.status!==0||g.stdout.trim()!==String(c.expect))throw Error('full-width guest result mismatch: '+g.stdout);
     Object.assign(row.guests.find(x=>x.opt===opt),{actual:g.stdout.trim(),wideBinarySha256:hash(readFileSync(app))});
    }
   }
   row.status='PASS';
  }catch(e){row.failure=e.message}
  rows.push(row);console.log('UNICODE_CASE '+JSON.stringify(row));
 }
 verify();
 console.log(JSON.stringify({schema:'atto.unicode-llvm-native-execution.v1',compilerHead:head,compilerTree:tree,compilerSha256:hash(readFileSync(compiler)),corpusSha256:hash(bytes),rows},null,2));
 if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
}finally{rmSync(tmp,{recursive:true,force:true})}
