import {readFileSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PINS = new Map([
  ['scalar-fnc-and-method', {path:'fixtures/atto-to-string-v1/scalar-fnc-and-method.atto', expect:'ACCEPT', result:"v:-42 b:true s:é😀中", sha:'188a2493b83b0770225981360334a1278e9bc227'}],
  ['declared-to-string-method', {path:'fixtures/atto-to-string-v1/declared-to-string-method.atto', expect:'ACCEPT', result:"Box:7", sha:'e0d449c550a04c43048b814d377a8772caf6de2e'}],
  ['user-fnc-shadow', {path:'fixtures/atto-to-string-v1/user-fnc-shadow.atto', expect:'ACCEPT', result:"custom", sha:'f0f362029d03b2ee218816406b47c6d9811e9a08'}],
  ['reject-implicit-int-template', {path:'fixtures/atto-to-string-v1/reject-implicit-int-template.atto', expect:'REJECT', result:"TYPE_MISMATCH", sha:'65ec5b494e1484ec8dc5dc38967652f41d59757f'}],
  ['reject-implicit-class-conversion', {path:'fixtures/atto-to-string-v1/reject-implicit-class-conversion.atto', expect:'REJECT', result:"UNSUPPORTED_CONVERSION", sha:'ebf8b5eacbd8a0f1d7b44ba3d3691e14209598cb'}],
  ['reject-float-to-string', {path:'fixtures/atto-to-string-v1/reject-float-to-string.atto', expect:'REJECT', result:"UNSUPPORTED_CONVERSION", sha:'a2580a95a10bc8c41594ecb67921e0bb9c014bb7'}],
  ['reject-method-extra-arg', {path:'fixtures/atto-to-string-v1/reject-method-extra-arg.atto', expect:'REJECT', result:"WRONG_ARITY", sha:'dc61b9bcaf5c7fbe8c9b8f8ae5459185831b0961'}],
  ['reject-class-return-type-template', {path:'fixtures/atto-to-string-v1/reject-class-return-type-template.atto', expect:'REJECT', result:"TYPE_MISMATCH", sha:'3d0bcd6c082487243d9005639dbc91fa3a5e65af'}],
]);
const BACKEND_IMPL = Object.freeze({
 java: 'DRAFT',
 llvm: 'NOT_IMPLEMENTED',
 wasm: 'HOST_PREFLIGHT_ONLY',
 forge: 'STRING_BACKEND_UNSUPPORTED',
 net: 'STRING_BACKEND_UNSUPPORTED',
});

export function validateToStringV1(doc, root=ROOT) {
 if (doc?.schema_version !== '1.0.0' || doc.id !== 'atto.to_string.v1' ||
     doc.source_extension !== '.atto' ||
     !doc.scope.includes('NOT EXECUTED'))
  throw Error('to_string v1 identity/scope drift');
 if (doc.semantics?.int !== 'signed i64 base-10 ASCII, no locale or grouping' ||
     doc.semantics?.bool !== 'lowercase true/false' ||
     !doc.semantics?.template?.includes('requires String statically') ||
     !doc.semantics?.class?.includes('no implicit class-to-String conversion'))
  throw Error('to_string v1 semantic type or conversion drift');
 if (!doc.promotion?.includes('zero executed steps') ||
     !doc.security_note?.includes('independently reviewed'))
  throw Error('to_string v1 execution/export evidence guard missing');
 if (Object.keys(doc.backend_evidence ?? {}).sort().join(',') !==
     Object.keys(BACKEND_IMPL).sort().join(','))
  throw Error('missing backend evidence');
 for(const [backend,status] of Object.entries(BACKEND_IMPL)){
  const b=doc.backend_evidence[backend];
  if (b?.implementation!==status || b.compiler_executed!==false ||
      b.guest_executed!==false ||
      (backend==='java' && b.pr!=='https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2978'))
   throw Error('unsupported or forged execution evidence: '+backend);
 }
 if(!Array.isArray(doc.cases) || doc.cases.length!==PINS.size)
  throw Error('incomplete physical Atto fixture inventory');
 const seen=new Set();
 for (const c of doc.cases) {
  const pin=PINS.get(c.id);
  if (!pin || seen.has(c.id) || c.path!==pin.path ||
      c.expect_frontend!==pin.expect ||
      c.expected_output_or_diagnostic!==pin.result ||
      c.git_blob_sha!==pin.sha ||
      c.guest_status!=='NOT_EXECUTED')
   throw Error('to_string fixture source/expected value identity drift: '+c.id);
  seen.add(c.id);
  const file=resolve(root, c.path);
  if(!file.startsWith(resolve(root)+sep) || !lstatSync(file).isFile() ||
      lstatSync(file).isSymbolicLink())
   throw Error('unsafe or missing to_string .atto fixture: '+c.path);
  const bytes=readFileSync(file);
  const digest=createHash('sha1')
    .update(Buffer.from('blob '+bytes.length+String.fromCharCode(0)))
    .update(bytes).digest('hex');
  if(digest!==pin.sha)throw Error('modified exact .atto Git blob: '+c.id);
  const src=bytes.toString('utf8');
  if(!src.startsWith('pub fnc main(): void {') && !src.startsWith('define class ') && !src.startsWith('fnc to_string('))
   throw Error('noncanonical source fixture: '+c.id);
  if(!src.includes('return;') || !src.endsWith('}\n'))
   throw Error('incomplete physical Atto source: '+c.id);
 }
 if(seen.size!==PINS.size)throw Error('unreviewed Atto fixture set');
 return {fixtures:seen.size, compiler_status:'NOT_EXECUTED'};
}
export function loadToStringV1(){
 return JSON.parse(readFileSync(new URL('../contracts/conformance/atto-to-string-v1.json',import.meta.url),'utf8'));
}
