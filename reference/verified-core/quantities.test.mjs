import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQuantityMain } from "./quantities.mjs";

const declarations = [
  { kind: "dimension", name: "Time" },
  { kind: "dimension", name: "Length" },
  { kind: "unit", name: "Second", dimension: "Time" },
  { kind: "unit", name: "Millis", dimension: "Time", relativeTo: "Second", factor: "1000", divide: true },
  { kind: "unit", name: "Tick", dimension: "Time", relativeTo: "Millis" },
  { kind: "unit", name: "Meter", dimension: "Length" },
];
const literal = (value, unit) => ({ op: "literal", value, unit });
const binary = (op, left, right) => ({ op, left, right });
const convert = (value, unit) => ({ op: "convert", value, unit });
const evaluate = (expression) => evaluateQuantityMain(declarations, expression);

test("same-unit division truncates toward zero and produces a scalar", () => {
  assert.equal(evaluate(binary("divide", literal("-85", "Millis"), literal("2", "Millis"))), -42n);
  assert.equal(evaluate(binary("divide", literal("84", "Millis"), literal("2", "Tick"))), 42n);
});
test("cross-unit conversion checks the actual value", () => {
  assert.equal(evaluate(binary("divide", convert(literal("84000", "Millis"), "Second"), literal("2", "Second"))), 42n);
  assert.throws(() => evaluate(convert(literal("1500", "Millis"), "Second")), { code: "E_UNIT_INEXACT" });
  assert.throws(() => evaluate(convert(literal("9223372036854775807", "Second"), "Millis")), { code: "E_UNIT_RANGE" });
});
test("scale and dimension both matter before returning an int", () => {
  assert.throws(() => evaluate(binary("divide", literal("1", "Second"), literal("1", "Millis"))), { code: "E_UNIT_ERASURE" });
  assert.throws(() => evaluate(binary("add", literal("1", "Second"), literal("1", "Millis"))), { code: "E_UNIT_SCALE" });
  assert.throws(() => evaluate(binary("add", literal("1", "Second"), literal("1", "Meter"))), { code: "E_UNIT_DIMENSION" });
  assert.throws(() => evaluate(binary("divide", literal("1"), literal("1", "Millis"))), { code: "E_UNIT_ERASURE" });
});
test("compose nominal exponent vectors and normalize exact aliases", () => {
  const area = binary("multiply", literal("7", "Meter"), literal("6", "Meter"));
  const areaUnit = binary("multiply", literal("1", "Meter"), literal("1", "Meter"));
  assert.equal(evaluate(binary("divide", area, areaUnit)), 42n);
});
test("checked arithmetic stays in range even if subsequent operations cancel", () => {
  assert.throws(() => evaluate(binary("divide", literal("-9223372036854775808", "Second"), literal("-1", "Second"))), { code: "E_I64_OVERFLOW" });
  assert.throws(() => evaluate(binary("divide", literal("1", "Second"), literal("0", "Second"))), { code: "E_I64_DIV_ZERO" });
  assert.throws(() => evaluate(binary("divide", literal("1"), literal("1"))), { code: "E_UNIT_SCALAR_DIVISION" });
});
test("quantity declarations reject malformed scales and cross-dimension names", () => {
  const derived = { kind: "unit", name: "Derived", dimension: "Time", relativeTo: "Second", factor: "0" };
  assert.throws(() => evaluateQuantityMain([...declarations, derived], literal("0")), { code: "E_UNIT_SCALE" });
  assert.throws(() => evaluateQuantityMain([...declarations, { ...derived, factor: "1", relativeTo: "Meter" }], literal("0")), { code: "E_UNIT_DIMENSION" });
});
