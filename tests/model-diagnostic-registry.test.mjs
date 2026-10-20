import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const registry = JSON.parse(fs.readFileSync(
  path.join(root, "contracts/v1/model-graph/diagnostics-v1.json"), "utf8"));
const entries = new Map(registry.diagnostics.map(x => [x.code, x]));

function modelCodes(text) {
  return new Set(text.match(/MODEL_[A-Z0-9_]+/g) ?? []);
}
function collectFiles(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

test("diagnostic registry has unique classes and stable phase ordering", () => {
  assert.equal(registry.contract, "oreslang.model.diagnostics.v1");
  assert.deepEqual(registry.phase_order,
    ["syntax","lowering","admission","gradient","identity","implementation"]);
  assert.equal(entries.size, registry.diagnostics.length);
  registry.diagnostics.forEach((entry, index) => {
    assert.match(entry.code, /^MODEL_[A-Z0-9_]+$/);
    assert(registry.phase_order.includes(entry.phase), entry.code);
    assert.equal(entry.ordinal, index);
    assert.equal(typeof entry.meaning, "string");
    assert(entry.meaning.length > 10);
  });
});

test("all model diagnostics used by shared executable contracts are registered", () => {
  const files = [
    "experiments/model_graph_admission.mjs",
    "experiments/model_run_fence.mjs",
    "experiments/model_graph_digest_v1.mjs",
    "tests/model-graph-admission-v2.test.mjs",
    "tests/model-run-fence.test.mjs",
    "tests/model-graph-digest-v1.test.mjs",
    "contracts/v1/model-graph/compiler-cases.json",
    "contracts/v1/model-graph/executable-v1-conformance.json",
    "contracts/v1/model-autodiff/cases.json"
  ].map(x => path.join(root, x));
  files.push(...collectFiles(path.join(root, "contracts/v1/model-graph/fixtures")));
  files.push(...collectFiles(path.join(root, "contracts/v1/model-autodiff/fixtures")));

  const missing = [];
  for (const file of files) {
    for (const code of modelCodes(fs.readFileSync(file, "utf8"))) {
      if (!entries.has(code)) missing.push({ file: path.relative(root, file), code });
    }
  }
  assert.deepEqual(missing, []);
});

test("same diagnostic class cannot move between compiler phases", () => {
  const byCode = new Map();
  for (const entry of registry.diagnostics) {
    const old = byCode.get(entry.code);
    assert(old === undefined || old === entry.phase,
      `${entry.code} appears in both ${old} and ${entry.phase}`);
    byCode.set(entry.code, entry.phase);
  }
  assert.equal(entries.get("MODEL_EMPTY_BODY").phase, "syntax");
  assert.equal(entries.get("MODEL_PORT_SHAPE_MISMATCH").phase, "lowering");
  assert.equal(entries.get("MODEL_MISSING_VJP").phase, "gradient");
  assert.equal(entries.get("MODEL_GRAPH_GENERATION_MISMATCH").phase, "identity");
  assert.equal(entries.get("MODEL_LOWERING_NOT_IMPLEMENTED").phase, "implementation");
});

test("forward-only missing VJP remains a phase distinction, not a declaration rejection", () => {
  const compilerCases = JSON.parse(fs.readFileSync(
    path.join(root, "contracts/v1/model-graph/compiler-cases.json"), "utf8"));
  const forward = compilerCases.cases.find(x => x.id === "forward-without-vjp");
  const gradient = compilerCases.cases.find(x => x.id === "gradient-without-vjp");
  assert.equal(forward.fixture, gradient.fixture);
  assert.equal(forward.typed_expect, "accept");
  assert.equal(gradient.diagnostic_class, "MODEL_MISSING_VJP");
  assert.equal(entries.get(gradient.diagnostic_class).phase, "gradient");
});


test("active executable-v1 diagnostic phases stay stable", () => {
  const lowering = [
    "MODEL_AMBIGUOUS", "MODEL_AMBIGUOUS_OP", "MODEL_COMPOSITION_NOT_ENABLED",
    "MODEL_CONFIG_ARITY", "MODEL_CONFIG_DEFAULT_ORDER", "MODEL_CONFIG_TYPE_ARGUMENTS",
    "MODEL_CONFIG_TYPE_MISMATCH", "MODEL_DUPLICATE", "MODEL_DUPLICATE_PARAMETER",
    "MODEL_INVALID_CONFIG_TYPE", "MODEL_INVALID_IDENTIFIER", "MODEL_INVALID_STATIC_ARG",
    "MODEL_RUN_ARITY", "MODEL_TYPE_NAME_COLLISION", "MODEL_VALUE_NAME_COLLISION",
    "MODEL_UNKNOWN_FORMAL"
  ];
  const admission = ["MODEL_BUDGET", "MODEL_CONFIG_BUDGET", "MODEL_STATIC_ARG_BUDGET"];
  const identity = ["MODEL_CONFIG_SHAPE", "MODEL_MISSING_CONFIG", "MODEL_UNKNOWN_CONFIG"];
  const implementation = [
    "MODEL_CONFIG_NAMED_UNSUPPORTED",
    "MODEL_VALUE_STORAGE_UNSUPPORTED",
    "MODEL_ACTOR_TRANSFER_UNSUPPORTED"
  ];
  for (const code of lowering) assert.equal(entries.get(code)?.phase, "lowering", code);
  for (const code of admission) assert.equal(entries.get(code)?.phase, "admission", code);
  for (const code of identity) assert.equal(entries.get(code)?.phase, "identity", code);
  for (const code of implementation) assert.equal(entries.get(code)?.phase, "implementation", code);
});

test("parser-independent Java/LLVM ModelGraph admission diagnostics are registered", () => {
  const lowering = [
    "MODEL_FORMAL_DEFAULT_TYPE_MISMATCH",
    "MODEL_DUPLICATE_FORMAL",
    "MODEL_INVALID_OP_ABI",
    "MODEL_INVALID_IMPL_DIGEST",
    "MODEL_INVALID_OP_PROVENANCE",
    "MODEL_UNKNOWN_FORMAL",
    "MODEL_NAMED_ARGUMENT_UNRESOLVED"
  ];
  const admission = [
    "MODEL_FORMAL_BUDGET", "MODEL_ARGUMENT_BUDGET",
    "MODEL_GRAPH_BUDGET", "MODEL_PORT_ARITY_MISMATCH"
  ];
  for (const code of lowering) assert.equal(entries.get(code)?.phase, "lowering", code);
  for (const code of admission) assert.equal(entries.get(code)?.phase, "admission", code);
});
