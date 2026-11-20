import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {spec,tryFrom,codePoints} from "./refinement.mjs";

const source=fileURLToPath(new URL("../../fixtures/refinement-v1/cases.json",import.meta.url));
const fixture=JSON.parse(readFileSync(source,"utf8"));
assert.equal(fixture.schema_version,1);
assert.equal(fixture.length_unit,"Unicode scalar values");
let checked=0, rejected=0, deferred=0;
for(const test of fixture.cases){
  if(!test.reference_supported){deferred++;continue;}
  if(test.kind==="reject"){
    assert.throws(()=>spec(test.source),undefined,test.id);
    rejected++;
    continue;
  }
  const contract=spec(test.source);
  assert.equal(contract.nominal,test.kind==="nominal_newtype",test.id);
  for(const value of test.valid??[]){
    assert.equal(tryFrom(contract,value).ok,true,test.id+" should accept valid literal");
    checked++;
  }
  for(const value of test.invalid??[]){
    assert.equal(tryFrom(contract,value).ok,false,test.id+" should reject invalid literal");
    checked++;
  }
}
assert.equal(codePoints("😀"),1);
assert.equal(codePoints("e\u0301"),2);
console.log({checked,rejected,deferred});
