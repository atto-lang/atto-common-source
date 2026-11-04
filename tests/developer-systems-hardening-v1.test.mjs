import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../contracts/v1/developer-systems-hardening.v1.json", import.meta.url);
const x = JSON.parse(readFileSync(fileURLToPath(root), "utf8"));
const expected = ["calls", "external-abi", "specification", "oop", "placement", "borrow", "cyclic-graphs", "incremental-build", "packages", "compatibility", "deployment"];
assert.equal(x.schema, "oreslang/developer-systems-hardening/v1");
assert.equal(x.status, "proposal-fixtures-not-execution");
assert.deepEqual(x.target_backends, ["java", "llvm", "wasm", "net", "forge"]);
assert.deepEqual(x.features.map(f => f.id), expected);
assert.equal(x.admission_policy.zero_step_workflow, "not-executed");
assert.equal(x.admission_policy.model_only, "reference-only");
assert.equal(x.admission_policy.unsupported, "explicit-rejection");
assert.equal(x.admission_policy.all_backends_required_for_full_parity, true);
assert.deepEqual(x.required_execution_receipt, [
  "case_id", "backend", "source_tree_sha", "compiler_artifact_sha",
  "linked_artifact_sha", "target_profile", "observed_result", "run_url"
]);
const ids = new Set();
for (const f of x.features) {
  assert.match(f.tier, /^P[012]$/);
  assert.equal(f.coverage_status, "planned_only");
  assert.ok(f.cases.length >= 3, f.id);
  assert.ok(f.cases.some(c => c.expect === "accept"), "missing accept case: " + f.id);
  assert.ok(f.cases.some(c => c.expect === "reject"), "missing negative case: " + f.id);
  for (const c of f.cases) {
    assert.ok(c.description.length > 30, "scenario too vague: " + c.id);
    assert.ok(["accept", "reject"].includes(c.expect));
    assert.ok(!ids.has(c.id), "duplicate case ID: " + c.id);
    ids.add(c.id);
  }
}
console.log("PASS: 11 hardening areas, " + ids.size + " planned scenarios; no execution or parity claim.");
