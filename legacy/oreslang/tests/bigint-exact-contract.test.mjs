import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/library/v1/bigint-exact.json", import.meta.url), "utf8"));

function f64Bits(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

test("BigInt exact contract identity and arithmetic vectors", () => {
  assert.equal(contract.contract, "oreslang.bigint-exact.v1");
  assert.equal(contract.status, "normative-reference-not-backend-proof");
  const ids = [
    ...contract.arithmetic_cases,
    ...contract.division_cases,
    ...contract.conversion_cases,
  ].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const item of contract.arithmetic_cases) {
    const a = "left" in item ? BigInt(item.left) : BigInt(item.operand);
    let actual;
    switch (item.operation) {
      case "add": actual = a + BigInt(item.right); break;
      case "sub": actual = a - BigInt(item.right); break;
      case "mul": actual = a * BigInt(item.right); break;
      case "neg": actual = -a; break;
      case "abs": actual = a < 0n ? -a : a; break;
      default: throw new Error("unknown operation " + item.operation);
    }
    assert.equal(actual.toString(), item.expect, item.id);
  }
});

test("BigInt quotient and remainder truncate toward zero and preserve identity", () => {
  for (const item of contract.division_cases) {
    const a = BigInt(item.left);
    const b = BigInt(item.right);
    if (item.error) {
      assert.equal(b, 0n, item.id);
      continue;
    }
    const q = a / b;
    const r = a % b;
    assert.equal(q.toString(), item.quot, item.id + " quotient");
    assert.equal(r.toString(), item.rem, item.id + " remainder");
    assert.equal(q * b + r, a, item.id + " identity");
    assert.ok((r < 0n ? -r : r) < (b < 0n ? -b : b), item.id + " bound");
  }
});

test("BigInt checked and binary64 conversions are explicit", () => {
  const min = -(1n << 63n), max = (1n << 63n) - 1n;
  for (const item of contract.conversion_cases) {
    const value = BigInt(item.operand);
    if (item.operation === "to_i64_checked") {
      const overflow = value < min || value > max;
      if (item.error) assert.ok(overflow, item.id);
      else {
        assert.ok(!overflow, item.id);
        assert.equal(value.toString(), item.expect, item.id);
      }
      continue;
    }
    const rounded = Number(value);
    if (item.operation === "to_f64_nearest") {
      assert.equal(f64Bits(rounded), item.expect_bits, item.id);
      continue;
    }
    const exact = Number.isFinite(rounded) && BigInt(rounded) === value;
    if (item.error) assert.equal(exact, false, item.id);
    else {
      assert.equal(exact, true, item.id);
      assert.equal(f64Bits(rounded), item.expect_bits, item.id);
    }
  }
});
