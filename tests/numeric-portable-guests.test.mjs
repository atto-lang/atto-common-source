import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const root=new URL("../",import.meta.url);
const manifest=JSON.parse(readFileSync(
  new URL("../contracts/library/v1/numeric-portable-guests.json",import.meta.url),"utf8"));

function gitBlobSha(bytes){
  const header=Buffer.from("blob "+bytes.length+"\0");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

test("portable numeric guest corpus is byte pinned",()=>{
  assert.equal(manifest.contract,"oreslang.numeric-portable-guests.v1");
  assert.match(manifest.evidence_rule,/exact blob bytes/);
  for(const fixture of manifest.fixtures){
    const bytes=readFileSync(new URL("../"+fixture.path,import.meta.url));
    assert.equal(gitBlobSha(bytes),fixture.git_blob_sha1,fixture.id);
  }
});

test("portable Math guests encode one value and two typed overflow targets",()=>{
  const byId=Object.fromEntries(manifest.fixtures.map(x=>[x.id,x]));
  assert.deepEqual(byId["math-i64-ok"].expected,{kind:"value",i64:"84"});
  for(const id of ["math-i64-abs-min","math-i64-neg-min"]){
    assert.equal(byId[id].expected.kind,"error");
    assert.equal(byId[id].expected.guest_error,"ArithmeticOverflowError");
  }
  assert.equal(byId["math-i64-abs-min"].expected.operation,"abs");
  assert.equal(byId["math-i64-neg-min"].expected.operation,"neg");
});

test("provisional backend failures are never mislabeled as guest error parity",()=>{
  for(const adapter of Object.values(manifest.provisional_failure_adapters))
    assert.notEqual(adapter,"ArithmeticOverflowError");
});
