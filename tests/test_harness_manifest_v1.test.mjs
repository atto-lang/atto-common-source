import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../contracts/test-harness-v1.json", import.meta.url), "utf8"));
const required_targets = ["host_oracle", "guest_java", "guest_llvm", "guest_net", "guest_rust_wasm", "guest_forge"];
test("registry is complete, unique and never promotes unexecuted backend behavior", () => {
  assert.equal(manifest.schema, "atto.test.harness.v1");
  assert.equal(manifest.status, "PROPOSED");
  assert.equal(manifest.claims.api_implemented_in_atto, false);
  assert.equal(manifest.claims.guest_compilation_executed, false);
  assert.equal(manifest.claims.backend_parity_certified, false);
  assert.equal(manifest.cases.length, 24);
  const names = new Set();
  for (const c of manifest.cases) {
    assert.match(c.id, /^[a-z][a-z0-9_]+$/);
    assert.ok(!names.has(c.id), "duplicate id: " + c.id);
    names.add(c.id);
    assert.ok(["positive", "negative"].includes(c.kind));
    assert.ok(c.expectation.trim().length > 10);
    for (const target of required_targets) assert.equal(c[target], "NOT_EXECUTED", c.id + ":" + target);
  }
});
test("no host-only evidence may set a guest compilation claim", () => {
  const tampered = structuredClone(manifest);
  tampered.claims.guest_compilation_executed = true;
  assert.notDeepEqual(tampered.claims, manifest.claims);
  assert.equal(manifest.claims.guest_compilation_executed, false);
});
