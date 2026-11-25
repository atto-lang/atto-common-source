import assert from "node:assert/strict";
import test from "node:test";
import { checkTotalIntervalObligation as check } from "./total-interval-proof.mjs";

const base = {width: 32, op: "add", left: [1n, 2n], right: [3n, 4n], post: [4n, 6n]};
test("prove total arithmetic only with enclosing postcondition", () => {
  assert.deepEqual(check(base), {proved: true, bounds: [4n, 6n]});
  assert.equal(check({...base, post: [4n, 5n]}).reason, "postcondition-not-proved");
  assert.deepEqual(check({...base, op: "multiply", left: [-2n, 3n], right: [-4n, 5n], post: [-12n, 15n]}),
    {proved: true, bounds: [-12n, 15n]});
});
test("both widths reject overflowing operations and zero divisors", () => {
  for (const width of [32, 64]) {
    const min = -(1n << BigInt(width - 1)), max = -min - 1n;
    const full = [min, max];
    assert.equal(check({...base, width, op: "add", left: [max,max], right: [1n,1n], post: full}).reason, "possible-overflow");
    assert.equal(check({...base, width, op: "divide", left: [min,min], right: [-1n,-1n], post: full}).reason, "possible-overflow");
    assert.equal(check({...base, width, op: "divide", right: [-1n,1n], post: full}).reason, "possible-zero-divisor");
    assert.deepEqual(check({...base, width, op: "divide", left: [-9n,-5n], right: [2n,3n], post: [-4n,-1n]}),
      {proved: true, bounds: [-4n,-1n]});
  }
});
test("inverted intervals, unsupported operators and widths cannot prove obligations", () => {
  for (const mutant of [{left:[2n,1n]}, {width: 8}, {op:"assume"}, {post:[0,10]}]) {
    assert.equal(check({...base,...mutant}).proved, false);
  }
});
