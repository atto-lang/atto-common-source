import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const ledger=JSON.parse(readFileSync(
  new URL("../contracts/library/v1/numeric-backend-status.json",import.meta.url),"utf8"));

test("numeric backend ledger never upgrades unexecuted work to verified",()=>{
  assert.equal(ledger.contract,"oreslang.numeric-backend-status.v1");
  assert.match(ledger.rule,/exact-head real compiler\/runtime execution/);
  for(const [name,backend] of Object.entries(ledger.backends)){
    assert.equal(backend.verified_compiled,false,name);
    assert.notEqual(backend.math_i64,"verified_compiled",name);
  }
});

test("unsupported precision families remain explicitly fail-closed or unclaimed",()=>{
  for(const name of ["llvm","net","forge"]){
    for(const family of ["f32","bigint","decimal"])
      assert.equal(ledger.backends[name][family],"fail_closed",name+" "+family);
  }
  assert.equal(ledger.backends.java.f32,"fail_closed");
  assert.equal(ledger.backends.java.bigint,"reference_class_only");
  assert.equal(ledger.backends.java.decimal,"reference_class_only");
  assert.equal(ledger.backends.wasm.bigint,"fail_closed");
  assert.equal(ledger.backends.wasm.decimal,"fail_closed");
});

test("typed overflow and strict conversions remain blocking everywhere",()=>{
  assert.ok(ledger.blockers.some(x=>x.includes("ArithmeticOverflowError")));
  assert.ok(ledger.blockers.some(x=>x.includes("explicit-only numeric conversions")));
  for(const backend of Object.values(ledger.backends))
    assert.match(backend.overflow_error_abi,/provisional/);
});
