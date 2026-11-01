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

test("lowering-dependent positives are not misreported as native passes", () => {
  assert.ok(manifest.cases.some(x => x.expected === "accept" && x.lowering_pending));
  assert.ok(manifest.cases.some(x => x.expected === "accept" && !x.lowering_pending));
  assert.ok(manifest.cases.some(x => x.expected === "reject"));
  assert.ok(manifest.cases.filter(x => x.category === "critical-suspends").length >= 3);
});
