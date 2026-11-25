// Small independent checker for one total signed integer arithmetic obligation.
// Inputs must eventually be derived from compiler-minted typed IR, not trusted
// claims supplied by source or an untrusted proof producer. Not a general SMT checker.
export function checkTotalIntervalObligation({ width, op, left, right, post }) {
  const invalid = () => ({ proved: false, reason: "invalid-obligation" });
  if (width !== 32 && width !== 64) return invalid();
  const min = -(1n << BigInt(width - 1));
  const max = -min - 1n;
  const valid = r => Array.isArray(r) && r.length === 2 &&
    typeof r[0] === "bigint" && typeof r[1] === "bigint" &&
    min <= r[0] && r[0] <= r[1] && r[1] <= max;
  if (!valid(left) || !valid(right) || !valid(post)) return invalid();
  const [a, b] = left, [c, d] = right;
  let candidates;
  switch (op) {
    case "add": candidates = [a+c, b+d]; break;
    case "subtract": candidates = [a-d, b-c]; break;
    case "multiply": candidates = [a*c, a*d, b*c, b*d]; break;
    case "divide":
      if (c <= 0n && d >= 0n) return { proved: false, reason: "possible-zero-divisor" };
      if (a === min && c <= -1n && d >= -1n) return { proved: false, reason: "possible-overflow" };
      candidates = [a/c, a/d, b/c, b/d]; break;
    default: return invalid();
  }
  const low = candidates.reduce((x,y) => x < y ? x : y);
  const high = candidates.reduce((x,y) => x > y ? x : y);
  if (low < min || high > max) return { proved: false, reason: "possible-overflow" };
  if (low < post[0] || high > post[1]) return { proved: false, reason: "postcondition-not-proved" };
  return { proved: true, bounds: [low, high] };
}
