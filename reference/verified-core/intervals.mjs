// The proof domain is the normal outcomes of checked signed-i64 arithmetic.
// This is an independent oracle for the compiler proof rules.
export const i64Min = -(1n << 63n);
export const i64Max = (1n << 63n) - 1n;
export const full = Object.freeze([i64Min, i64Max]);

const lower = (a, b) => a < b ? a : b;
const upper = (a, b) => a > b ? a : b;

export function includes([low, high], actual) {
  return low <= actual[0] && high >= actual[1];
}

export function constrain([low, high], op, bound) {
  switch (op) {
    case "eq": low = upper(low, bound); high = lower(high, bound); break;
    case "<": high = lower(high, bound - 1n); break;
    case "<=": high = lower(high, bound); break;
    case ">": low = upper(low, bound + 1n); break;
    case ">=": low = upper(low, bound); break;
    default: throw new TypeError("unsupported interval comparison");
  }
  if (low > high) throw new RangeError("contradictory interval");
  return [low, high];
}

function clip(low, high) {
  low = upper(low, i64Min);
  high = lower(high, i64Max);
  return low <= high ? [low, high] : full;
}

export function normalResult(op, [low, high], [rightLow, rightHigh]) {
  if (op === "add") return clip(low + rightLow, high + rightHigh);
  if (op === "subtract") return clip(low - rightHigh, high - rightLow);
  let apply;
  if (op === "multiply") {
    apply = (a, b) => a * b;
  } else if (op === "divide") {
    if ((rightLow <= 0n && rightHigh >= 0n)
        || (low === i64Min && rightLow <= -1n && rightHigh >= -1n)) return full;
    apply = (a, b) => a / b;
  } else {
    throw new TypeError("unsupported interval operation");
  }
  const corners = [apply(low, rightLow), apply(low, rightHigh),
    apply(high, rightLow), apply(high, rightHigh)];
  return clip(corners.reduce(lower), corners.reduce(upper));
}

export function atMost(left, right) {
  return left[1] <= right[0];
}

export function preservesUpperBounds(op, left, right, dimensionlessRight) {
  if (op === "add") return right[1] <= 0n;
  if (op === "subtract") return right[0] >= 0n;
  return op === "divide" && left[0] >= 0n && right[0] > 0n && dimensionlessRight;
}
