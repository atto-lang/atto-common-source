#!/usr/bin/env node
// Source identity only. This verifier NEVER compiles or executes AttoLang guests.
import {createHash} from "node:crypto";
import {lstatSync,readFileSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const CASES=[{"id":"canonical-add","kind":"positive","path":"contracts/atto-scalar-v1/positive/canonical-add.atto","git_blob_sha1":"015f8b0f79aafa796a148d2adeff1574e8d6c491","expected_i64":"42"},{"id":"precedence","kind":"positive","path":"contracts/atto-scalar-v1/positive/precedence.atto","git_blob_sha1":"50414e5e95c8007f066696f55aa75309555b83e2","expected_i64":"14"},{"id":"parentheses","kind":"positive","path":"contracts/atto-scalar-v1/positive/parentheses.atto","git_blob_sha1":"9f508169c741486d5cec7510ac84fb761f342def","expected_i64":"20"},{"id":"signed-minimum","kind":"positive","path":"contracts/atto-scalar-v1/positive/signed-minimum.atto","git_blob_sha1":"450ebee951733d3f0b567413e70724155d26ce13","expected_i64":"-9223372036854775808"},{"id":"signed-max-minus-one","kind":"positive","path":"contracts/atto-scalar-v1/positive/signed-max-minus-one.atto","git_blob_sha1":"c400f440fde2fbc10514ab7cfd2ffe3d19729ee1","expected_i64":"9223372036854775806"},{"id":"type-first-readonly","kind":"positive","path":"contracts/atto-scalar-v1/positive/type-first-readonly.atto","git_blob_sha1":"75ff4afc98fc65a774611eb7686e893f3d28a6da","expected_i64":"42"},{"id":"typed-const-readonly","kind":"positive","path":"contracts/atto-scalar-v1/positive/typed-const-readonly.atto","git_blob_sha1":"0325018c54dd3534ddac76dc29724aa61e979683","expected_i64":"42"},{"id":"inferred-const-readonly","kind":"positive","path":"contracts/atto-scalar-v1/positive/inferred-const-readonly.atto","git_blob_sha1":"4fe471862d90ba57e135b93728bd44690ff2c894","expected_i64":"42"},{"id":"pure-call","kind":"positive","path":"contracts/atto-scalar-v1/positive/pure-call.atto","git_blob_sha1":"e5ab32f7d8f684d655a83a3df989f16c52090c05","expected_i64":"42"},{"id":"checked-add-overflow","kind":"negative","path":"contracts/atto-scalar-v1/negative/checked-add-overflow.atto","git_blob_sha1":"eed3113842125b1d2a295a11e3cc01a5c1e3da00","diagnostic_family":"checked-overflow"},{"id":"checked-sub-overflow","kind":"negative","path":"contracts/atto-scalar-v1/negative/checked-sub-overflow.atto","git_blob_sha1":"3f80e2eff35147984b040eb0a0215b439d20d09b","diagnostic_family":"checked-overflow"},{"id":"checked-mul-overflow","kind":"negative","path":"contracts/atto-scalar-v1/negative/checked-mul-overflow.atto","git_blob_sha1":"e608942c7e84fddb6ad7ca119a4a11d88aa9434b","diagnostic_family":"checked-overflow"},{"id":"type-first-reassignment","kind":"negative","path":"contracts/atto-scalar-v1/negative/type-first-reassignment.atto","git_blob_sha1":"b118f53e68565dcb9e6acd58deb8ee47dca67606","diagnostic_family":"immutable-binding"},{"id":"typed-const-reassignment","kind":"negative","path":"contracts/atto-scalar-v1/negative/typed-const-reassignment.atto","git_blob_sha1":"784ebd47a50211e6f00cb732cc74319ed1e58fac","diagnostic_family":"immutable-binding"},{"id":"eager-unused-overflow","kind":"negative","path":"contracts/atto-scalar-v1/negative/eager-unused-overflow.atto","git_blob_sha1":"ff0c520f2bc2efcc3daf032eb61fddc8f0c91d48","diagnostic_family":"checked-overflow"},{"id":"removed-modulo","kind":"negative","path":"contracts/atto-scalar-v1/negative/removed-modulo.atto","git_blob_sha1":"45d5794870e93074d9b11b90833a849e96aaa4c1","diagnostic_family":"removed-operator"},{"id":"removed-caret","kind":"negative","path":"contracts/atto-scalar-v1/negative/removed-caret.atto","git_blob_sha1":"6889c7e83c8d94b906fbfe78723caee9580da6aa","diagnostic_family":"removed-operator"},{"id":"removed-double-caret","kind":"negative","path":"contracts/atto-scalar-v1/negative/removed-double-caret.atto","git_blob_sha1":"7ee99948018e927cce74c9ad0edc1975e4251689","diagnostic_family":"removed-operator"}];
const ROUTES=["java","llvm","wasm","net","forge"];
const NOTE="Canonical source identity and source-only tests do not prove compiler-backed execution.";
function keys(o,expected) {
  if (!o||typeof o!=="object"||Array.isArray(o)||
      JSON.stringify(Object.keys(o))!==JSON.stringify(expected))
    throw Error("noncanonical scalar corpus keys");
}
function safeFile(root,rel) {
  if(typeof rel!=="string"||isAbsolute(rel)||rel.includes("\\")||
     rel.split("/").some(x=>!x||x==="."||x===".."))
    throw Error("noncanonical scalar source path");
  let p=root;
  for(const x of rel.split("/")){
    p=join(p,x);
    if(lstatSync(p).isSymbolicLink())throw Error("symlinked scalar corpus path");
  }
  if(!lstatSync(p).isFile()||relative(root,p).startsWith(".."+sep))
    throw Error("scalar corpus path is not a regular child file");
  return p;
}
export function verifyAttoScalarCorpus(directory=ROOT){
  const root=resolve(directory);
  if(realpathSync(root)!==root)throw Error("corpus root must be physical");
  const manifestPath="contracts/atto-scalar-v1/cases.json";
  const raw=readFileSync(safeFile(root,manifestPath),"utf8");
  const corpus=JSON.parse(raw);
  if(raw!==JSON.stringify(corpus,null,2)+"\n")
    throw Error("noncanonical or duplicate scalar manifest");
  keys(corpus,["schema","language","source_extension","compiler_routes","evidence_status","evidence_note","cases"]);
  if(corpus.schema!=="attolang.scalar-core.v1"||corpus.language!=="AttoLang"||
     corpus.source_extension!==".atto"||JSON.stringify(corpus.compiler_routes)!==JSON.stringify(ROUTES)||
     corpus.evidence_status!=="NOT_EXECUTED"||corpus.evidence_note!==NOTE)
    throw Error("incorrect source-only or compiler-route policy");
  if(!Array.isArray(corpus.cases)||corpus.cases.length!==CASES.length)
    throw Error("missing or extra scalar cases");
  let positive=0,negative=0;
  for(let i=0;i<CASES.length;i++){
    const e=corpus.cases[i],pinned=CASES[i];
    if(JSON.stringify(e)!==JSON.stringify(pinned))
      throw Error("scalar case identity/expectation mismatch: "+i);
    if(!/^contracts\/atto-scalar-v1\/(positive|negative)\/[a-z0-9-]+\.atto$/.test(e.path))
      throw Error("invalid .atto source path");
    const bytes=readFileSync(safeFile(root,e.path));
    if(!bytes.length||bytes.length>8192)throw Error("invalid scalar source size");
    const sha=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    if(sha!==e.git_blob_sha1)throw Error("scalar source Git blob mismatch: "+e.id);
    if(e.kind==="positive")positive++;else negative++;
  }
  if(positive!==9||negative!==9)throw Error("wrong scalar test polarity");
  return {positive,negative,compilerRoutes:ROUTES.length,sourceOnly:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log("ATTO_SCALAR_CORPUS_SOURCE_ONLY "+JSON.stringify(verifyAttoScalarCorpus()));}
  catch(e){console.error("ATTO_SCALAR_CORPUS_FAIL: "+e.message);process.exitCode=1;}
}
