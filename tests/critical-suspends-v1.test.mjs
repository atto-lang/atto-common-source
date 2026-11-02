import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const fixtureUrl = new URL("../contracts/v1/critical-suspends-v1/cases.json", import.meta.url);
const manifest = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), "utf8"));

// Metadata only: a passed test here is NOT a native guest/compiler receipt.
test("critical/suspends v1 source-case manifest is complete and unambiguous", () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.backend_status, "not-verified");
  assert.equal(manifest.kind, "target-guest-source-cases");
  assert.ok(manifest.cases.length >= 20);
  const ids = new Set();
  for (const item of manifest.cases) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(item.id), item.id);
    ids.add(item.id);
    assert.ok(["accept", "reject"].includes(item.expected), item.id);
    assert.ok(typeof item.source === "string" && item.source.length > 10, item.id);
    assert.ok(typeof item.category === "string" && item.category.length > 0, item.id);
    assert.equal(typeof item.lowering_pending, "boolean", item.id);
    if (item.expected === "reject") {
      assert.equal(item.lowering_pending, false, item.id);
    }
  }
  for (const id of [
    "sync-callable", "suspends-callable", "critical-callable",
    "critical-block", "try-critical", "async-fnc",
    "critical-suspends-fnc", "suspends-critical-fnc",
    "await-in-critical", "indirect-await-in-critical",
    "actor-critical-method", "blocking-ffi-critical",
    "nested-critical", "actor-critical-suspends",
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test("native .ores critical fixtures are present but not certified", () => {
  const fixtureCases = manifest.cases.filter(x => x.source_file);
  assert.ok(fixtureCases.length >= 2);
  for (const item of fixtureCases) {
    assert.equal(item.expected, "accept");
    assert.equal(item.lowering_pending, true,
      "no fixture may become a claimed pass without executed compiler evidence");
    assert.match(item.source_file, /^contracts\/v1\/critical-suspends-v1\/[a-z0-9-]+\.ores$/);
    assert.equal(typeof item.expected_output, "string");
    assert.ok(item.expected_output.length > 0);
    const code = readFileSync(
      fileURLToPath(new URL("../" + item.source_file, import.meta.url)), "utf8");
    assert.match(code, /critical\s*\{/);
    assert.match(code, /suspends\s+receive/);
  }
});

test("lowering-dependent positives are not misreported as native passes", () => {
  assert.ok(manifest.cases.some(x => x.expected === "accept" && x.lowering_pending));
  assert.ok(manifest.cases.some(x => x.expected === "accept" && !x.lowering_pending));
  assert.ok(manifest.cases.some(x => x.expected === "reject"));
  assert.ok(manifest.cases.filter(x => x.category === "critical-suspends").length >= 3);
});

test("critical ticket ABI preserves nonparking acquisition across runtimes", () => {
  const path = new URL("../contracts/v1/critical-suspends-v1/runtime-gate.json", import.meta.url);
  const abi = JSON.parse(readFileSync(fileURLToPath(path), "utf8"));
  assert.equal(abi.version, 1);
  assert.equal(abi.admission.max_waiters_per_gate, 8192);
  assert.equal(abi.admission.queue_discipline, "FIFO");
  assert.equal(abi.admission.try_while_contended, "EMPTY");
  assert.equal(abi.language_effects.critical_body_suspends, false);
  assert.equal(abi.language_effects.critical_entry_may_suspend, true);
  assert.equal(abi.language_effects.async_callable_modifier, false);
  for (const op of ["request", "try_request", "release", "holds", "retire"])
    assert.ok(abi.operations[op]?.length > 30, op);
  for (const backend of ["java", "llvm", "dotnet", "wasm", "cranelift"])
    assert.ok(abi.backend_state[backend], backend);
  assert.match(abi.evidence, /No native Oreslang guest execution/);
});
