// Shared Unicode corpus via the real JS program-v2 compiler; no host result emulation.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkoutArg,head,tree]=process.argv.slice(2);
if(!checkoutArg||![head,tree].every(x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)))throw Error('usage: node run-unicode-js-conformance-v1.mjs CLEAN_CHECKOUT HEAD TREE');
const checkout=resolve(checkoutArg);
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:checkout,encoding:'utf8',timeout:30000});if(r.error||r.signal||r.status!==0)throw Error('git failure: '+r.stderr);return r.stdout.trim()};
const verify=()=>{if(git('rev-parse','HEAD')!==head||git('rev-parse','HEAD^{tree}')!==tree||git('write-tree')!==tree||git('status','--porcelain','--untracked-files=all')!=='')throw Error('compiler identity or checkout mismatch')};
verify();
const bytes=readFileSync(new URL('../contracts/conformance/unicode-identifiers-negation-v1.json',import.meta.url));
const manifest=JSON.parse(bytes);
if(manifest.schema!=='atto.unicode-identifiers-negation.v1'||!Array.isArray(manifest.cases)||!manifest.cases.length||new Set(manifest.cases.map(c=>c.id)).size!==manifest.cases.length)throw Error('invalid corpus');
const tmp=mkdtempSync(join(tmpdir(),'atto-js-corpus-'));
const compiler=join(checkout,'src/program-v2.mjs');
const compileWorker=join(tmp,'compile.mjs');
writeFileSync(compileWorker,`import {readFileSync,writeFileSync} from 'node:fs';
const [compiler,source,out]=process.argv.slice(2);
const {compileProgramV2}=await import(compiler);
const text=readFileSync(source,'utf8');
let output;
try{output=compileProgramV2(text)}catch(e){if(!(e instanceof Error))throw e;console.error(JSON.stringify({name:e.name,message:e.message}));process.exit(1)}
if(typeof output!=='string')throw Error('compiler did not emit JS text');
writeFileSync(out,output);`);
const guestWorker=join(tmp,'guest.mjs');
writeFileSync(guestWorker,`import {pathToFileURL} from 'node:url';
const guest=await import(pathToFileURL(process.argv[2]).href);
const value=await guest.main();
if(typeof value!=='bigint')throw Error('expected bigint result');
console.log(value.toString());`);
const run=(script,args)=>spawnSync(process.execPath,[script,...args],{cwd:tmp,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
const rows=[];
try{
 for(const c of manifest.cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||typeof c.source!=='string'||!(Number.isSafeInteger(c.expect)||c.expect==='reject'&&typeof c.diagnostic==='string'))throw Error('invalid case');
  const source=join(tmp,c.id+'.atto'),out=join(tmp,c.id+'.mjs');
  writeFileSync(source,c.source,'utf8');
  const r=run(compileWorker,[pathToFileURL(compiler).href,source,out]);
  const row={id:c.id,sourceSha256:hash(readFileSync(source)),expected:c.expect,artifact:existsSync(out),compilerExit:r.status,status:'FAIL'};
  try{
   if(r.error||r.signal)throw Error('compiler infrastructure failure');
   if(c.expect==='reject'){
    let d;try{d=JSON.parse(r.stderr.trim())}catch{throw Error('not a compiler diagnostic: '+r.stderr)}
    if(r.status!==1||row.artifact||typeof d.message!=='string'||!/^(Error|SyntaxError|TypeError|CompileError)$/.test(d.name)||!new RegExp(c.diagnostic,'i').test(d.message)||/entrypoint|main\(\).*return|not implemented|unsupported feature/i.test(d.message))throw Error('unexpected rejection: '+d.message);
    row.diagnostic=d.message;
   }else{
    if(r.status!==0||!row.artifact)throw Error('compiler failure: '+r.stderr);
    row.guestSha256=hash(readFileSync(out));
    const g=run(guestWorker,[out]);
    if(g.error||g.signal||g.status!==0)throw Error('guest execution failure: '+g.stderr);
    row.actual=g.stdout.trim();
    if(row.actual!==String(c.expect))throw Error('wrong guest result');
   }
   row.status='PASS';
  }catch(e){row.failure=e.message}
  rows.push(row);
 }
 verify();
 console.log(JSON.stringify({schema:'atto.unicode-js-execution.v1',compilerHead:head,compilerTree:tree,compilerEntrypointSha256:hash(readFileSync(compiler)),corpusSha256:hash(bytes),node:process.version,rows},null,2));
 if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
}finally{rmSync(tmp,{recursive:true,force:true})}
