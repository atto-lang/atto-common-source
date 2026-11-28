import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const registry = JSON.parse(readFileSync(new URL("../contracts/test-core-guest-candidates-v1.json", import.meta.url), "utf8"));
const root = new URL("../", import.meta.url);
function git_blob_sha(path) {
  if (!/^[a-z0-9_./-]+$/.test(path) || path.split("/").includes("..")) throw Error("unsafe path");
  const contents = readFileSync(new URL(path, root));
  return createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
}

test("canonical staged Atto source Git blobs are byte exact", () => {
  assert.equal(registry.schema, "atto.test.core.guest-candidates.v1");
  assert.equal(git_blob_sha(registry.stdlib.path), registry.stdlib.git_blob_sha);
  assert.equal(registry.fixtures.length, 2);
  for (const fixture of registry.fixtures) {
    assert.equal(git_blob_sha(fixture.path), fixture.git_blob_sha);
    assert.equal(fixture.expected_exit, 0);
  }
});

test("host-only candidate registry must reject all guest PASS claims", () => {
  assert.equal(registry.source_only, true);
  assert.equal(registry.claims.atto_guest_compilation_executed, false);
  assert.equal(registry.claims.backend_parity_certified, false);
  assert.ok(Object.keys(registry.backend_status).length >= 5);
  for (const value of Object.values(registry.backend_status)) assert.equal(value, "NOT_EXECUTED");
});
