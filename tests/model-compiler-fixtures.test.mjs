import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifestPath = path.join(root, "contracts/v1/model-graph/compiler-cases.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fixture = item => fs.readFileSync(
  path.join(root, "contracts/v1/model-graph", item.fixture), "utf8");

test("shared compiler manifest separates syntax, typed and execution evidence", () => {
  assert.equal(manifest.contract, "oreslang.model.graph.compiler-fixtures.v1");
  assert.equal(manifest.guest_execution, "NOT_EXECUTED");
  assert.match(manifest.note, /not evidence/i);
  for (const item of manifest.cases) {
    assert.match(fixture(item), /\bdefine\s+model\b/, item.id);
    assert(["accept", "reject"].includes(item.syntax_expect), item.id);
    assert(["accept", "reject", "not_reached"].includes(item.typed_expect), item.id);
    if (item.syntax_expect === "reject") {
      assert.equal(typeof item.diagnostic_class, "string", item.id);
      assert(fixture(item).includes(item.diagnostic_class), item.id);
    }
  }
});

test("cross-domain forward fixtures are not ML-only aliases", () => {
  const pricing = manifest.cases.find(x => x.id === "pricing-forward");
  const dsp = manifest.cases.find(x => x.id === "dsp-forward");
  assert.equal(pricing.domain, "finance");
  assert.equal(dsp.domain, "signal-processing");
  assert.equal(pricing.gradient_requested, false);
  assert.equal(dsp.gradient_requested, false);
  assert.match(fixture(pricing), /ApplyTaxBps/);
  assert.match(fixture(dsp), /ScaleSamples/);
  assert.equal(pricing.resolved_digest_vector, "base");
  assert.deepEqual(pricing.default_config, { tax_bps: "1500" });
  assert.equal(pricing.override_config.tax_bps, "1501");
  assert.equal(pricing.override_config.expected_digest,
    "1dcfd1569621a30e53c969b9bf0e2add7fe94a04c2bf4474fae821555996d21b");
});

test("one declaration can be forward-valid and gradient-invalid", () => {
  const forward = manifest.cases.find(x => x.id === "forward-without-vjp");
  const gradient = manifest.cases.find(x => x.id === "gradient-without-vjp");
  assert.equal(forward.fixture, gradient.fixture);
  assert.equal(forward.syntax_expect, "accept");
  assert.equal(forward.typed_expect, "accept");
  assert.equal(forward.gradient_requested, false);
  assert.equal(gradient.syntax_expect, "accept");
  assert.equal(gradient.typed_expect, "reject");
  assert.equal(gradient.gradient_requested, true);
  assert.equal(gradient.diagnostic_class, "MODEL_MISSING_VJP");
  assert.match(fixture(forward), /Quantize8/);
});

test("syntax-negative fixtures use the two stable parser diagnostics", () => {
  const rejected = manifest.cases.filter(x => x.syntax_expect === "reject");
  assert.deepEqual(
    new Set(rejected.map(x => x.diagnostic_class)),
    new Set(["MODEL_EMPTY_BODY", "MODEL_NON_LAYER_EXPRESSION"])
  );
});
