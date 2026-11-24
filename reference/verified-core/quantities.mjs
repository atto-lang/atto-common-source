// Exact reference semantics for the file-local signed-i64 quantity profile.
// The compiler under test must implement its own source elaboration and lowering.
const min = -(1n << 63n);
const max = (1n << 63n) - 1n;
const dimensionless = Object.freeze({ powers: Object.freeze([]), n: 1n, d: 1n });

function reject(code, message) {
  throw Object.assign(new Error(message), { code });
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function unit(powers, n, d) {
  if (n <= 0n || d <= 0n) reject("E_UNIT_SCALE", "unit scales must be positive");
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  if (powers.length > 32 || powers.some(([, power]) => Math.abs(power) > 64) ||
      n.toString(2).length > 256 || d.toString(2).length > 256) {
    reject("E_UNIT_LIMIT", "normalized unit exceeds the profile limits");
  }
  return Object.freeze({ powers: Object.freeze(powers.map((entry) => Object.freeze(entry))), n, d });
}

function sameDimension(left, right) {
  return left.powers.length === right.powers.length &&
    left.powers.every(([name, power], i) => name === right.powers[i][0] && power === right.powers[i][1]);
}

function scalar(type) {
  return type.powers.length === 0 && type.n === type.d;
}

function combine(left, right, divide) {
  const powers = new Map(left.powers);
  for (const [name, power] of right.powers) {
    const next = (powers.get(name) ?? 0) + (divide ? -power : power);
    if (next) powers.set(name, next);
    else powers.delete(name);
  }
  return unit([...powers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    left.n * (divide ? right.d : right.n),
    left.d * (divide ? right.n : right.d));
}

function checked(value, code = "E_I64_OVERFLOW") {
  if (value < min || value > max) reject(code, "value is outside signed i64");
  return value;
}

function elaborate(declarations) {
  const dimensions = new Map();
  const units = new Map();
  const canonical = new Set();
  if (declarations.length > 128) reject("E_UNIT_LIMIT", "too many quantity declarations");
  for (const declaration of declarations) {
    const { kind, name, dimension, relativeTo, factor = "1", divide = false } = declaration;
    if (dimensions.has(name) || units.has(name)) reject("E_UNIT_DUPLICATE", name);
    if (kind === "dimension") {
      dimensions.set(name, unit([[name, 1]], 1n, 1n));
      continue;
    }
    if (kind !== "unit") throw new TypeError("invalid declaration kind");
    const base = dimensions.get(dimension);
    if (!base) reject("E_UNIT_NAME", dimension);
    if (relativeTo === undefined) {
      if (canonical.has(dimension)) reject("E_UNIT_DUPLICATE", dimension);
      canonical.add(dimension);
      units.set(name, base);
      continue;
    }
    const referenced = units.get(relativeTo);
    if (!referenced) reject("E_UNIT_NAME", relativeTo);
    const magnitude = checked(BigInt(factor), "E_UNIT_SCALE");
    const derived = unit(referenced.powers,
      referenced.n * (divide ? 1n : magnitude), referenced.d * (divide ? magnitude : 1n));
    if (!sameDimension(base, derived)) reject("E_UNIT_DIMENSION", name);
    units.set(name, derived);
  }
  return units;
}

function lookup(units, name) {
  if (name === undefined) return dimensionless;
  const found = units.get(name);
  if (!found) reject("E_UNIT_NAME", name);
  return found;
}

function infer(units, expr, depth = 0) {
  if (depth > 128) reject("E_UNIT_LIMIT", "expression too deep");
  if (expr.op === "literal") {
    const type = lookup(units, expr.unit);
    return { type, execute: () => checked(BigInt(expr.value)) };
  }
  if (expr.op === "convert") {
    const operand = infer(units, expr.value, depth + 1);
    const type = lookup(units, expr.unit);
    if (!sameDimension(operand.type, type)) reject("E_UNIT_DIMENSION", "conversion");
    // This profile folds a direct signed literal conversion at compilation.
    const n = operand.execute() * operand.type.n * type.d;
    const d = operand.type.d * type.n;
    if (n % d) reject("E_UNIT_INEXACT", "conversion is not integral");
    const value = checked(n / d, "E_UNIT_RANGE");
    return { type, execute: () => value };
  }
  if (expr.op === "negate") {
    const operand = infer(units, expr.value, depth + 1);
    return { type: operand.type, execute: () => checked(-operand.execute()) };
  }
  const left = infer(units, expr.left, depth + 1);
  const right = infer(units, expr.right, depth + 1);
  switch (expr.op) {
    case "add":
    case "subtract": {
      if (!sameDimension(left.type, right.type)) reject("E_UNIT_DIMENSION", "addition/subtraction");
      if (left.type.n !== right.type.n || left.type.d !== right.type.d) {
        reject("E_UNIT_SCALE", "addition/subtraction requires an explicit conversion");
      }
      const sign = expr.op === "add" ? 1n : -1n;
      return { type: left.type, execute: () => checked(left.execute() + sign * right.execute()) };
    }
    case "multiply":
      return { type: combine(left.type, right.type, false),
        execute: () => checked(left.execute() * right.execute()) };
    case "divide":
      if (scalar(left.type) && scalar(right.type)) reject("E_UNIT_SCALAR_DIVISION", "legacy scalar slash");
      return { type: combine(left.type, right.type, true), execute: () => {
        const numerator = left.execute();
        const denominator = right.execute();
        if (denominator === 0n) reject("E_I64_DIV_ZERO", "signed division by zero");
        return checked(numerator / denominator);
      } };
    default:
      throw new TypeError(`invalid expression operator: ${expr.op}`);
  }
}

/** Type an int-returning source fragment, then evaluate its checked arithmetic. */
export function evaluateQuantityMain(declarations, expression) {
  const typed = infer(elaborate(declarations), expression);
  if (!scalar(typed.type)) reject("E_UNIT_ERASURE", "int return requires dimensionless scale one");
  return typed.execute();
}
