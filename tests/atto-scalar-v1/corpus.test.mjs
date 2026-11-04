import test from "node:test";
import assert from "node:assert/strict";
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyAttoScalarCorpus} from "../../scripts/atto-scalar-v1/verify.mjs";
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const rel="contracts/atto-scalar-v1";
function setup(t){
  const root=mkdtempSync(join(tmpdir(),"atto-scalar-v1-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dest=join(root,rel);
  mkdirSync(join(dest,"positive"),{recursive:true});
  mkdirSync(join(dest,"negative"),{recursive:true});
  const manifest=join(dest,"cases.json");
  copyFileSync(join(sourceRoot,rel,"cases.json"),manifest);
  const c=JSON.parse(readFileSync(manifest,"utf8"));
  for(const item of c.cases)copyFileSync(join(sourceRoot,item.path),join(root,item.path));
  return {root,manifest,c};
}
function write(f){writeFileSync(f.manifest,JSON.stringify(f.c,null,2)+"\n");}
test("all 18 immutable exact-source fixtures and five routes are present",t=>{
  const f=setup(t);assert.deepEqual(verifyAttoScalarCorpus(f.root),
    {positive:9,negative:9,compilerRoutes:5,sourceOnly:true});
});
test("positive source mutation is rejected",t=>{
  const f=setup(t),p=join(f.root,f.c.cases[0].path);
  writeFileSync(p,readFileSync(p,"utf8").replace("40 + 2","40 + 3"));
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/Git blob mismatch/);
});
test("negative source mutation is rejected",t=>{
  const f=setup(t),p=join(f.root,f.c.cases.at(-1).path);
  writeFileSync(p,readFileSync(p,"utf8").replace("^^","^"));
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/Git blob mismatch/);
});
test("missing fixture is not execution evidence",t=>{
  const f=setup(t);rmSync(join(f.root,f.c.cases[0].path));
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/ENOENT/);
});
test("fixture symlink is rejected",t=>{
  const f=setup(t),p=join(f.root,f.c.cases[0].path),renamed=p+".real";
  renameSync(p,renamed);symlinkSync(renamed,p);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/symlinked/);
});
test("directory symlink is rejected",t=>{
  const f=setup(t),p=join(f.root,rel,"positive"),renamed=p+"-real";
  renameSync(p,renamed);symlinkSync(renamed,p);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/symlinked/);
});
test("manifest symlink is rejected",t=>{
  const f=setup(t),p=f.manifest,renamed=p+".real";
  renameSync(p,renamed);symlinkSync(renamed,p);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/symlinked/);
});
test("duplicate JSON keys cannot redefine the spec",t=>{
  const f=setup(t),raw=readFileSync(f.manifest,"utf8");
  writeFileSync(f.manifest,raw.replace('"schema": "attolang.scalar-core.v1",',
    '"schema": "forged",\n  "schema": "attolang.scalar-core.v1",'));
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/noncanonical or duplicate/);
});
test("dropping Forge cannot promote four of five routes",t=>{
  const f=setup(t);f.c.compiler_routes.pop();write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/compiler-route policy/);
});
test("Cranelift cannot impersonate Forge",t=>{
  const f=setup(t);f.c.compiler_routes[4]="cranelift";write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/compiler-route policy/);
});
test("source-only status cannot be changed to passed",t=>{
  const f=setup(t);f.c.evidence_status="EXECUTED";write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/source-only/);
});
test("missing negative case fails",t=>{
  const f=setup(t);f.c.cases.pop();write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/missing or extra/);
});
test("changed expected typed integer fails",t=>{
  const f=setup(t);f.c.cases[0].expected_i64="43";write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/identity\/expectation/);
});
test("negative rejection cannot count as positive execution",t=>{
  const f=setup(t);f.c.cases.at(-1).kind="positive";write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/identity\/expectation/);
});
test("legacy source path substitution fails",t=>{
  const f=setup(t);f.c.cases[0].path="contracts/atto-scalar-v1/positive/canonical-add.ores";write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/identity\/expectation/);
});
test("unapproved certified parity metadata fails",t=>{
  const f=setup(t);f.c.certifiedParity=true;write(f);
  assert.throws(()=>verifyAttoScalarCorpus(f.root),/noncanonical scalar corpus keys/);
});
