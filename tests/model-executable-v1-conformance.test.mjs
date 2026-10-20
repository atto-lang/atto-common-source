import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const corpus = JSON.parse(fs.readFileSync(
  path.join(root, "contracts/v1/model-graph/executable-v1-conformance.json"), "utf8"));
const diagnostics = JSON.parse(fs.readFileSync(
  path.join(root, "contracts/v1/model-graph/diagnostics-v1.json"), "utf8"));
const registered = new Set(diagnostics.diagnostics.map(x => x.code));

const sha256 = text => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function graphDigest(defaultValue) {
  const identity = corpus.shared_operation_identity.Identity;
  const add = corpus.shared_operation_identity.AddDelta;
  const canonical =
    "ores-model-graph-v1|PriceAdjust|" +
    `p:delta:int:i64:${defaultValue}|` +
    `n0:Identity:${identity.abi}:${identity.implementation_digest}:|` +
    `n1:AddDelta:${add.abi}:${add.implementation_digest}:param:delta:int,|`;
  return sha256(canonical);
}

function configuredDigest(graph, value) {
  return sha256(`ores-model-configured-v1|${graph}|delta=i64:${value}|`);
}

function hexAscii(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    assert(code <= 0x7f, "projected source must remain ASCII");
    out += code.toString(16).padStart(2, "0");
  }
  return out;
}
function field(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}
function projectCorpus(value) {
  const lines = [
    "ORESLANG_MODEL_EXECUTABLE_CASES_V1",
    `revision|${value.revision}`,
    `profile|${value.portable_profile}`
  ];
  for (const item of value.cases) {
    lines.push([
      "case", item.id, item.expect, item.backend_mode?.java, item.backend_mode?.llvm,
      field(item.diagnostic), field(item.llvm_diagnostic), field(item.graph_digest),
      field(item.configured_graph_digest), field(item.semantic_result_i64),
      hexAscii(item.source)
    ].join("|"));
  }
  for (const item of value.identity_cases ?? []) {
    lines.push([
      "identity", item.id, String(item.expect_same_graph_digest),
      field(item.expected_graph_digest), field(item.variant_operation_digest),
      field(item.variant_graph_digest), hexAscii(item.baseline_source),
      hexAscii(item.variant_source)
    ].join("|"));
  }
  return lines.join("\n") + "\n";
}

test("line-oriented backend projection is generated exactly from normative JSON", () => {
  const projected = fs.readFileSync(
    path.join(root, "contracts/v1/model-graph/executable-v1-conformance.cases"), "utf8");
  assert.equal(projected, projectCorpus(corpus));
});

test("executable-v1 corpus has a stable portable i64 profile", () => {
  assert.equal(corpus.contract, "oreslang.model.executable.conformance.v1");
  assert.equal(corpus.revision, "model-core-i64-v1.2026-10-20.5");
  assert.equal(corpus.portable_profile, "model-core-i64-v1");
  assert.deepEqual(
    corpus.profile_semantics.operation_expression_subset,
    ["i64-literal","parameter-read","unary-negate","add","subtract","multiply"]);
  assert.match(corpus.evidence_rule, /exact tested source tree/i);
  assert.match(corpus.evidence_rule, /nonempty runner steps/i);
});

test("shared positive, negative and INT64_MIN identities recompute independently", () => {
  const vectors = new Map([
    ["price-adjust-default-positive", "2"],
    ["price-adjust-default-negative", "-2"],
    ["price-adjust-i64-minimum", "-9223372036854775808"]
  ]);
  for (const [id, value] of vectors) {
    const item = corpus.cases.find(x => x.id === id);
    assert(item, id);
    const graph = graphDigest(value);
    assert.equal(graph, item.graph_digest, id);
    assert.equal(configuredDigest(graph, value), item.configured_graph_digest, id);
  }
});

