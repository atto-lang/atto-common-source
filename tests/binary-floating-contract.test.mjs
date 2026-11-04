import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/library/v1/binary-floating.json", import.meta.url), "utf8"));

function fromBits(hex) {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setBigUint64(0, BigInt("0x" + hex), false);
  return v.getFloat64(0, false);
}
function bits(value) {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setFloat64(0, value, false);
  return v.getBigUint64(0, false).toString(16).padStart(16, "0");
}
function f32FromBits(hex) {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setUint32(0, Number(BigInt("0x" + hex)), false);
  return v.getFloat32(0, false);
}
function f32Bits(value) {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setFloat32(0, value, false);
  return v.getUint32(0, false).toString(16).padStart(8, "0");
}
function approxEq(a, b, absTol, relTol) {
  if (![absTol, relTol].every(Number.isFinite) || absTol < 0 || relTol < 0) {
    throw new RangeError("invalid tolerance");
  }
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
}

test("binary floating contract locks strict portable defaults", () => {
  assert.equal(contract.contract, "oreslang.binary-floating.v1");
  assert.equal(contract.default_profile.reassociation, "forbidden");
  assert.equal(contract.default_profile.implicit_fma_contraction, "forbidden");
  assert.equal(contract.default_profile.flush_subnormals_to_zero, "forbidden");
  assert.equal(contract.default_profile.fast_math, "never implicit");
  assert.equal(contract.types.f32.includes("distinct"), true);
});

test("binary floating reference cases preserve signed zero, subnormals and NaN ordering", () => {
  for (const item of contract.cases.filter(x => x.operation === "abs")) {
    assert.equal(bits(Math.abs(fromBits(item.input_bits))), item.expect_bits, item.id);
  }
  const neg = contract.cases.find(x => x.id === "neg-positive-zero");
  assert.equal(bits(-fromBits(neg.input_bits)), neg.expect_bits);
  const ulp = contract.cases.find(x => x.id === "ulp-one");
  assert.equal(bits(Number.EPSILON), ulp.expect_bits);

  const signedZero = contract.cases.find(x => x.id === "eq-signed-zero");
  assert.equal(fromBits(signedZero.a_bits) === fromBits(signedZero.b_bits), signedZero.expect);
  const nanEq = contract.cases.find(x => x.id === "nan-equality");
  assert.equal(fromBits(nanEq.a_bits) === fromBits(nanEq.b_bits), nanEq.expect);
  const nanOrder = contract.cases.find(x => x.id === "nan-ordering");
  assert.equal(fromBits(nanOrder.a_bits) < fromBits(nanOrder.b_bits), nanOrder.expect);

  for (const item of contract.f32_cases) {
    const input=f32FromBits(item.input_bits);
    const output=item.operation==="abs" ? Math.abs(input) : -input;
    assert.equal(f32Bits(output),item.expect_bits,item.id);
  }

  for (const item of contract.cases.filter(x => x.operation === "approx_eq")) {
    const a = item.a === "NaN" ? NaN : item.a;
    const b = item.b === "NaN" ? NaN : item.b;
    assert.equal(approxEq(a, b, item.abs_tol, item.rel_tol), item.expect, item.id);
  }
});


test("approximate equality never admits unequal infinities through infinite tolerance products", () => {
  for (const infinity of [Infinity, -Infinity]) {
    assert.equal(approxEq(infinity, infinity, 0, 0), true);
    assert.equal(approxEq(infinity, infinity, 1, 1), true);
    for (const other of [0, 1, -1, Number.MAX_VALUE, -Number.MAX_VALUE, -infinity]) {
      assert.equal(approxEq(infinity, other, 1, 1), false);
      assert.equal(approxEq(other, infinity, 1, 1), false);
    }
  }
});
