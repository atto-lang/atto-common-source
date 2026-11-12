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
    typeof contract.scope!=='string' || !contract.scope.includes('lexical'))
  throw Error('contract scope drift');
 for(const [name,value] of Object.entries(EXPECTED_LIMITS))
  if(contract.semantics?.limits?.[name]!==value)
   throw Error('quoted-template lexical limit drift: '+name);
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
     c.expect_lexical!==CASES.get(c.id))
   throw Error('fixture identity or expected result drift');
  seen.add(c.id);
  if(c.typed_runtime_outcome!=='NOT_EXECUTED')
   throw Error('lexical fixture promoted to unverified guest pass');
  const exact='fixtures/quoted-template-v1/'+c.id.replace(/^ordinary-/, 'quoted-').replace(/-single-double$/, '-single-double')+'.atto';
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