test("signed i64 overflow corpus is symmetric around the one legal minimum endpoint", () => {
  const ids = [
    "default-positive-i64-overflow",
    "default-negative-i64-overflow",
    "static-positive-i64-overflow",
    "static-negative-i64-overflow"
  ];
  for (const id of ids) {
    const item = corpus.cases.find(x => x.id === id);
    assert(item, id);
    assert.equal(item.expect, "reject", id);
    assert.equal(item.diagnostic, "MODEL_CONST_OVERFLOW", id);
    assert.equal(item.backend_mode.java, "reject", id);
    assert.equal(item.backend_mode.llvm, "reject", id);
  }
  const minimum = corpus.cases.find(x => x.id === "price-adjust-i64-minimum");
  assert.equal(minimum.expect, "accept");
  assert.equal(minimum.semantic_result_i64, "-9223372036854775808");
});

test("undeclared static names are unknown formals, not generic nonconstants", () => {
  const item = corpus.cases.find(x => x.id === "unknown-static-formal");
  assert(item);
  assert.equal(item.expect, "reject");
  assert.equal(item.diagnostic, "MODEL_UNKNOWN_FORMAL");
  assert.equal(item.backend_mode.java, "reject");
  assert.equal(item.backend_mode.llvm, "reject");
});

test("duplicate model parameters use one shared diagnostic class", () => {
  const item = corpus.cases.find(x => x.id === "duplicate-model-parameter");
  assert(item);
  assert.equal(item.diagnostic, "MODEL_DUPLICATE_PARAMETER");
  assert.equal(item.backend_mode.java, "reject");
  assert.equal(item.backend_mode.llvm, "reject");
});

test("operation identity is alpha-stable but operand-order sensitive", () => {
  const identity = corpus.shared_operation_identity.Identity;
  const add = corpus.shared_operation_identity.AddDelta;
  assert.equal(
    sha256(identity.abi + "|return=arg:0"),
    identity.implementation_digest);
  assert.equal(
    sha256(add.abi + "|return=binary:+(arg:1,arg:0)"),
    add.implementation_digest);

  const alpha = corpus.identity_cases.find(x => x.id === "operation-parameter-alpha-rename");
  assert(alpha);
  assert.equal(alpha.expect_same_graph_digest, true);
  assert.equal(alpha.expected_graph_digest,
    corpus.cases.find(x => x.id === "price-adjust-default-positive").graph_digest);

  const order = corpus.identity_cases.find(x => x.id === "operation-operand-order");
  assert(order);
  assert.equal(order.expect_same_graph_digest, false);
  assert.equal(
    sha256(add.abi + "|return=binary:+(arg:0,arg:1)"),
    order.variant_operation_digest);
  assert.notEqual(order.variant_graph_digest, alpha.expected_graph_digest);
});

test("all executable-v1 rejection diagnostics are registered", () => {
  for (const item of corpus.cases) {
    if (item.expect === "reject") {
      assert.match(item.diagnostic, /^MODEL_[A-Z0-9_]+$/, item.id);
      assert(registered.has(item.diagnostic), item.diagnostic);
    }
    if (item.llvm_diagnostic) {
      assert(registered.has(item.llvm_diagnostic), item.llvm_diagnostic);
    }
  }
});

test("portable cases require explicit backend execution modes", () => {
  const ids = new Set();
  for (const item of corpus.cases) {
    assert(!ids.has(item.id), `duplicate case ${item.id}`);
    ids.add(item.id);
    assert(item.source.includes("define model"), item.id);
    assert(["accept","reject","backend-specific"].includes(item.expect), item.id);
    assert(["execute","compile_only","reject"].includes(item.backend_mode.java), item.id);
    assert(["execute","compile_only","reject"].includes(item.backend_mode.llvm), item.id);
    if (item.expect === "accept") {
      assert.notEqual(item.backend_mode.java, "reject", item.id);
      assert.notEqual(item.backend_mode.llvm, "reject", item.id);
    }
  }
});

test("backend-specific stored model values are not misrepresented as portable", () => {
  const item = corpus.cases.find(x => x.id === "stored-model-value");
  assert.equal(item.expect, "backend-specific");
  assert.equal(item.backend_mode.java, "execute");
  assert.equal(item.backend_mode.llvm, "reject");
  assert.equal(item.llvm_diagnostic, "MODEL_VALUE_STORAGE_UNSUPPORTED");
});
