import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compareCanonicalStdlibBytes as compare} from '../src/canonical-stdlib-bytes.mjs';
const manifest=JSON.parse(readFileSync(new URL('../contracts/canonical-stdlib-v1.json',import.meta.url)));
const filename='stdlib/core/identity.atto';
const source=readFileSync(new URL('../stdlib/core/identity.atto',import.meta.url));
const targetNames=['java','llvm','net','wasm','forge'];
const canonical=()=>({[filename]:Buffer.from(source)});
const replicas=()=>Object.fromEntries(targetNames.map(b=>[b,{[filename]:Buffer.from(source)}]));
const denied=f=>assert.throws(f,/E_STDLIB_/);

test('one canonical .atto module is pinned to exact bytes, not a .ores alias',()=>{
 assert.equal(manifest.status,'CANDIDATE_NOT_COMPILED');
 assert.equal(manifest.sourcePolicy,'CANONICAL_ATTO_BYTES_ONLY');
 assert.equal(manifest.sources.length,1);
 assert.equal(manifest.sources[0].path,filename);
 assert.equal(source.byteLength,55);
 assert.equal(manifest.sources[0].sha256,'bed9da0b8cc8c9bee0e6e7fe302df1a1b2734699fd220f59af8a52ac67c18688');
 assert.equal(readFileSync(new URL('../stdlib/core/identity.atto',import.meta.url),'utf8'),
  'pub fnc identity(int value) -> int {\n  return value;\n}\n');
});

test('all five supplied backend copies are byte-identical without any compiler claim',()=>{
 const res=compare(manifest,canonical(),replicas());
 assert.equal(res.sourceByteIdentical,true);
 assert.equal(res.evidence,'SUPPLIED_BYTES_ONLY');
 assert.equal(res.compilationExecuted,false);
 assert.equal(res.guestParityCertified,false);
 assert.equal(res.releaseAuthorized,false);
 assert.deepEqual(Object.keys(res.backendSha256),targetNames);
});
test('every backend rejects one-byte mutation, and newline changes are not normalized',()=>{
 for(const backend of targetNames) {
   const c=replicas();c[backend][filename][2]^=1;denied(()=>compare(manifest,canonical(),c));
   const crlf=replicas();
   crlf[backend][filename]=Buffer.from(source.toString('utf8').replaceAll('\n','\r\n'),'utf8');
   denied(()=>compare(manifest,canonical(),crlf));
 }
});
test('missing backend, missing source, and additional or stale entries fail closed',()=>{
 for(const backend of targetNames){
   const c=replicas();delete c[backend];denied(()=>compare(manifest,canonical(),c));
 }
 const c=replicas();delete c.llvm[filename];denied(()=>compare(manifest,canonical(),c));
 const extra=replicas();extra.java['stdlib/core/malicious.atto']=Buffer.from(source);
 denied(()=>compare(manifest,canonical(),extra));
 const bad=structuredClone(manifest);bad.sources[0].sha256='0'.repeat(64);
 denied(()=>compare(bad,canonical(),replicas()));
});
test('bad UTF-8, source BOM and missing trailing newline cannot masquerade as canonical',()=>{
 for(const bytes of [Uint8Array.from([0xc0,0xaf]), Buffer.from('\ufeff'+source.toString('utf8')),
   Buffer.from(source.toString('utf8').trimEnd())]){
   const c=canonical();c[filename]=bytes;
   denied(()=>compare(manifest,c,replicas()));
 }
});
test('false evidence labels and unsafe source paths cannot claim five-backend execution',()=>{
 for(const mutate of [
   m=>m.targets[0].execution='PASS',
   m=>m.targets.pop(),
   m=>m.sources[0].path='../../secret.ores',
   m=>m.sourcePolicy='ACCEPT_ORES_FILES',
   m=>m.extra=true,
   m=>Object.defineProperty(m,'hidden',{value:'x'}),
 ]){const m=structuredClone(manifest);mutate(m);denied(()=>compare(m,canonical(),replicas()));}
});

test('matching BOM bytes and corresponding manifest hash still fail closed',()=>{
 const bom=Buffer.from('\ufeff'+source.toString('utf8'),'utf8');
 const m=structuredClone(manifest);
 m.sources[0].bytes=bom.byteLength;
 m.sources[0].sha256=createHash('sha256').update(bom).digest('hex');
 const c={[filename]:Buffer.from(bom)};
 const replicasWithBom=Object.fromEntries(targetNames.map(b=>[b,{[filename]:Buffer.from(bom)}]));
 denied(()=>compare(m,c,replicasWithBom));
});
