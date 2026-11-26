import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibraryLayers, inspectAtto, lexAtto, readLibraryTree } from '../src/library-layers.mjs';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  // Use the checked-in manifest, not a single-file expectation: new alloc/std
  // sources must be registered in this manifest before integration.
  const m=JSON.parse(readFileSync(new URL('../contracts/library-layers-v1.json',import.meta.url),'utf8'));
  const src=readLibraryTree(new URL('..',import.meta.url).pathname);
  assert.ok(m.sources.some(e=>e.path===id&&e.layer==='core'));
  assert.deepEqual(Object.keys(src.files).sort(),m.sources.map(e=>e.path).sort());
  assert.deepEqual(check(m,src),{
    structuralAdmission:true,freestandingGuestProved:false,backendParityCertified:false,
    libraryCount:m.sources.length,profiles:{core:['core'],alloc:['core','alloc'],std:['core','alloc','std']}
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
    ['core','String name;','E_LIBRARY_ALLOCATION'],
    ['core','Array items;','E_LIBRARY_ALLOCATION'],
    ['alloc','std.io.read()','E_LIBRARY_HOST'],
    ['core','std::fs.open()','E_LIBRARY_HOST'],
    ['core','java.lang.System.out','E_LIBRARY_HOST'],
    ['alloc','dotnet.System.IO.File','E_LIBRARY_HOST'],
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

test('intra-layer imports are allowed when acyclic, but direct and indirect cycles reject',()=>{
  const m=manifest(),s=sources();
  m.sources[0].imports=[id];
  s.files[id]='import "stdlib/core/identity.atto";\n'+s.files[id];
  denied('E_LIBRARY_CYCLE',()=>check(m,s));

  const helper='stdlib/core/helper.atto';
  const two=manifest(),src=sources();
  two.sources[0].imports=[helper];
  src.files[id]='import "stdlib/core/helper.atto";\n'+src.files[id];
  add(two,src,helper,'core',[id],
    'import "stdlib/core/identity.atto";\npub fnc helper() -> int { return 1; }');
  denied('E_LIBRARY_CYCLE',()=>check(two,src));

  // Downward plus acyclic same-layer imports must stay valid.
  two.sources[0].imports=[];
  src.files[id]=sources().files[id];
  assert.equal(check(two,src).libraryCount,2);
});

test('canonical source rejects UTF-8 BOM/NUL, including lexical evasion',()=>{
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('\ufeffpub fnc test() -> int { return 1; }','core'));
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('pub fnc test() {\u0000 }','core'));
});

test('stdlib root cannot be swapped for a symlink',()=>{
  const root=mkdtempSync(join(tmpdir(),'atto-stdlib-layer-'));
  try {
    mkdirSync(join(root,'outside'));
    symlinkSync(join(root,'outside'),join(root,'stdlib'),'dir');
    denied('E_LIBRARY_INVENTORY',()=>readLibraryTree(root));
  } finally {
    rmSync(root,{recursive:true,force:true});
  }
});

test('freestanding core/alloc exclude actor scheduler, std excludes actor platform',()=>{
  for(const layer of ['core','alloc']){
    for(const bad of ['spawn Worker()','await task','select { }',
      'define actor Worker as end','supervisor.stop()','Channel<int> values']){
      denied('E_LIBRARY_RUNTIME',()=>inspectAtto('pub fnc f() { '+bad+'; }',layer));
    }
  }
  for(const bad of ['define actor Worker as end','supervisor.restart()',
    'ActorGroup group']){
    denied('E_LIBRARY_RUNTIME',()=>inspectAtto('pub fnc f() { '+bad+'; }','std'));
  }
  // The structural scanner must not confuse inert text with real code.
  assert.deepEqual(inspectAtto('// spawn Worker()\nlet string s = "await job";','core'),[]);
  assert.deepEqual(inspectAtto('pub fnc hosted() { await io_ready; }','std'),[]);
});

test('allocator effects cannot be misdeclared pure in hosted std',()=>{
  const m=manifest(),s=sources();
  add(m,s,st,'std',[],
    'pub fnc create() { return new Widget(); }');
  denied('E_LIBRARY_CAPABILITY',()=>check(m,s));
  m.sources.find(e=>e.path===st).capabilities=['allocator'];
  assert.equal(check(m,s).libraryCount,2);
});

