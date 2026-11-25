import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalModelGraphV1Bytes, digestModelGraphV1, ModelDigestError } from "../experiments/model_graph_digest_v1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(fs.readFileSync(
  path.join(here, "../contracts/v1/model-graph/digest-v1-vectors.json"), "utf8"));
const clone = x => structuredClone(x);
const err = (code, fn) => assert.throws(fn,
  e => e instanceof ModelDigestError && e.code === code);

test("normative pricing graph matches the portable SHA-256 vector", () => {
  assert.equal(digestModelGraphV1(vectors.base.graph), vectors.base.expected);
  assert.equal(canonicalModelGraphV1Bytes(vectors.base.graph).length, 544);
});

test("static configuration changes portable graph identity", () => {
  const graph = clone(vectors.base.graph);
  graph.nodes[1].constArgs[0].value = "1501";
  assert.equal(digestModelGraphV1(graph),
    vectors.mutations.find(x => x.id === "static-constant-change").expected);
});

test("implementation digest changes identity even when ABI is unchanged", () => {
  const graph = clone(vectors.base.graph);
  graph.nodes[1].signature.implDigest = "4".repeat(64);
  assert.equal(digestModelGraphV1(graph),
    vectors.mutations.find(x => x.id === "implementation-change").expected);
});

test("temporary node labels do not participate in portable graph identity", () => {
  const graph = clone(vectors.base.graph);
  graph.nodes[0].id = "a";
  graph.nodes[1].id = "b"; graph.nodes[1].inputs = ["a"];
  graph.nodes[2].id = "c"; graph.nodes[2].inputs = ["b"];
  graph.outputs = ["c"];
  assert.equal(digestModelGraphV1(graph),
    vectors.mutations.find(x => x.id === "temporary-node-id-rename").expected);
});

test("topology and output order remain semantic", () => {
  const graph = clone(vectors.base.graph);
  graph.nodes[2].inputs = ["source"];
  assert.notEqual(digestModelGraphV1(graph), vectors.base.expected);

  const two = clone(vectors.base.graph);
  two.outputs = ["tax", "round"];
  const reversed = clone(two);
  reversed.outputs.reverse();
  assert.notEqual(digestModelGraphV1(two), digestModelGraphV1(reversed));
});

test("forward/cyclic references fail before hashing", () => {
  const graph = clone(vectors.base.graph);
  graph.nodes[1].inputs = ["round"];
  err("MODEL_FORWARD_OR_CYCLIC_EDGE", () => digestModelGraphV1(graph));
});

test("malformed implementation digests and enum drift fail closed", () => {
  const badDigest = clone(vectors.base.graph);
  badDigest.nodes[0].signature.implDigest = "abc";
  err("MODEL_INVALID_IMPLEMENTATION_DIGEST", () => digestModelGraphV1(badDigest));

  const badEffect = clone(vectors.base.graph);
  badEffect.nodes[0].signature.effect = "almost-pure";
  err("MODEL_INVALID_OP_SIGNATURE", () => digestModelGraphV1(badEffect));
});

test("canonical i64 and finite f64 encodings enforce bounds", () => {
  const i64 = clone(vectors.base.graph);
  i64.nodes[1].constArgs[0].value = "9223372036854775808";
  err("MODEL_CONST_OVERFLOW", () => digestModelGraphV1(i64));

  const f64 = clone(vectors.base.graph);
  f64.nodes[1].signature.constKinds = ["f64bits"];
  f64.nodes[1].constArgs = [{ kind: "f64bits", value: "0x7ff0000000000000" }];
  err("MODEL_NONFINITE_CONST", () => digestModelGraphV1(f64));
});

test("invalid UTF-16 surrogate input is never replacement-normalized into a digest", () => {
  const graph = clone(vectors.base.graph);
  graph.modelTypeId = "finance.\ud800Price";
  err("MODEL_DIGEST_STRING", () => digestModelGraphV1(graph));
});

test("graph generation, instance, parameters, run and backend profile are not graph fields", () => {
  for (const field of ["graphGeneration","instanceId","parameterVersion","runId",
                       "executionProfileDigest","targetTriple"]) {
    const graph = clone(vectors.base.graph);
    graph[field] = "forged";
    err("MODEL_INVALID_RESOLVED_GRAPH", () => digestModelGraphV1(graph));
  }
});

