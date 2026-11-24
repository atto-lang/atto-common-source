import assert from "node:assert/strict";
import test from "node:test";
import { atMost, constrain, full, i64Max, i64Min, includes, normalResult, preservesUpperBounds } from "./intervals.mjs";

const operations = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
};

test("example preconditions establish positivity and a relational upper bound", () => {
  const positive = constrain(full, ">", 0n);
  const admissibleDuration = constrain(positive, ">=", 2n);
  const half = normalResult("divide", admissibleDuration, [2n, 2n]);
  assert.ok(includes(positive, half));
  assert.equal(atMost(half, admissibleDuration), false);
  assert.ok(preservesUpperBounds("divide", admissibleDuration, [2n, 2n], true));
  assert.equal(preservesUpperBounds("divide", admissibleDuration, [2n, 2n], false), false);
  assert.equal(includes(positive, normalResult("divide", positive, [2n, 2n])), false);
});

test("boundary proofs keep arithmetic failure distinct from normal results", () => {
  assert.deepEqual(normalResult("add", [i64Max - 1n, i64Max], [1n, 1n]), [i64Max, i64Max]);
  assert.deepEqual(normalResult("multiply", [i64Min, i64Max], [-1n, -1n]), [i64Min + 1n, i64Max]);
  assert.deepEqual(normalResult("divide", [i64Min, i64Min], [-1n, -1n]), full);
  assert.deepEqual(normalResult("divide", [21n, 42n], [-1n, 1n]), full);
  assert.throws(() => constrain(full, ">", i64Max), RangeError);
  assert.throws(() => constrain(full, "<", i64Min), RangeError);
  assert.throws(() => constrain([1n, 2n], "eq", 0n), RangeError);
});

test("interval and relational rules cover every normal result on small signed inputs", () => {
  const intervals = [];
  for (let lo = -4n; lo <= 4n; lo++) {
    for (let hi = lo; hi <= 4n; hi++) intervals.push([lo, hi]);
  }
  for (const [name, operation] of Object.entries(operations)) {
    for (const left of intervals) {
      for (const right of intervals) {
        const inferred = normalResult(name, left, right);
        const bounded = preservesUpperBounds(name, left, right, true);
        for (let a = left[0]; a <= left[1]; a++) {
          for (let b = right[0]; b <= right[1]; b++) {
            if (name === "divide" && b === 0n) continue;
            const value = operation(a, b);
            assert.ok(includes(inferred, [value, value]), `${a} ${name} ${b}`);
            if (bounded) assert.ok(value <= a, `${a} ${name} ${b} must be bounded by ${a}`);
          }
        }
      }
    }
  }
});