test('nested comments and string literals never trigger phantom host/allocator effects',()=>{
  assert.deepEqual(inspectAtto(
    'pub fnc x() { val string a = "new"; val string b = "ffi"; val string c = "extern"; return 1; }',
    'core'),[]);
  assert.deepEqual(inspectAtto(
    '/* outer /* inner */ stdio.out; new Widget(); */ pub fnc x() { return 1; }',
    'core'),[]);
  assert.deepEqual(inspectAtto('/*'.repeat(64)+'*/'.repeat(64),'core'),[]);
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('/* outer /* nested */','core'));
  denied('E_LIBRARY_SOURCE',()=>inspectAtto('/*'.repeat(65)+'*/'.repeat(65),'core'));
  denied('E_LIBRARY_HOST',()=>inspectAtto('/* outer /* inner */ */ stdio.out;','core'));
  denied('E_LIBRARY_RUNTIME',()=>inspectAtto('/* outer /* inner */ */ spawn Worker();','alloc'));
});
test('non-declared prototype layer names and hidden/accessor manifest metadata reject',()=>{
  for(const layer of ['constructor','toString','__proto__'])
    denied('E_LIBRARY_MANIFEST',()=>inspectAtto('pub fnc f() { return 1; }',layer));
  for(const mutate of [
    m=>Object.defineProperty(m,'hidden',{value:'opaque'}),
    m=>Object.defineProperty(m.sources[0],'extra',{value:1}),
    m=>Object.defineProperty(m.sources[0].capabilities,'hidden',{value:1}),
    m=>Object.defineProperty(m.sources[0],'status',{get(){return 'PASS'},enumerable:true}),
    m=>Object.defineProperty(m.sources[0].imports,'0',{get(){return id},enumerable:true,configurable:true})
  ]){
    const m=manifest(),s=sources();mutate(m);
    denied('E_LIBRARY_MANIFEST',()=>check(m,s));
  }
});


test('import admission requires actual keyword and punctuation tokens and literal paths',()=>{
  for(const bad of [
    'import "stdlib/core/identity.atto" ";"',
    'import module identity "from" "stdlib/core/identity.atto";',
    'import "stdlib/core/identi\\ty.atto";'
  ]) denied('E_LIBRARY_IMPORT',()=>inspectAtto(bad,'core'));
  assert.deepEqual(inspectAtto('import module identity from "stdlib/core/identity.atto";','core'),[id]);
});

test('inventory rejects hidden, symbol and accessor source entries without invoking getters',()=>{
  for(const mutate of [
    s=>Object.defineProperty(s.files,al,{value:'ignored'}),
    s=>Object.defineProperty(s.files,Symbol('hidden'),{value:'ignored'}),
    s=>Object.defineProperty(s.files,id,{enumerable:true,get(){throw Error('getter invoked');}})
  ]) {const m=manifest(),s=sources();mutate(s);denied('E_LIBRARY_INVENTORY',()=>check(m,s));}
  const m=manifest(),s=sources();
  Object.defineProperty(m.sources,'0',{enumerable:true,get(){throw Error('getter invoked');}});
  denied('E_LIBRARY_MANIFEST',()=>check(m,s));
});


test('manifest arrays reject hidden indices and custom iterators before invoking them',()=>{
  for(const mutate of [
    m=>Object.defineProperty(m.sources,'0',{enumerable:false}),
    m=>Object.setPrototypeOf(m.sources,{[Symbol.iterator](){throw Error('iterator invoked');}}),
    m=>Object.defineProperty(m.sources[0].capabilities,'0',{enumerable:false}),
    m=>Object.setPrototypeOf(m.sources[0].imports,{[Symbol.iterator](){throw Error('iterator invoked');}}),
    m=>Object.defineProperty(m.sources[0].capabilities,'0',{get(){throw Error('getter invoked');}}),
    m=>m.sources[0].capabilities.push('pure'),
    m=>m.sources.extra=1
  ]) {const m=manifest();mutate(m);denied('E_LIBRARY_MANIFEST',()=>check(m,sources()));}
});
test('returned profile metadata is immutable across admissions',()=>{
  const first=check(manifest(),sources());
  assert.throws(()=>first.profiles.core.push('std'),TypeError);
  assert.deepEqual(check(manifest(),sources()).profiles.core,['core']);
});
