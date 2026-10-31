import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract=JSON.parse(readFileSync(
  new URL("../contracts/library/v1/numeric-errors.json",import.meta.url),"utf8"));

test("numeric failures are language Error values, not host exception identity",()=>{
  assert.equal(contract.contract,"oreslang.numeric-errors.v1");
  assert.equal(contract.base_type,"Error");
  assert.equal(contract.rules.default_checked_fixed_width_failure,"throw");
  assert.match(contract.rules.host_failures,/never guest Error identity/);
});

test("default checked overflow is catchable throw with normal escalation",()=>{
  assert.equal(contract.errors.ArithmeticOverflowError.default_effect,"throw");
  assert.equal(contract.errors.DivisionByZeroError.default_effect,"throw");
  assert.match(contract.rules.catchability,/uncaught throw becomes raise/);
  assert.match(contract.actor_semantics.throw_inside_actor,/throw->raise->panic/);
  assert.match(contract.actor_semantics.supervisor_notice,/final panic escalation/);
});

test("Result-returning numeric APIs do not double-report expected failures",()=>{
  assert.match(contract.rules.checked_result_apis,/Err/);
  for(const name of [
    "InexactConversionError","NumericRangeError","NumericParseError",
    "NumericContextError","NonterminatingDecimalError"
  ]) assert.match(contract.errors[name].default_effect,/Result\.Err/);
});

test("numeric resource exhaustion is preflighted and API-shaped",()=>{
  assert.match(contract.errors.NumericResourceError.applies_to.join("\n"),/preflight/);
  assert.match(contract.errors.NumericResourceError.default_effect,/Result\.Err or throw/);
});


test("numeric guest error ABI codes are stable and host-neutral",()=>{
  assert.equal(contract.error_abi_v1.code_width_bits,32);
  assert.equal(contract.error_abi_v1.codes.ArithmeticOverflowError,65537);
  assert.equal(contract.errors.ArithmeticOverflowError.abi_code,65537);
  assert.match(contract.error_abi_v1.rules,/host exception class, signal, trap opcode or diagnostic string is never sufficient identity/);
  assert.equal(new Set(Object.values(contract.error_abi_v1.codes)).size,
    Object.keys(contract.error_abi_v1.codes).length);
});