test("ordered v1 external input boundary is hashed through the first signature", () => {
  assert.equal(canonicalModelGraphV1Bytes(vectors.externalInput.graph).length,
    vectors.externalInput.expectedBytes);
  assert.equal(digestModelGraphV1(vectors.externalInput.graph),
    vectors.externalInput.expected);
  const changed = clone(vectors.externalInput.graph);
  changed.nodes[0].signature.inputs[0].typeAbi = "finance.OtherPrice@v1";
  assert.notEqual(digestModelGraphV1(changed), vectors.externalInput.expected);
});


test("ordered v1 accepts unary external run(input), not missing later dependencies", () => {
  assert.equal(digestModelGraphV1(vectors.externalInput.graph),
    vectors.externalInput.expected);

  const missingLater = clone(vectors.externalInput.graph);
  missingLater.nodes[1].inputs = [];
  err("MODEL_PORT_ARITY_MISMATCH", () => digestModelGraphV1(missingLater));

  const missingFirst = clone(vectors.externalInput.graph);
  missingFirst.nodes[0].signature.inputs.push(
    clone(missingFirst.nodes[0].signature.inputs[0]));
  err("MODEL_PORT_ARITY_MISMATCH", () => digestModelGraphV1(missingFirst));
});

test("wrong edge counts and foreign typed ports cannot acquire graph identity", () => {
  const missing = clone(vectors.base.graph);
  missing.nodes[1].inputs = [];
  err("MODEL_PORT_ARITY_MISMATCH", () => digestModelGraphV1(missing));

  const excess = clone(vectors.base.graph);
  excess.nodes[1].inputs.push("source");
  err("MODEL_PORT_ARITY_MISMATCH", () => digestModelGraphV1(excess));

  const nominal = clone(vectors.base.graph);
  nominal.nodes[1].signature.inputs[0].typeAbi = "finance.Weight@v1";
  err("MODEL_PORT_TYPE_MISMATCH", () => digestModelGraphV1(nominal));

  const bytes = clone(vectors.base.graph);
  bytes.nodes[1].signature.inputs[0].bytes = 32;
  err("MODEL_PORT_TYPE_MISMATCH", () => digestModelGraphV1(bytes));
});

test("typed buffer edges validate dtype, extents, units and canonical layout", () => {
  const graph = clone(vectors.base.graph);
  const numeric = (unit, shape, dtype = "f64") => ({dtype, shape, unit});
  graph.nodes[0].signature.output = numeric("USD", [4]);
  graph.nodes[1].signature.inputs[0] = numeric("USD", [4]);
  graph.nodes[1].signature.output = numeric("USD", [4]);
  graph.nodes[2].signature.inputs[0] = numeric("USD", [4]);
  const validDigest = digestModelGraphV1(graph);
  assert.equal(validDigest.length, 64);
  graph.nodes[1].signature.inputs[0].layout = "contiguous";
  assert.equal(digestModelGraphV1(graph), validDigest,
    "implicit and explicit contiguous layouts have equal meaning");

  for (const corrupt of [
    p => {p.dtype = "f32";},
    p => {p.shape = [5];},
    p => {p.unit = "kg";},
    p => {delete p.unit;}
  ]) {
    const invalid = clone(graph);
    corrupt(invalid.nodes[1].signature.inputs[0]);
    err("MODEL_PORT_TYPE_MISMATCH", () => digestModelGraphV1(invalid));
  }

  const impossible = clone(graph);
  impossible.nodes[1].signature.inputs[0] =
    {kind: "nominal", typeAbi: "finance.Price@v1", bytes: 16};
  err("MODEL_PORT_TYPE_MISMATCH", () => digestModelGraphV1(impossible));
});



test("host digest refuses mismatched static-constant signatures", () => {
  const wrongArity = clone(vectors.base.graph);
  wrongArity.nodes[1].constArgs = [];
  err("MODEL_CONST_ARITY_MISMATCH", () => digestModelGraphV1(wrongArity));

  const wrongKind = clone(vectors.base.graph);
  wrongKind.nodes[1].constArgs[0] = { kind: "bool", value: true };
  err("MODEL_CONST_TYPE_MISMATCH", () => digestModelGraphV1(wrongKind));
});

