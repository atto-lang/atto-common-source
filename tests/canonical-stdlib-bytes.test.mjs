import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compareCanonicalStdlibBytes as compare} from '../src/canonical-stdlib-bytes.mjs';
const manifest=JSON.parse(readFileSync(new URL('../contracts/canonical-stdlib-v1.json',import.meta.url)));
const filename='stdlib/core/identity.atto';
const source=readFileSync(new URL('../stdlib/core/identity.atto',import.meta.url));
const targetNames=["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","wasm"];
const canonical=()=>Object.fromEntries(manifest.sources.map(s=>[s.path,readFileSync(new URL('../'+s.path,import.meta.url))]));
const replicas=()=>Object.fromEntries(targetNames.map(b=>[b,canonical()]));
const denied=f=>assert.throws(f,/E_STDLIB_/);

test('eight canonical .atto modules are SHA-pinned, never a .ores alias',()=>{
 assert.equal(manifest.status,'CANDIDATE_NOT_COMPILED');
 assert.equal(manifest.sourcePolicy,'CANONICAL_ATTO_BYTES_ONLY');
 assert.deepEqual(manifest.sources.map(s=>s.path),[
   'stdlib/alloc/byte_region.atto','stdlib/core/byte_bounds.atto',
   'stdlib/core/identity.atto','stdlib/core/size_math.atto','stdlib/core/u32_endian.atto',
   'stdlib/std/buffer.atto','stdlib/std/byte_ops.atto','stdlib/std/future_family.atto'
 ]);
 const bounds=readFileSync(new URL('../stdlib/core/byte_bounds.atto',import.meta.url));
 assert.equal(bounds.byteLength,726);
 assert.equal(createHash('sha256').update(bounds).digest('hex'),'7465eb4b8e3325957d47fd0fc92206e75231c1ad140b5605cec56c5262cb5c7e');
 const endian=readFileSync(new URL('../stdlib/core/u32_endian.atto',import.meta.url));
 assert.equal(endian.byteLength,791);
 assert.equal(createHash('sha256').update(endian).digest('hex'), '18223c1ecfbe1f16b03540670d10ba13c6dc7fdc21be940f82fb621d8c943c67');
 const bufferSource=readFileSync(new URL('../stdlib/std/buffer.atto',import.meta.url));
 assert.equal(bufferSource.byteLength,4816);
 assert.equal(createHash('sha256').update(bufferSource).digest('hex'),'e2f3a749f6ed0bb78b741384a5e0cf8ba0649790be00644c0e660fbf11c8f412');
 assert.equal(source.byteLength,55);
 assert.equal(manifest.sources.find(s=>s.path===filename).sha256,'bed9da0b8cc8c9bee0e6e7fe302df1a1b2734699fd220f59af8a52ac67c18688');
 assert.equal(readFileSync(new URL('../stdlib/core/identity.atto',import.meta.url),'utf8'),
  'pub fnc identity(int value) -> int {\n  return value;\n}\n');
});

test('all eleven supplied backend copies are byte-identical without any compiler claim',()=>{
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
test('false evidence labels and unsafe source paths cannot claim eleven-backend execution',()=>{
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
 m.sources.find(s=>s.path===filename).bytes=bom.byteLength;
 m.sources.find(s=>s.path===filename).sha256=createHash('sha256').update(bom).digest('hex');
 const c=canonical(); c[filename]=Buffer.from(bom);
 const replicasWithBom=replicas();
 for(const b of targetNames) replicasWithBom[b][filename]=Buffer.from(bom);
 denied(()=>compare(m,c,replicasWithBom));
});
