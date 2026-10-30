import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract=JSON.parse(readFileSync(
  new URL("../contracts/library/v1/numeric-public-api.json",import.meta.url),"utf8"));

test("numeric public API separates source types from namespaces",()=>{
  assert.equal(contract.contract,"oreslang.numeric-public-api.v1");
  assert.deepEqual(
    Object.keys(contract.types).sort(),
    ["DecimalContext","bigint","decimal","f32","f64","int"].sort());
  assert.equal(contract.namespaces.BigInt.includes("source type bigint"),true);
  assert.equal(contract.namespaces.Decimal.includes("source type decimal"),true);
  assert.equal(contract.namespaces.Math.includes("compiler/type-system"),true);
  assert.equal("BigInt" in contract.types,false);
  assert.equal("Decimal" in contract.types,false);
});

test("numeric public API forbids host-defined guest semantics",()=>{
  const forbidden=contract.source_ownership.forbidden.join("\n");
  for(const required of [
    "public Java/.NET/C/C++/JavaScript numeric interop defining guest semantics",
    "implicit binary64 coercion for BigInt or Decimal",
    "host-global mutable decimal rounding context",
    "host overflow/wrap behavior leaking through Math.abs or Math.neg",
  ]) assert.ok(forbidden.includes(required),required);
});

test("checked conversion and arithmetic error surface is explicit",()=>{
  const errors=new Set(contract.errors);
  for(const name of [
    "ArithmeticOverflowError","DivisionByZeroError","InexactConversionError",
    "NumericRangeError","NumericParseError","NumericContextError",
    "NumericResourceError","NonterminatingDecimalError",
  ]) assert.ok(errors.has(name),name);

  assert.match(contract.math_overloads["Math.abs"].int,/ArithmeticOverflowError/);
  assert.match(contract.math_overloads["Math.neg"].int,/ArithmeticOverflowError/);
  assert.match(contract.bigint_api.to_i64_checked,/ArithmeticOverflowError/);
  assert.match(contract.bigint_api.to_f64_exact,/InexactConversionError/);
  assert.match(contract.decimal_api.to_f64_exact,/InexactConversionError/);
});

test("hard-RT contract never certifies unbounded arbitrary precision",()=>{
  assert.match(contract.hard_rt.bigint_and_decimal,/not hard-real-time by default/);
  assert.match(contract.hard_rt.bigint_and_decimal,/statically bounded/);
});
