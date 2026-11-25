import assert from "node:assert/strict";
import test from "node:test";
import { exploreProtocolTurns } from "./protocol-turn-interleavings.mjs";

test("bounded model preserves publication authority and credits", () => {
  const proof = exploreProtocolTurns(12);
  assert.equal(proof.safe, true);
  assert.equal(proof.states, 87);
  assert.equal(proof.transitions, 189);
});
test("omitted fence and duplicate settlement have reachable counterexamples", () => {
  for (const [mutant, expected] of [["omit-stop-fence", "publication-authority"], ["double-credit", "credit-conservation"]]) {
    const result = exploreProtocolTurns(12, mutant);
    assert.equal(result.safe, false);
    assert.equal(result.violation, expected);
    assert.ok(result.trace.length > 0);
  }
});