test("host byte bounds agree with signed 64-bit backend limits", () => {
  const huge = clone(vectors.base.graph);
  huge.nodes[0].signature.output = { dtype: "f64", shape: [1n << 62n] };
  err("MODEL_SIZE_OVERFLOW", () => canonicalModelGraphV1Bytes(huge));

  const zero = clone(vectors.base.graph);
  zero.nodes[0].signature.output = { dtype: "f64", shape: [1n << 62n, 0] };
  zero.nodes[1].signature.inputs[0] = { dtype: "f64", shape: [1n << 62n, 0] };
  assert.equal(digestModelGraphV1(zero).length, 64);

  const invalidUnit = clone(vectors.base.graph);
  invalidUnit.nodes[0].signature.output = {
    dtype: "f64", shape: [1], unit: "incorrect unit"
  };
  err("MODEL_INVALID_PORT", () => digestModelGraphV1(invalidUnit));
});

test("Symbol constants bind nominal kind and NFC logical name, not #display syntax", () => {
  const symbolGraph = (symbolKind, name) => {
    const graph = clone(vectors.base.graph);
    graph.nodes[1].signature.constKinds = ["symbol"];
    graph.nodes[1].constArgs = [{kind:"symbol", value:{symbolKind,name}}];
    return graph;
  };
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const process = symbolGraph("process", uuid);
  const stable = symbolGraph("stable", uuid);
  const processBytes = canonicalModelGraphV1Bytes(process);
  const stableBytes = canonicalModelGraphV1Bytes(stable);
  assert.equal(processBytes.length, stableBytes.length);
  assert.notDeepEqual(processBytes, stableBytes);
  assert.notEqual(digestModelGraphV1(process), digestModelGraphV1(stable));
  assert.equal(digestModelGraphV1(process), digestModelGraphV1(symbolGraph("process", uuid)));
  assert.notEqual(digestModelGraphV1(symbolGraph("process", "ready")),
    digestModelGraphV1(symbolGraph("process", "error")));

  for (const [kind, name] of [
    ["process", "e\u0301"],
    ["process", "\ud800"], ["process", "x".repeat(257)],
    ["process", "\u202eunsafe"], ["process", ""],
    ["stable", "NOT-A-UUID"], ["stable", uuid.toUpperCase()],
    ["forged", "ready"]
  ]) {
    err("MODEL_INVALID_CONST", () => digestModelGraphV1(symbolGraph(kind, name)));
  }
  const wrongShape = symbolGraph("process", "ready");
  wrongShape.nodes[1].constArgs[0].value.authority = "forged";
  err("MODEL_INVALID_CONST", () => digestModelGraphV1(wrongShape));
  const getterGraph = symbolGraph("process", "ready");
  let touched = 0;
  const value = {symbolKind:"process"};
  Object.defineProperty(value, "name", {enumerable:true, get(){touched++; return "ready";}});
  getterGraph.nodes[1].constArgs[0].value = value;
  err("MODEL_INVALID_CONST", () => digestModelGraphV1(getterGraph));
  assert.equal(touched, 0);
});

test("packed layout changes identity and must match across an edge", () => {
  const graph = clone(vectors.base.graph);
  function packed(layout) {
    return { dtype: "f64", shape: [1, 3], layout };
  }
  graph.nodes[0].signature.output = packed("aos");
  graph.nodes[1].signature.inputs = [packed("aos")];
  graph.nodes[1].signature.output = packed("soa");
  graph.nodes[2].signature.inputs = [packed("soa")];
  const withConversion = digestModelGraphV1(graph);

  const implicit = clone(graph);
  implicit.nodes[2].signature.inputs[0].layout = "aos";
  err("MODEL_PORT_TYPE_MISMATCH", () => digestModelGraphV1(implicit));

  // With a singleton row these have identical byte order. The contracts still differ.
  graph.nodes[1].signature.output.layout = "aos";
  graph.nodes[2].signature.inputs[0].layout = "aos";
  assert.notEqual(digestModelGraphV1(graph), withConversion);

  graph.nodes[2].signature.output = { ...packed("soa"), shape: [3] };
  err("MODEL_INVALID_PORT", () => digestModelGraphV1(graph));
  graph.nodes[2].signature.output = { ...packed("soa"), layout: null };
  err("MODEL_INVALID_PORT", () => digestModelGraphV1(graph));
});
