// Exercise the actual rebuilt Wasm compiler through the canonical bridge.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [bridgeArg,bridgeHead,bridgeTree,rustArg,rustHead,rustTree,artifactArg]=process.argv.slice(2);
if(!bridgeArg||!rustArg||!artifactArg||![bridgeHead,bridgeTree,rustHead,rustTree].every(x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)))throw Error('usage: runner BRIDGE HEAD TREE RUST HEAD TREE COMPILER_WASM');
const bridge=resolve(bridgeArg),rust=resolve(rustArg),artifact=resolve(artifactArg);
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',timeout:30000});if(r.error||r.signal||r.status!==0)throw Error('git failure');return r.stdout.trim()};
const verify=(cwd,h,t)=>{if(git(cwd,'rev-parse','HEAD')!==h||git(cwd,'rev-parse','HEAD^{tree}')!==t||git(cwd,'write-tree')!==t||git(cwd,'status','--porcelain','--untracked-files=all')!=='')throw Error('source identity mismatch')};
verify(bridge,bridgeHead,bridgeTree);verify(rust,rustHead,rustTree);
const bytes=readFileSync(new URL('../contracts/conformance/unicode-identifiers-negation-v1.json',import.meta.url)),m=JSON.parse(bytes);
if(m.schema!=='atto.unicode-identifiers-negation.v1'||m.cases.length!==19||new Set(m.cases.map(c=>c.id)).size!==19)throw Error('invalid corpus');
const compilerBytes=readFileSync(artifact),compilerSha256=hash(compilerBytes);
const tmp=mkdtempSync(join(tmpdir(),'atto-wasm-bridge-'));
const worker=join(tmp,'worker.mjs');
writeFileSync(worker,`import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [bridge,artifact,source]=process.argv.slice(2);
const {createCompiler}=await import(bridge);
const c=await createCompiler(fs.readFileSync(artifact));
const r=c.compile(fs.readFileSync(source,'utf8'));
if(!r.ok){console.log(JSON.stringify({ok:false,artifact:'wasm' in r||'esm' in r,diagnostics:r.diagnostics}));process.exit(0)}
if(!(r.wasm instanceof Uint8Array))throw Error('missing guest artifact');
const mod=new WebAssembly.Module(r.wasm),imports=Object.create(null);
for(const {module,name,kind} of WebAssembly.Module.imports(mod)){
 if(kind!=='function')throw Error('unexpected import');
 (imports[module]??=Object.create(null))[name]=()=>{throw Error('unexpected host call')};
}
const v=new WebAssembly.Instance(mod,imports).exports.main();
if(typeof v!=='bigint')throw Error('expected i64');
console.log(JSON.stringify({ok:true,artifact:true,actual:v.toString(),guestSha256:createHash('sha256').update(r.wasm).digest('hex')}));
`);
const rows=[];
try{
 for(const c of m.cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||typeof c.source!=='string'||!(Number.isSafeInteger(c.expect)||c.expect==='reject'&&typeof c.diagnostic==='string'))throw Error('invalid case');
  const source=join(tmp,c.id+'.atto');writeFileSync(source,c.source,'utf8');
  const r=spawnSync(process.execPath,[worker,pathToFileURL(join(bridge,'src/canonical-browser-compiler.mjs')).href,artifact,source],{cwd:tmp,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
  const row={id:c.id,expected:c.expect,sourceSha256:hash(readFileSync(source)),status:'FAIL'};
  try{
   if(r.error||r.signal||r.status!==0)throw Error('infrastructure/guest failure: '+r.stderr);
   const v=JSON.parse(r.stdout);Object.assign(row,v);
   if(c.expect==='reject'){
    if(v.ok!==false||v.artifact!==false||!Array.isArray(v.diagnostics)||!v.diagnostics.some(d=>typeof d.message==='string'&&!/E_ENTRY|entrypoint/i.test(d.message)&&new RegExp(c.diagnostic,'i').test(d.message)))throw Error('irrelevant or absent rejection');
   }else if(v.ok!==true||v.artifact!==true||v.actual!==String(c.expect))throw Error('wrong guest result');
   row.status='PASS';
  }catch(e){row.failure=e.message}
  rows.push(row);
 }
 verify(bridge,bridgeHead,bridgeTree);verify(rust,rustHead,rustTree);
 if(hash(readFileSync(artifact))!==compilerSha256)throw Error('compiler artifact drift');
 console.log(JSON.stringify({schema:'atto.unicode-wasm-bridge-execution.v1',bridgeHead,bridgeTree,rustHead,rustTree,compilerSha256,corpusSha256:hash(bytes),rows},null,2));
 if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
}finally{rmSync(tmp,{recursive:true,force:true})}
