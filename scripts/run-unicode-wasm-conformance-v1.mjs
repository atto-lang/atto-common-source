// Executes the shared corpus through the real Rust or LLVM browser CLI.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const [profile, checkoutArg, expectedHead, expectedTree] = process.argv.slice(2);
if (!['rust','llvm-browser'].includes(profile) || !checkoutArg ||
    ![expectedHead,expectedTree].every(x=>typeof x==='string' && /^[a-f0-9]{40}$/.test(x)))
  throw Error('usage: node run-unicode-wasm-conformance-v1.mjs rust|llvm-browser CLEAN_CHECKOUT HEAD TREE');
const checkout=resolve(checkoutArg);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=readFileSync(new URL('../contracts/conformance/unicode-identifiers-negation-v1.json',import.meta.url));
const manifest=JSON.parse(manifestBytes);
if(manifest.schema!=='atto.unicode-identifiers-negation.v1' || !Array.isArray(manifest.cases) ||
   !manifest.cases.length || new Set(manifest.cases.map(c=>c.id)).size!==manifest.cases.length)
  throw Error('invalid or duplicate corpus cases');
for(const c of manifest.cases)
  if(!/^[a-z0-9-]+$/.test(c.id)||typeof c.source!=='string'||
     !(Number.isSafeInteger(c.expect)||c.expect==='reject'&&typeof c.diagnostic==='string'))
    throw Error('invalid corpus case '+c.id);
const run=(cmd,args,cwd,timeout=30000)=>spawnSync(cmd,args,{cwd,encoding:'utf8',timeout,maxBuffer:8*1024*1024});
function checked(r,label){
  if(r.error||r.signal||r.status!==0)throw Error(label+': '+(r.error?.message||r.stderr||r.signal||r.status));
  return r.stdout.trim();
}
const git=(...args)=>checked(run('git',args,checkout),'git '+args.join(' '));
function verify(){
  if(git('rev-parse','HEAD')!==expectedHead||git('rev-parse','HEAD^{tree}')!==expectedTree||
     git('write-tree')!==expectedTree||git('status','--porcelain','--untracked-files=all')!=='')
    throw Error('source identity or clean checkout mismatch');
}
verify();
const tmp=mkdtempSync(join(tmpdir(),'atto-unicode-corpus-'));
const rows=[];
try {
  const cargoManifest=join(checkout,profile==='rust'?'Cargo.toml':'frontend/Cargo.toml');
  const target=join(tmp,'target');
  checked(run('cargo',['build','--locked','--manifest-path',cargoManifest,'--target-dir',target,'--bin','attoc'],checkout,600000),'compiler build');
  verify();
  const compiler=join(target,'debug',process.platform==='win32'?'attoc.exe':'attoc');
  const compilerSha256=sha256(readFileSync(compiler));
  for(const c of manifest.cases){
    const source=join(tmp,c.id+'.atto'), output=join(tmp,c.id+'.wasm');
    writeFileSync(source,c.source,'utf8');
    const compile=run(compiler,[source,'-o',output],tmp);
    const row={id:c.id,sourceSha256:sha256(readFileSync(source)),expected:c.expect,
      compilerExit:compile.status,artifact:existsSync(output),status:'FAIL'};
    try{
      if(compile.error||compile.signal)throw Error('compiler infrastructure failure: '+(compile.error?.message||compile.signal));
      if(c.expect==='reject'){
        if(compile.status!==1||row.artifact||!/(?:^|\s)E_[A-Z_]+:/.test(compile.stderr)||
           !new RegExp(c.diagnostic,'i').test(compile.stderr))throw Error('missing relevant compiler rejection');
        row.diagnostic=compile.stderr.trim();
        row.status='PASS';
      }else{
        if(compile.status!==0||!row.artifact)throw Error('positive compiler failure: '+compile.stderr);
        row.guestSha256=sha256(readFileSync(output));
        // A separate bounded child process executes the actual guest; host
        // imports are never allowed to supply a result or emulate a feature.
        const runner=`import fs from 'node:fs';
const m=new WebAssembly.Module(fs.readFileSync(process.argv[1]));
const imports=Object.create(null);
for(const {module,name,kind} of WebAssembly.Module.imports(m)){
 if(kind!=='function')throw Error('unexpected import kind');
 (imports[module]??=Object.create(null))[name]=()=>{throw Error('unexpected host call')};
}
const value=new WebAssembly.Instance(m,imports).exports.main();
if(typeof value!=='bigint')throw Error('expected i64 guest return');
console.log(value.toString());`;
        const result=checked(run(process.execPath,['--input-type=module','-e',runner,output],tmp,5000),'guest execution');
        row.actual=result;
        if(result!==String(c.expect))throw Error('incorrect guest result');
        row.status='PASS';
      }
    }catch(e){row.failure=String(e.message);}
    rows.push(row);
  }
  verify();
  console.log(JSON.stringify({schema:'atto.unicode-wasm-execution.v1',profile,
    compilerHead:expectedHead,compilerTree:expectedTree,compilerSha256,
    corpusSha256:sha256(manifestBytes),node:process.version,rows},null,2));
  if(rows.some(r=>r.status!=='PASS'))process.exitCode=1;
} finally {rmSync(tmp,{recursive:true,force:true});}
