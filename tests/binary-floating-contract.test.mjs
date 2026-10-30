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
function approxEq(a, b, absTol, relTol) {
  if (![absTol, relTol].every(Number.isFinite) || absTol < 0 || relTol < 0) {
    throw new RangeError("invalid tolerance");
  }
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === b) return true;
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

test("binary floating reference cases preserve signed zero and tolerance rules", () => {
  const abs = contract.cases.find(x => x.id === "abs-negative-zero");
  assert.equal(bits(Math.abs(fromBits(abs.input_bits))), abs.expect_bits);
  const neg = contract.cases.find(x => x.id === "neg-positive-zero");
  assert.equal(bits(-fromBits(neg.input_bits)), neg.expect_bits);
  const ulp = contract.cases.find(x => x.id === "ulp-one");
  assert.equal(bits(Number.EPSILON), ulp.expect_bits);

  for (const item of contract.cases.filter(x => x.operation === "approx_eq")) {
    const a = item.a === "NaN" ? NaN : item.a;
    const b = item.b === "NaN" ? NaN : item.b;
    assert.equal(approxEq(a, b, item.abs_tol, item.rel_tol), item.expect, item.id);
  }
});
