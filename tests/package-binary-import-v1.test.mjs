#!/usr/bin/env node
// Source-free package/import reference oracle. NEVER a real compiler or guest test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {posix} from 'node:path';

const spec=JSON.parse(readFileSync(new URL('../contracts/conformance/package-binary-import-v1.json',import.meta.url),'utf8'));
const sha=/^[0-9a-f]{64}$/;
const lockedName=/^[a-z][a-z0-9_]*$/;
const reservedNames=new Set(['__root__','__proto__','prototype','constructor']);
const targets=new Set(['java','llvm','net','wasm','forge','js','rs','cranelift','hdl']);
const own=(o,k)=>Object.hasOwn(o,k);
function fail(code){const e=new Error(code);e.code=code;throw e;}
function canonicalPath(path){
  return typeof path==='string' && path.length<=4096 && path.length>0 &&
    !path.includes('\\') && !path.startsWith('/') && !path.includes('\0') &&
    !/[^\x20-\x7e]/.test(path) && !path.includes('%') &&
    path.split('/').every(x=>x && x!=='.' && x!=='..' && /^[A-Za-z0-9_.-]+$/.test(x));
}
function loadGraph(doc){
  if(doc.contract_version!=='attolang.package-binary-import.v1' ||
     doc.status!=='PROPOSED_SOURCE_FREE_REFERENCE_ONLY')fail('INVALID_CONTRACT_STATUS');
  if(doc.invariants.package_import_no_permissions!==true ||
     doc.invariants.no_cross_package_namespace_merge!==true)fail('WEAKENED_IMPORT_POLICY');
  const pkgs=new Map();
  for(const p of doc.packages){
    if(!p.id || pkgs.has(p.id) || !Array.isArray(p.source_files))fail('DUPLICATE_PACKAGE_INSTANCE');
    if(new Set(p.source_files).size!==p.source_files.length ||
       p.source_files.some(path=>!canonicalPath(path)||!path.endsWith('.atto')))
      fail('UNSAFE_SOURCE_INVENTORY');
    if(!Array.isArray(p.exports))fail('INVALID_EXPORTS');
    const seen=new Set();
    for(const ex of p.exports){
      if(!['module','namespace'].includes(ex.kind) ||
         (ex.kind==='namespace' && reservedNames.has(ex.name)) ||
         !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ex.name) ||
         !['pub','pub[pkg]','pub[file]','private'].includes(ex.visibility))
        fail('INVALID_EXPORT');
      const key=ex.kind+':'+ex.name;
      if(seen.has(key))fail('DUPLICATE_EXPORT');
      seen.add(key);
    }
    pkgs.set(p.id,p);
  }
  const locks=new Map();
  for(const l of doc.locks){
    if(!pkgs.has(l.importer_id)||!pkgs.has(l.instance_id) ||
       !lockedName.test(l.alias)||reservedNames.has(l.alias))fail('INVALID_PACKAGE_LOCK');
    const key=l.importer_id+'\0'+l.alias;
    if(locks.has(key))fail('DUPLICATE_PACKAGE_LOCK');
    if(!sha.test(l.interface_sha256))fail('INVALID_LOCK_DIGEST');
    locks.set(key,l);
  }
  return {pkgs,locks};
}
function mutate(doc,c){
  const d=structuredClone(doc), req=structuredClone(c);
  const archive=d.artifacts.find(a=>a.id==='source');
  const binary=d.artifacts.find(a=>a.id==='binary');
  const m=req.mutation;
  if(m==='archive_traversal')archive.members[0].path='../outside.atto';
  else if(m==='archive_symlink')archive.members[0].kind='symlink';
  else if(m==='archive_duplicate')archive.members.push({...archive.members[0]});
  else if(m==='archive_unlisted')archive.members.push({path:'src/extra.atto',kind:'file',size:2});
  else if(m==='archive_oversize')archive.members[0].size=16*1024*1024+1;
  else if(m==='stale_interface')binary.interface_sha256='f'.repeat(64);
  else if(m==='bad_abi')binary.targets.java.abi='wrong-v1';
  else if(m==='bad_target_digest')binary.targets.java.sha256='not-a-sha256';
  else if(m==='shadow_pin')d.locks[0].instance_id=d.packages[2].id;
  else if(m==='capability_grant')req.grant_capabilities=['host-fs'];
  else if(m!==undefined)fail('UNKNOWN_MUTATION');
  return {doc:d,req};
}
function admitArtifact(doc,artifact,pkg,req){
  if(!artifact || artifact.package_instance_id!==pkg.id ||
     !sha.test(artifact.sha256))fail('ARTIFACT_IDENTITY_INVALID');
  if(['source-archive','source-directory'].includes(artifact.format)){
    const members=new Set();
    let total=0;
    if(artifact.members.length>4096)fail('ARCHIVE_LIMIT');
    for(const f of artifact.members){
      if(!canonicalPath(f.path) || f.kind!=='file')fail('ARCHIVE_MEMBER_UNSAFE');
      const key=f.path.toLowerCase();
      if(members.has(key))fail('ARCHIVE_MEMBER_DUPLICATE');
      members.add(key);
      if(!Number.isSafeInteger(f.size)||f.size<0||f.size>16*1024*1024)
        fail('ARCHIVE_LIMIT');
      total+=f.size;
      if(total>16*1024*1024)fail('ARCHIVE_LIMIT');
    }
    if(members.size!==pkg.source_files.length ||
       pkg.source_files.some(path=>!members.has(path.toLowerCase())))
      fail('SOURCE_INVENTORY_DRIFT');
  }else if(artifact.format==='compiled'){
    if(!sha.test(artifact.interface_sha256) ||
       artifact.interface_sha256!==pkg.interface_sha256)
      fail('INTERFACE_DIGEST_MISMATCH');
    if(!own(doc.backend_profiles,req.target) || !targets.has(req.target))
      fail('UNKNOWN_TARGET');
    const payload=artifact.targets?.[req.target];
    if(!payload)fail('TARGET_PAYLOAD_MISSING');
    if(payload.abi!==doc.backend_profiles[req.target].abi)
      fail('TARGET_ABI_MISMATCH');
    if(!sha.test(payload.sha256))fail('TARGET_DIGEST_INVALID');
  }else fail('UNSUPPORTED_ARTIFACT_FORMAT');
}
function resolve(doc,req){
  const {pkgs,locks}=loadGraph(doc);
  const artifact=doc.artifacts.find(a=>a.id===req.artifact);
  if(!artifact)fail('ARTIFACT_UNKNOWN');
  const importerId=req.importer_id||doc.packages[0].id;
  const importer=pkgs.get(importerId);
  if(!importer)fail('IMPORTER_UNKNOWN');
  const pkg=pkgs.get(artifact.package_instance_id);
  if(!pkg)fail('ARTIFACT_PACKAGE_UNKNOWN');
  // A resolved import is not a permission grant, and source admission
  // does not imply tenant/actor visibility, filesystem access or code trust.
  if(req.grant_capabilities?.length)fail('IMPORT_CANNOT_GRANT_CAPABILITY');
  if(req.selector==='file'){
    if(!['source-archive','source-directory'].includes(artifact.format))fail('BINARY_HAS_NO_SOURCE_PATHS');
    if(importerId!==pkg.id)fail('CROSS_PACKAGE_SOURCE_IMPORT');
    if(!req.from.startsWith('./')||!canonicalPath(req.source_unit))
      fail('INVALID_RELATIVE_IMPORT');
    const sub=req.from.slice(2);
    if(!canonicalPath(sub))fail('INVALID_RELATIVE_IMPORT');
    const dest=posix.join(posix.dirname(req.source_unit),sub);
    admitArtifact(doc,artifact,pkg,req);
    if(!pkg.source_files.includes(dest))fail('SOURCE_UNIT_NOT_IN_PACKAGE');
    return ['file:'+dest];
  }
  if(!['pkg','module','namespace'].includes(req.selector))
    fail('INVALID_IMPORT_SELECTOR');
  const match=/^pkg:([a-z][a-z0-9_]*)$/.exec(req.from);
  if(!match)fail('INVALID_PACKAGE_SPECIFIER');
  const lock=locks.get(importerId+'\0'+match[1]);
  if(!lock)fail('UNLOCKED_PACKAGE_ALIAS');
  const pinned=pkgs.get(lock.instance_id);
  if(!pinned||pinned.id!==pkg.id)fail('LOCK_ARTIFACT_MISMATCH');
  if(!sha.test(pkg.interface_sha256) ||
     lock.interface_sha256!==pkg.interface_sha256)fail('INTERFACE_DIGEST_MISMATCH');
  admitArtifact(doc,artifact,pkg,req);
  const visible=pkg.exports.filter(x=>x.visibility==='pub');
  if(req.selector==='pkg')
    return visible.map(x=>x.kind+':'+x.name).sort();
  const candidate=pkg.exports.find(x=>x.kind===req.selector && x.name===req.name);
  if(!candidate)fail('EXPORT_MISSING');
  if(candidate.visibility!=='pub' && importerId!==pkg.id)fail('EXPORT_NOT_PUBLIC');
  return [candidate.kind+':'+candidate.name];
}
function verifyGuestReceipt(receipt){
  if(!receipt || typeof receipt!=='object')fail('MISSING_GUEST_RECEIPT');
  for(const key of spec.evidence_policy.guest_receipt_requires){
    if(!own(receipt,key))fail('INCOMPLETE_GUEST_RECEIPT');
  }
  if(!targets.has(receipt.backend) || receipt.target!==receipt.backend ||
    ![receipt.source_sha256,receipt.artifact_sha256].every(x=>sha.test(x)) ||
    !/^[0-9a-f]{40}$/.test(receipt.compiler_sha) ||
    !/^[0-9a-f]{40}$/.test(receipt.head_sha) ||
    !Number.isSafeInteger(receipt.run_id)||receipt.run_id<=0 ||
    !Number.isSafeInteger(receipt.nonzero_steps)||receipt.nonzero_steps<=0 ||
    !Number.isSafeInteger(receipt.guest_exit) || receipt.guest_execution!==true)
    fail('INVALID_GUEST_RECEIPT');
  // Schema completeness is not attestation: run logs, actual input/compiler
  // hashes and code-signing/authorization must be independently checked.
  return 'RECEIPT_SHAPE_ONLY_UNATTESTED';
}
test('contract declares every source.* backend without claiming execution',()=>{
  assert.deepEqual(Object.keys(spec.backend_profiles).sort(),[...targets].sort());
  assert.ok(Object.values(spec.backend_profiles).every(x=>x.status.includes('NOT_EXECUTED')));
  assert.equal(spec.grammar_proposal.canonical_root,'+/');
  assert.equal(spec.cases.length,28);
  assert.equal(spec.interface_digest_policy.canonical_semantic_digest,'PROPOSED_NOT_IMPLEMENTED');
  assert.equal(spec.interface_digest_policy.example_java_oresi_sha256,
    '8db5681e1e41c389e2358f9e0cd5c46e78b5b33519ed4769056268a240847f3d');
  assert.equal(spec.evidence_policy.no_authored_fixture_as_executed,true);
});
for(const c of spec.cases){
  test(c.id+' ['+c.expected+']',()=>{
    const {doc,req}=mutate(spec,c);
    if(c.expected==='reject'){
      assert.throws(()=>resolve(doc,req),e=>e.code===c.code,
        'negative fixture must reject with its specific diagnostic');
    }else{
      assert.equal(c.expected,'admit');
      assert.deepEqual(resolve(doc,req),c.exports,
        'source/archive/binary forms must expose the same qualified API');
    }
  });
}
test('source and binary representation do not change the public export table',()=>{
  const d=spec.cases.find(c=>c.id==='directory-pkg-public-api');
  const s=spec.cases.find(c=>c.id==='source-pkg-public-api');
  const b=spec.cases.find(c=>c.id==='binary-pkg-same-api');
  assert.deepEqual(resolve(spec,d),resolve(spec,s));
  assert.deepEqual(resolve(spec,s),resolve(spec,b));
});
test('lock always chooses a single package instance despite matching name',()=>{
  const changed=structuredClone(spec);
  changed.packages[2].exports.push({kind:'module',name:'injected',visibility:'pub'});
  const c=spec.cases.find(c=>c.id==='source-pkg-public-api');
  assert.deepEqual(resolve(changed,c),['module:parser','namespace:network']);
});
test('fail closed on duplicated lock alias and duplicate export',()=>{
  const lock=structuredClone(spec);lock.locks.push({...lock.locks[0]});
  assert.throws(()=>resolve(lock,spec.cases[0]),e=>e.code==='DUPLICATE_PACKAGE_LOCK');
  const pub=structuredClone(spec);pub.packages[1].exports.push({...pub.packages[1].exports[0]});
  assert.throws(()=>resolve(pub,spec.cases[0]),e=>e.code==='DUPLICATE_EXPORT');
});
test('prototype and constructor aliases never resolve by ambient object property',()=>{
  for(const alias of ['constructor','prototype','__proto__','__root__']){
    const modified=structuredClone(spec);
    modified.locks[0].alias=alias;
    assert.throws(()=>resolve(modified,spec.cases[0]),
      e=>e.code==='INVALID_PACKAGE_LOCK');
  }
});
test('reserved flat namespace exports never enter the public API catalog',()=>{
  for(const name of ['constructor','prototype','__proto__','__root__']){
    const modified=structuredClone(spec);
    modified.packages[1].exports.find(e=>e.kind==='namespace').name=name;
    assert.throws(()=>resolve(modified,spec.cases[0]),
      e=>e.code==='INVALID_EXPORT');
  }
});

test('receipt model must not mistake authored fixtures or zero-step jobs for execution',()=>{
  assert.throws(()=>verifyGuestReceipt({}),e=>e.code==='INCOMPLETE_GUEST_RECEIPT');
  const receipt={backend:'java',target:'java',source_sha256:'1'.repeat(64),
    compiler_sha:'2'.repeat(40),artifact_sha256:'3'.repeat(64),
    head_sha:'4'.repeat(40),run_id:13,nonzero_steps:0,guest_exit:42,guest_execution:true};
  assert.throws(()=>verifyGuestReceipt(receipt),e=>e.code==='INVALID_GUEST_RECEIPT');
  assert.equal(verifyGuestReceipt({...receipt,nonzero_steps:3}),
    'RECEIPT_SHAPE_ONLY_UNATTESTED');
});
