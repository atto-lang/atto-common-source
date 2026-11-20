import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(here, "../contracts/library/v1/native-math-unary-precision.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

function evalI64(operation, operand) {
  const value = BigInt(operand);
  if (value < I64_MIN || value > I64_MAX) throw new Error("fixture operand outside i64");
  if (operation === "Math.neg") {
    if (value === I64_MIN) return { error: "OVERFLOW" };
    return { value: String(-value) };
  }
  if (operation === "Math.abs") {
    if (value === I64_MIN) return { error: "OVERFLOW" };
    return { value: String(value < 0n ? -value : value) };
  }
  throw new Error("unknown operation");
}

function evalBigInt(operation, operand) {
  const value = BigInt(operand);
  if (operation === "Math.neg") return String(-value);
  if (operation === "Math.abs") return String(value < 0n ? -value : value);
  throw new Error("unknown operation");
}

function f64FromBits(hex) {
  const bits = BigInt("0x" + hex);
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function f64Bits(value) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

test("contract identity is closed", () => {
  assert.equal(contract.schema_version, "1.0.0");
  assert.equal(contract.contract, "oreslang.native-math-unary-precision.v1");
  assert.equal(contract.status, "normative-reference-not-backend-proof");
  const ids = [
    ...contract.signed_i64_unary,
    ...contract.bigint_unary,
    ...contract.decimal_unary,
    ...contract.binary64_unary,
    ...contract.precision_cases,
  ].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("signed i64 abs and neg are checked", () => {
  assert.equal(contract.signed_i64_unary.length, 10);
  for (const item of contract.signed_i64_unary) {
    assert.deepEqual(evalI64(item.operation, item.operand), item.expect, item.id);
  }
});

test("BigInt unary vectors are exact", () => {
  for (const item of contract.bigint_unary) {
    assert.equal(evalBigInt(item.operation, item.operand), item.expect, item.id);
  }
});

test("binary64 sign operations preserve IEEE signed zero/infinity semantics", () => {
  for (const item of contract.binary64_unary) {
    const input = f64FromBits(item.operand_bits);
    const output = item.operation === "Math.abs" ? Math.abs(input) : -input;
    assert.equal(f64Bits(output), item.expect_bits, item.id);
  }
});

test("precision separation is explicit", () => {
  const binary = contract.precision_cases.find((x) => x.id === "binary64-point-one-plus-point-two");
  assert.equal(String(Number(binary.lhs) + Number(binary.rhs)), binary.must_equal_decimal_string);
  const bigint = contract.precision_cases.find((x) => x.id === "bigint-above-2pow53");
  assert.equal(BigInt(bigint.value), 9007199254740993n);
  assert.notEqual(Number(bigint.value).toString(), bigint.value);
  const decimal = contract.precision_cases.find((x) => x.id === "decimal-point-one-plus-point-two");
  assert.equal(decimal.expect, "0.3");
  const third = contract.precision_cases.find((x) => x.id === "decimal-one-third");
  assert.equal(third.without_context, "NONTERMINATING_REQUIRES_CONTEXT");
});
