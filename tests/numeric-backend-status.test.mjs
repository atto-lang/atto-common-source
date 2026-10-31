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

test("typed overflow staging is precise and never upgraded to compiled proof",()=>{
  assert.ok(ledger.blockers.some(x=>x.includes("ArithmeticOverflowError")));
  assert.ok(ledger.blockers.some(x=>x.includes("explicit-only numeric conversions")));
  assert.match(ledger.backends.java.overflow_error_abi,/ArithmeticOverflowError_code_65537/);
  assert.match(ledger.backends.java.overflow_error_abi,/source throw\/raise\/panic still closed/);
  assert.match(ledger.backends.llvm.overflow_error_abi,/typed_Throw_code_65537/);
  assert.match(ledger.backends.llvm.overflow_error_abi,/nominal_Error_object_identity_fail_closed/);
  assert.match(ledger.backends.llvm.overflow_error_abi,/restricted_private_straight_line_i64_call_codegen/);
  assert.match(ledger.backends.llvm.overflow_error_abi,/cross_frame_leaf_middle_outer_catch_fixture_9d28e45c_staged/);
  assert.match(ledger.backends.llvm.overflow_error_abi,/uncaught_root_overflow_still_native_trap/);
  assert.match(ledger.backends.net.overflow_error_abi,/Throw_code_65537/);
  assert.match(ledger.backends.net.overflow_error_abi,/production_generated_CIL_still_uses_CLR_checked_exception_transport/);
  assert.match(ledger.backends.forge.overflow_error_abi,/Throw_code_65537/);
  assert.match(ledger.backends.forge.overflow_error_abi,/effect_aware_x86_64_AArch64_native_ABI_staged/);
  assert.match(ledger.backends.forge.overflow_error_abi,/no_handler_native_path_still_traps/);
  assert.match(ledger.backends.wasm.overflow_error_abi,/fail_closed/);
  for(const backend of Object.values(ledger.backends))
    assert.equal(backend.verified_compiled,false);
  assert.match(ledger.evidence_notes.overflow_error_abi,/not compiled verification/);
});
