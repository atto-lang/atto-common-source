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

function bigIntLexicallyValid(text){
  return /^-?(?:0|[1-9]\d*)$/.test(text);
}
function decimalLexicallyValid(text){
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text);
}

test("numeric parse tables are executable lexical contracts",()=>{
  for(const text of contract.parsing.BigInt.accepted)
    assert.equal(bigIntLexicallyValid(text),true,"BigInt accepted "+text);
  for(const text of contract.parsing.BigInt.rejected)
    assert.equal(bigIntLexicallyValid(text),false,"BigInt rejected "+text);
  for(const text of contract.parsing.Decimal.accepted)
    assert.equal(decimalLexicallyValid(text),true,"Decimal accepted "+text);
  for(const text of contract.parsing.Decimal.rejected)
    assert.equal(decimalLexicallyValid(text),false,"Decimal rejected "+text);

  const canonicalBigInt=text=>{
    const value=BigInt(text);
    return value.toString();
  };
  assert.deepEqual(
    contract.parsing.BigInt.accepted
      .filter(text=>text!=="-0")
      .map(canonicalBigInt),
    contract.parsing.BigInt.canonical_output);
  assert.equal(canonicalBigInt("-0"),"0");
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

test("BigInt and Decimal namespaces operate on lowercase source value types",()=>{
  for(const signature of Object.values(contract.bigint_api)){
    assert.doesNotMatch(signature,/Result<BigInt|: BigInt[>,)]/);
  }
  for(const signature of Object.values(contract.decimal_api)){
    assert.doesNotMatch(signature,/Result<Decimal|: Decimal[>,)]/);
  }
  assert.match(contract.bigint_api.parse,/Result<bigint,/);
  assert.match(contract.decimal_api.parse,/Result<decimal,/);
  assert.match(contract.decimal_api.divide_exact,/NonterminatingDecimalError/);
  assert.match(contract.bigint_api.quot,/NumericResourceError/);
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

test("numeric representation changes are explicit-only",()=>{
  assert.equal(contract.conversions.implicit_numeric_conversions,"none");
  assert.match(contract.conversions.mixed_numeric_arithmetic,/same numeric representation/);
  assert.match(contract.integer_api.to_f64_exact,/InexactConversionError/);
  assert.match(contract.conversions.f64_to_int,/assignment never narrows implicitly/);
});

test("hard-RT contract never certifies unbounded arbitrary precision",()=>{
  assert.match(contract.hard_rt.bigint_and_decimal,/not hard-real-time by default/);
  assert.match(contract.hard_rt.bigint_and_decimal,/statically bounded/);
});
