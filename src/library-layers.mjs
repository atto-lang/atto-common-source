// Structural source admission only. Not a compiler, linker, or freestanding proof.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ORDER = Object.freeze({core:0, alloc:1, std:2});
const PROFILES = Object.freeze({
  core: ['core'],
  alloc: ['core','alloc'],
  std: ['core','alloc','std']
});
const SCHEMA='atto.library.layers.v1';
const FAIL = (code, detail) => { throw new TypeError(code + ': ' + detail); };
const exact=(o,keys,where)=>{
  if (!o || typeof o!=='object' || Array.isArray(o) || Object.getPrototypeOf(o)!==Object.prototype)
    FAIL('E_LIBRARY_MANIFEST',where+' must be plain object');
  if (Object.keys(o).sort().join('|')!==keys.slice().sort().join('|'))
    FAIL('E_LIBRARY_MANIFEST',where+' has missing/extra fields');
};
const canonical=p=>typeof p==='string' && /^stdlib\/(core|alloc|std)\/[A-Za-z0-9_/-]+\.atto$/.test(p)
 && !p.split('/').includes('..') && !p.includes('//');
const uniqueArray=(v,where)=>{
  if (!Array.isArray(v)|| Object.keys(v).length!==v.length || new Set(v).size!==v.length)
    FAIL('E_LIBRARY_MANIFEST',where+' is not dense and unique');
};
// Simple lexical scanner, protecting comments/strings from host-name false positives.
// Unknown/unclosed source forms are rejected rather than guessed safe.
export function lexAtto(source){
  if(typeof source!=='string') FAIL('E_LIBRARY_SOURCE','source must be UTF-8 string');
  if(source.includes(String.fromCharCode(0)) || source.includes(String.fromCharCode(0xfeff)))
    FAIL('E_LIBRARY_SOURCE','NUL/BOM is not legal canonical Atto source');
  const out=[];let i=0;
  while(i<source.length){
    const ch=source[i],nx=source[i+1];
    if(/\s/.test(ch)){i++;continue;}
    if(ch==='/' && nx==='/'){i=source.indexOf('\n',i+2);if(i<0)break;continue;}
    if(ch==='/' && nx==='*'){
      const end=source.indexOf('*/',i+2);
      if(end<0) FAIL('E_LIBRARY_SOURCE','unclosed block comment');
      i=end+2;continue;
    }
    if(ch==='"'||ch==="'"){
      const quote=ch;let value='',closed=false;i++;
      while(i<source.length){
        if(source[i]==='\\'){if(i+1>=source.length)break;value+=source[i+1];i+=2;continue;}
        if(source[i]===quote){i++;closed=true;break;}
        value+=source[i++];
      }
      if(!closed) FAIL('E_LIBRARY_SOURCE','unclosed string literal');
      out.push({kind:'string',value});continue;
    }
    if(/[A-Za-z_]/.test(ch)){
      const start=i++;while(i<source.length&&/[A-Za-z0-9_]/.test(source[i]))i++;
      out.push({kind:'word',value:source.slice(start,i)});continue;
    }
    if(/[0-9]/.test(ch)){
      const start=i++;while(i<source.length&&/[A-Za-z0-9_]/.test(source[i]))i++;
      out.push({kind:'number',value:source.slice(start,i)});continue;
    }
    out.push({kind:'punct',value:ch});i++;
  }
  return out;
}
const at=(t,i)=>t[i]?.value;
export function inspectAtto(source,layer){
  if(!(layer in ORDER))FAIL('E_LIBRARY_MANIFEST','unknown layer');
  const t=lexAtto(source), imports=[];
  for(let i=0;i<t.length;i++){
    const w=at(t,i),next=at(t,i+1);
    if(w==='import'&&t[i].kind==='word'){
      let p;
      if(next==='module' && t[i+2]?.kind==='word'&&at(t,i+3)==='from'
          &&t[i+4]?.kind==='string'){
        p=t[i+4].value;i+=4;
      }else if(t[i+1]?.kind==='string'){p=t[i+1].value;i++;}
      else FAIL('E_LIBRARY_IMPORT','unrecognized import syntax');
      if(!canonical(p))FAIL('E_LIBRARY_IMPORT','import must use canonical stdlib path: '+p);
      if(at(t,i+1)!==';')FAIL('E_LIBRARY_IMPORT','import must end with semicolon');
      imports.push(p);i++;continue;
    }
    if(w==='extern'||w==='foreign'||w==='syscall'||w==='dlopen'||w==='ffi')
      FAIL('E_LIBRARY_HOST','foreign/host entrypoint in portable source');
    if(layer!=='std'){
      if(w==='using'&&next==='io')FAIL('E_LIBRARY_HOST','host I/O effect in freestanding layer');
      if(['stdio','process','filesystem','socket','thread','net','os','std','wasi','libc','java','dotnet'].includes(w)
         && (next==='.' || (next===':' && at(t,i+2)===':')))FAIL('E_LIBRARY_HOST','host namespace '+w);
      if(w==='std'&&next==='.' )FAIL('E_LIBRARY_HOST','std reference');
      if(w==='System'&&next==='.')FAIL('E_LIBRARY_HOST','host system reference');
    }
    // Portable core/alloc may not depend on the actor scheduler or suspend.
    // Hosted std can use async adapters, but the actor platform is separate.
    if(t[i].kind==='word' &&
       ((layer!=='std' && ['spawn','await','select','suspend','actor','supervisor','mailbox','Channel','ActorGroup'].includes(w)) ||
        (layer==='std' && ['actor','supervisor','ActorGroup'].includes(w))))
      FAIL('E_LIBRARY_RUNTIME','actor/scheduler construct in '+layer+': '+w);
    if(layer==='core'){
      if(w==='new')FAIL('E_LIBRARY_ALLOCATION','new in core');
      if(w==='alloc'&&next==='.')FAIL('E_LIBRARY_ALLOCATION','alloc namespace in core');
      if(['Array','List','Map','Set','Box','Arc','String'].includes(w) && t[i].kind==='word')
        FAIL('E_LIBRARY_ALLOCATION','potential heap-backed '+w+' in core');
    }
  }
  if(new Set(imports).size!==imports.length)FAIL('E_LIBRARY_IMPORT','duplicate import');
  return imports;
}
// The caller must enumerate all stdlib/*.atto files. Missing sources are rejection, not a pass.
export function validateLibraryLayers(manifest,sources){
  exact(manifest,['schema','status','sources','proof'], 'manifest');
  if(manifest.schema!==SCHEMA||manifest.status!=='CANDIDATE_NOT_EXECUTED')
    FAIL('E_LIBRARY_MANIFEST','schema/status mismatch');
  exact(manifest.proof,['compiledGuestCases','freestandingImageLinked','backendParityVerified'],'proof');
  if(manifest.proof.compiledGuestCases!==0||manifest.proof.freestandingImageLinked!==false
     ||manifest.proof.backendParityVerified!==false)
    FAIL('E_LIBRARY_EVIDENCE','structural-only manifest cannot claim guest proof');
  if(!Array.isArray(manifest.sources)||manifest.sources.length===0)
    FAIL('E_LIBRARY_MANIFEST','empty inventory');
  exact(sources,['files'],'source set');
  exactSourceFiles(sources.files);
  const byPath=new Map;
  for(const e of manifest.sources){
    exact(e,['path','layer','imports','capabilities','execution'],'source');
    if(!canonical(e.path)||e.path.split('/')[1]!==e.layer)
      FAIL('E_LIBRARY_MANIFEST','invalid source path/layer');
    if(byPath.has(e.path))FAIL('E_LIBRARY_MANIFEST','duplicate source path');
    if(e.execution!=='NOT_EXECUTED')FAIL('E_LIBRARY_EVIDENCE','backend execution unverified');
    uniqueArray(e.imports,e.path+' imports');
    uniqueArray(e.capabilities,e.path+' capabilities');
    if(e.imports.some(p=>!canonical(p)))
      FAIL('E_LIBRARY_MANIFEST','noncanonical imports');
    const caps={core:['pure','target.atomic','target.mmio'],alloc:['pure','allocator','target.atomic','target.mmio'],
      std:['pure','allocator','os.fs','os.net','os.process','os.clock','os.stdio','host.scheduler','host.ffi']};
    if(e.capabilities.some(c=>!caps[e.layer].includes(c)))
      FAIL('E_LIBRARY_CAPABILITY','forbidden capability for '+e.path);
    byPath.set(e.path,e);
  }
  const actual=Object.keys(sources.files).sort(), declared=[...byPath.keys()].sort();
  if(JSON.stringify(actual)!==JSON.stringify(declared))
    FAIL('E_LIBRARY_INVENTORY','all checked-in .atto files must be registered');
  for(const [p,e] of byPath){
    const imports=inspectAtto(sources.files[p],e.layer);
    if(JSON.stringify(imports.slice().sort())!==JSON.stringify(e.imports.slice().sort()))
      FAIL('E_LIBRARY_IMPORT','declared/actual imports differ for '+p);
    for(const dep of imports){
      const target=byPath.get(dep);
      if(!target)FAIL('E_LIBRARY_IMPORT','unregistered dependency '+dep);
      if(ORDER[target.layer]>ORDER[e.layer])
        FAIL('E_LIBRARY_LAYER',e.layer+' cannot depend on '+target.layer);
    }
  }
  // Upward edges are rejected above. Cycles within a layer are forbidden too,
  // including self-imports, to keep module initialization and linking acyclic.
  const state=new Map();
  const visit=(p,trail)=>{
    if(state.get(p)===1)
      FAIL('E_LIBRARY_CYCLE','import cycle: '+[...trail,p].join(' -> '));
    if(state.get(p)===2)return;
    state.set(p,1);
    for(const dep of byPath.get(p).imports) visit(dep,[...trail,p]);
    state.set(p,2);
  };
  for(const p of byPath.keys())visit(p,[]);
  return {structuralAdmission:true,freestandingGuestProved:false,backendParityCertified:false,
    libraryCount:byPath.size,profiles:PROFILES};
}
function exactSourceFiles(files){
  if(!files||typeof files!=='object'||Array.isArray(files)||Object.getPrototypeOf(files)!==Object.prototype)
    FAIL('E_LIBRARY_INVENTORY','source set must be a plain object');
  for(const [p,s] of Object.entries(files)){
    if(!canonical(p)||typeof s!=='string')FAIL('E_LIBRARY_INVENTORY','unknown source path/content');
  }
}
export function readLibraryTree(root){
  const files={};const stdlib=path.join(root,'stdlib');
  if(fs.existsSync(stdlib) && !fs.lstatSync(stdlib).isDirectory())
    FAIL('E_LIBRARY_INVENTORY','stdlib root must be a real directory, never a symlink');
  const visit=(dir)=>{
    if(!fs.existsSync(dir))return;
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const p=path.join(dir,e.name);
      if(e.isSymbolicLink())FAIL('E_LIBRARY_INVENTORY','symlink in stdlib');
      if(e.isDirectory())visit(p);
      else if(e.isFile()&&p.endsWith('.atto')){
        const rel=path.relative(root,p).split(path.sep).join('/');
        if(!canonical(rel))FAIL('E_LIBRARY_INVENTORY','unclassified .atto path: '+rel);
        const b=fs.readFileSync(p);
        if(b.length>=3 && b[0]===0xef && b[1]===0xbb && b[2]===0xbf)
          FAIL('E_LIBRARY_SOURCE','UTF-8 BOM forbidden in '+rel);
        const src=new TextDecoder('utf-8',{fatal:true}).decode(b);
        files[rel]=src;
      }else if(!e.isFile())FAIL('E_LIBRARY_INVENTORY','non-regular library entry');
    }
  };visit(stdlib);
  return {files};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const root=path.resolve(process.argv[2]||'.');
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'contracts/library-layers-v1.json'),'utf8'));
    const result=validateLibraryLayers(manifest,readLibraryTree(root));
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error(String(e));process.exitCode=1;}
}
