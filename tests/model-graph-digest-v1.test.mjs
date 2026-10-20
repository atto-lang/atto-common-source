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
