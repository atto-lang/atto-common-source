import {readFileSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const CASES = new Map([
 ['ordinary-single-double','ACCEPT'],
 ['ordinary-raw-newline','ACCEPT'],
 ['ordinary-unknown-escape','ACCEPT'],
 ['ordinary-paired-surrogates','ACCEPT'],
 ['template-nested-quote','ACCEPT'],
 ['template-multiline','ACCEPT'],
 ['ordinary-lone-surrogate','REJECT'],
 ['template-invalid-escape','REJECT'],
 ['template-empty-interpolation','REJECT'],
 ['template-comment-only','REJECT'],
 ['template-comment-within-limit','ACCEPT'],
 ['template-comment-over-limit','REJECT'],
]);
// Independent immutable v1 oracle: updating both the manifest and the
// physical file must not silently redefine a reviewed fixture.
const PINNED_GIT_BLOBS = new Map([
 ['ordinary-single-double',['fixtures/quoted-template-v1/quoted-single-double.atto','482f4d445b1362a6e25afebe21b31dddf4089610']],
 ['ordinary-raw-newline',['fixtures/quoted-template-v1/quoted-raw-newline.atto','d14a06e3c4d97abd7f5a52a639e61b37fe1bc932']],
 ['ordinary-unknown-escape',['fixtures/quoted-template-v1/quoted-unknown-escape.atto','ecd686c9d699c1feaa036a877eae07914afb92c6']],
 ['ordinary-paired-surrogates',['fixtures/quoted-template-v1/quoted-paired-surrogates.atto','eabfa239411992233ef3e11e1d5c03b6a1f6ee7e']],
 ['template-nested-quote',['fixtures/quoted-template-v1/template-nested-quote.atto','bcebbd9b8e7ab845fe3159b60e87289c6ab66c25']],
 ['template-multiline',['fixtures/quoted-template-v1/template-multiline.atto','477ea27739cb82a9c5b6010c000ba38096a1c5b2']],
 ['ordinary-lone-surrogate',['fixtures/quoted-template-v1/quoted-lone-surrogate.atto','d214352ede41c3f87b35745695603823a85fad13']],
 ['template-invalid-escape',['fixtures/quoted-template-v1/template-invalid-escape.atto','54bb6e47d5c60123871de1eeb5167b5d0807c1fd']],
 ['template-empty-interpolation',['fixtures/quoted-template-v1/template-empty-interpolation.atto','d9710c2432be5d2b7166bbff7a12687ea32f4bce']],
 ['template-comment-only',['fixtures/quoted-template-v1/template-comment-only.atto','ec4e84df719ce63a8e3127ea8bea798166196c0d']],
 ['template-comment-within-limit',['fixtures/quoted-template-v1/template-comment-within-limit.atto','492454a4338ae06ed8d17c27a0b87f3d701ec6bb']],
 ['template-comment-over-limit',['fixtures/quoted-template-v1/template-comment-over-limit.atto','9d340ab2c63afc476f83c6aa339342881e656f73']],
]);
const BACKENDS = ['java','llvm','wasm','forge','net'];
const EXPECTED_LIMITS = {
 template_interpolation_frame_depth:32,
 interpolation_braces_including_outer:256,
 template_substitutions:1024,
 portable_block_comment_nesting:128,
};
export function validateQuotedTemplateContract(contract, root=ROOT) {
 if(contract?.schema!==1 || contract.id!=='atto.quoted-template.lexical.v1')
  throw Error('wrong quoted-template contract');
 if(contract.source_extension!=='.atto' ||
    contract.scope!=='compiler frontend admission (scanner plus parser/lowering), not scanner-only or guest String execution')
  throw Error('contract scope drift');
 for(const [name,value] of Object.entries(EXPECTED_LIMITS))
  if(contract.semantics?.limits?.[name]!==value)
   throw Error('quoted-template lexical limit drift: '+name);
 const stages=contract.admission_stage_profiles;
 const stageOracle={java:'PARSER_LOWERING',llvm:'PARSER_LOWERING',
  forge:'SCANNER',wasm:'HOST_PREFLIGHT',net:'SCANNER'};
 if(!stages || Object.keys(stages).sort().join(',')!==
    'template-comment-only,template-empty-interpolation' ||
    Object.values(stages).some(v=>
     Object.keys(v).sort().join(',')!=='forge,java,llvm,net,wasm' ||
     Object.entries(stageOracle).some(([name,stage])=>v[name]!==stage)))
  throw Error('scanner-vs-parser stage claim drift');
 const wasmLimits=contract.backend_specific_source_limits;
 if(!wasmLimits || Object.keys(wasmLimits).join(',')!=='wasm' ||
    wasmLimits.wasm.max_utf8_bytes!==1_048_576 ||
    wasmLimits.wasm.unpaired_utf16!=='REJECT_BEFORE_TOKENIZATION' ||
    wasmLimits.wasm.portability!=='WASM_HOST_ONLY_NOT_SHARED_COMPILER_LIMIT')
  throw Error('Wasm byte-budget profile drift');
 const pending=contract.pending_review;
 if(pending?.status!=='DRAFT_NOT_MERGED_NOT_EXECUTED' ||
    pending.java!=='https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2967' ||
    pending.llvm!=='https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1704')
  throw Error('unverified Java/LLVM comment-budget promotion or review drift');
 const backendKeys=Object.keys(contract.backend_evidence??{}).sort();
 if(JSON.stringify(backendKeys)!==JSON.stringify([...BACKENDS].sort()))
  throw Error('incomplete backend evidence inventory');
 for(const name of BACKENDS){
  const entry=contract.backend_evidence[name];
  if(entry.lexical_source_inspected!==true ||
     entry.compiler_executed_for_manifest!==false ||
     entry.guest_executed_for_manifest!==false ||
     entry.exact_head_ci_verified!==false)
   throw Error('unsupported executed/green evidence claim: '+name);
 }
 if(!Array.isArray(contract.cases) || contract.cases.length!==CASES.size)
  throw Error('missing or extra .atto fixture');
 const seen=new Set();
 for(const c of contract.cases){
  if(seen.has(c.id) || !CASES.has(c.id) ||
     c.expect_frontend!==CASES.get(c.id) || Object.hasOwn(c,'expect_lexical'))
   throw Error('fixture identity or expected result drift');
  seen.add(c.id);
  const pinned=PINNED_GIT_BLOBS.get(c.id);
  if(!pinned || c.path!==pinned[0] || c.git_blob_sha!==pinned[1])
   throw Error('fixture pinned path/Git blob identity drift: '+c.id);
  if(c.typed_runtime_outcome!=='NOT_EXECUTED')
   throw Error('lexical fixture promoted to unverified guest pass');
  // File names are fixed independently of the ID; the path must remain local.
  if(typeof c.path!=='string' ||
    !/^fixtures\/quoted-template-v1\/[a-z-]+\.atto$/.test(c.path) ||
    c.path.includes('..'))throw Error('unsafe or noncanonical fixture path');
  const file=resolve(root,c.path);
  if(!file.startsWith(root+sep) || !lstatSync(file).isFile() ||
     lstatSync(file).isSymbolicLink())
   throw Error('fixture escaped immutable source tree');
  const bytes=readFileSync(file);
  const oid=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0'))
   .update(bytes).digest('hex');
  if(oid!==c.git_blob_sha)
   throw Error('source Git blob SHA mismatch: '+c.id);
  const content=bytes.toString('utf8');
  if(!content.startsWith('pub fnc main(): int {') ||
     !content.includes('return 42;') ||
     !content.endsWith('}\n'))
   throw Error('non-canonical physical .atto source fixture: '+c.id);
 }
 if(seen.size!==CASES.size)throw Error('incomplete fixture inventory');
 const bounds=contract.generated_boundaries;
 if(!Array.isArray(bounds) || bounds.length!==4 ||
    bounds.map(b=>b.name+':'+b.admit+'/'+b.reject).join(',')!==
    'template-nested:17/18,interpolation-brace-extra:255/256,interpolation-count:1024/1025,nested-comments:128/129')
   throw Error('exact lexical boundary inventory drift');
 if(bounds[3].profile!=='forge/wasm/net only')
   throw Error('backend-specific comment budget falsely promoted to universal');
 return {verified_git_blobs:seen.size,backend_evidence:'NOT_EXECUTED'};
}
export function loadQuotedTemplateContract(){
 return JSON.parse(readFileSync(join(ROOT,'contracts/conformance/quoted-template-lexical-v1.json'),'utf8'));
}
