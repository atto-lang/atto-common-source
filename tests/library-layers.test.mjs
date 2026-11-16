import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibraryLayers, inspectAtto, lexAtto, readLibraryTree } from '../src/library-layers.mjs';

const id='stdlib/core/identity.atto', al='stdlib/alloc/pool.atto', st='stdlib/std/file.atto';
const entry=(path,layer,imports=[],capabilities=['pure'])=>({
  path,layer,imports,capabilities,execution:'NOT_EXECUTED'
});
const manifest=()=>({schema:'atto.library.layers.v1',status:'CANDIDATE_NOT_EXECUTED',
  sources:[entry(id,'core')],proof:{
    compiledGuestCases:0,freestandingImageLinked:false,backendParityVerified:false}
});
const sources=()=>({files:{[id]:'pub fnc identity(int value) -> int { return value; }\n'}});
const add=(m,s,path,layer,imports,body,caps=['pure'])=>{
  m.sources.push(entry(path,layer,imports,caps));s.files[path]=body;
};
const check=(m,s)=>validateLibraryLayers(m,s);
const denied=(code,fn)=>assert.throws(fn,new RegExp('^TypeError: '+code+':'));

test('actual checked-in canonical source is covered; structural validation never certifies guest',()=>{
  const m=manifest();
  const src=readLibraryTree(new URL('..',import.meta.url).pathname);
  // This test runs on the source branch containing canonical-stdlib PR #6.
  assert.deepEqual(Object.keys(src.files),[id]);
  assert.deepEqual(check(m,src),{
    structuralAdmission:true,freestandingGuestProved:false,backendParityCertified:false,
    libraryCount:1,profiles:{core:['core'],alloc:['core','alloc'],std:['core','alloc','std']}
  });
});
test('all layers support downward imports without implicit OS and without false positives in strings/comments',()=>{
  const m=manifest(),s=sources();
  add(m,s,al,'alloc',[id],
    '/* stdio.out << 1; import "stdlib/std/file.atto"; */\n'+
    'import module identity from "stdlib/core/identity.atto";\n'+
    'pub fnc pool() -> int { return 1; }\n',['allocator']);
  add(m,s,st,'std',[al],
    'import module pool from "stdlib/alloc/pool.atto";\n'+
    'pub fnc show() -> int { val string literal = "extern stdio"; return 1; }\n',['os.fs']);
  assert.equal(check(m,s).libraryCount,3);
  assert.deepEqual(inspectAtto('// import "stdlib/std/file.atto";\n'+
    'pub fnc x() -> int { return 1; }','core'),[]);
  assert.equal(lexAtto('"stdio.out" /* extern */').filter(x=>x.kind==='word').length,0);
});
test('core cannot import alloc or std; alloc cannot import std (including transitive graph)',()=>{
  for(const [srcLayer,srcPath,targetPath,targetLayer] of [
    ['core',id,al,'alloc'],['core',id,st,'std'],['alloc',al,st,'std']]){
    const m=manifest(),s=sources();
    add(m,s,al,'alloc',[],'pub fnc alloc_only() -> int { return 1; }');
    add(m,s,st,'std',[],'pub fnc host() -> int { return 1; }');
    const e=m.sources.find(x=>x.path===srcPath);
    e.imports=[targetPath];
    s.files[srcPath]='import module other from "'+targetPath+'";\n'+s.files[srcPath];
    denied('E_LIBRARY_LAYER',()=>check(m,s));
  }
});
test('forbidden hosted APIs, external hooks, implicit allocation, unsupported imports reject',()=>{
  for(const [layer,src,bad] of [
    ['core','stdio.out << 1;','E_LIBRARY_HOST'],
    ['core','using io','E_LIBRARY_HOST'],
    ['core','process.spawn()','E_LIBRARY_HOST'],
    ['core','extern fnc f();','E_LIBRARY_HOST'],
    ['core','foreign java;','E_LIBRARY_HOST'],
    ['core','new Error("oops")','E_LIBRARY_ALLOCATION'],
    ['core','Array.of(1)','E_LIBRARY_ALLOCATION'],
    ['core','Box<int> x','E_LIBRARY_ALLOCATION'],
    ['alloc','std.io.read()','E_LIBRARY_HOST'],
    ['alloc','syscall(1)','E_LIBRARY_HOST'],
    ['core','import module m from "stdlib/../std/x.atto";','E_LIBRARY_IMPORT'],
    ['core','import some_unknown;','E_LIBRARY_IMPORT']
  ]) denied(bad,()=>inspectAtto(src,layer));
});
test('unmanifested sources, malformed metadata, false guest evidence, and duplicate dependencies reject',()=>{
  for(const [mutate,code] of [
    [(m,s)=>{s.files[al]='new Array<int>();'},'E_LIBRARY_INVENTORY'],
    [(m,s)=>{delete s.files[id];},'E_LIBRARY_INVENTORY'],
    [(m,s)=>{m.sources[0].layer='std';},'E_LIBRARY_MANIFEST'],
    [(m,s)=>{m.sources[0].capabilities=['os.fs'];},'E_LIBRARY_CAPABILITY'],
    [(m,s)=>{m.proof.compiledGuestCases=1;},'E_LIBRARY_EVIDENCE'],
    [(m,s)=>{m.proof.freestandingImageLinked=true;},'E_LIBRARY_EVIDENCE'],
    [(m,s)=>{m.proof.backendParityVerified=true;},'E_LIBRARY_EVIDENCE'],
    [(m,s)=>{m.sources[0].execution='PASS';},'E_LIBRARY_EVIDENCE'],
    [(m,s)=>{m.sources.push({...m.sources[0]});},'E_LIBRARY_MANIFEST'],
    [(m,s)=>{m.sources[0].imports=[id,id];},'E_LIBRARY_MANIFEST'],
    [(m,s)=>{m.extra=true;},'E_LIBRARY_MANIFEST'],
    [(m,s)=>{m.sources[0].extra=true;},'E_LIBRARY_MANIFEST'],
    [(m,s)=>{s.files['stdlib/core/../../bad.atto']='';},'E_LIBRARY_INVENTORY'],
    [(m,s)=>{m.sources[0].imports=[al];},'E_LIBRARY_IMPORT']
  ]) {const m=manifest(),s=sources();mutate(m,s);denied(code,()=>check(m,s));}
});
test('unicode valid strings and comment-like tokens cannot bypass an actual host dependency',()=>{
  assert.deepEqual(inspectAtto('pub fnc x(){ val string s="import \\"stdlib/std/a.atto\\""; return 5; }','core'),[]);
  denied('E_LIBRARY_HOST',()=>inspectAtto('/* ignored */\nstdio.out << "ok";','core'));
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('/* no closing comment','core'));
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('val string x = "unterminated','core'));
  denied('E_LIBRARY_IMPORT',()=>inspectAtto('import module x from "stdlib/core/identity.atto"','core'));
});
