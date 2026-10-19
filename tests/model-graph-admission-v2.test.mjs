// Host-only adversarial and differential tests for a proposed compiler-owned HIR.
// These tests do NOT demonstrate a working Oreslang compiler or runtime.
import test from "node:test";
import assert from "node:assert/strict";
import { admitModelGraph as admit, ModelAdmissionError } from "../experiments/model_graph_admission.mjs";

const V = Object.freeze({ dtype: "f64", shape: [4], layout: "contiguous" });
const W = Object.freeze({ dtype: "f64", shape: [4], layout: "contiguous", unit: "kg" });
const S = Object.freeze({ dtype: "f64", shape: [], layout: "scalar" });
const op = (inputs, output, { effect = "pure", vjp = false, scratchBytes = 0, abi = "v1" } = {}) =>
  ({ inputs, output, effect, vjp, scratchBytes, abi });
const reg = () => new Map([
  ["VecInput", op([], V)],
  ["VecAdd", op([V, V], V, { vjp: true, scratchBytes: 8 })],
  ["VecScale", op([V], V, { vjp: true })],
  ["VecQuantize", op([V], V)],
  ["ScalarInput", op([], S)],
  ["MassInput", op([], W)],
  ["MassScale", op([W], W, { vjp: true })],
  ["BigScratch", op([V], V, { scratchBytes: 4096 })]
]);
const n = (id, opName, ...inputs) => ({ id, op: opName, inputs });
const g = (nodes, outputs = [nodes[nodes.length - 1].id]) => ({ name: "SafeGraph", nodes, outputs });
const errs = (code, fn) => assert.throws(fn, e => e instanceof ModelAdmissionError && e.code === code);
const grad = (outputs, targets) => ({ gradient: { outputs, targets } });

test("non-ML forward inference requires no autograd, actors, GPU or scheduler", () => {
  const result = admit(g([n("x", "VecInput"), n("q", "VecQuantize", "x")]), reg());
  assert.equal(result.upperBoundBytes, 64);
  assert.equal(result.gradientEdges, 0);
  assert.equal(result.executedGuest, false);
  assert.equal(result.executable, false);
  assert(Object.isFrozen(result));
});
test("VJP required only for the live selected gradient path", () => {
  const graph = g([n("x", "VecInput"), n("q", "VecQuantize", "x")]);
  assert.doesNotThrow(() => admit(graph, reg()));
  errs("MODEL_MISSING_VJP", () => admit(graph, reg(), grad(["q"], ["x"])));
});
test("nondifferentiable unrelated branch does not block gradient", () => {
  const graph = g([n("x", "VecInput"), n("y", "VecScale", "x"), n("q", "VecQuantize", "x")], ["y", "q"]);
  const a = admit(graph, reg(), grad(["y"], ["x"]));
  assert.equal(a.gradientEdges, 1);
});
test("two-edge fan-in and repeated operands retain both gradient paths", () => {
  const graph = g([n("x", "VecInput"), n("left", "VecScale", "x"),
    n("right", "VecScale", "x"), n("out", "VecAdd", "left", "right")]);
  assert.equal(admit(graph, reg(), grad(["out"], ["x"])).gradientEdges, 4);
  const repeated = g([n("x", "VecInput"), n("out", "VecAdd", "x", "x")]);
  assert.equal(admit(repeated, reg(), grad(["out"], ["x"])).gradientEdges, 2);
});
test("an undifferentiable fan-in branch cannot be silently skipped", () => {
  const graph = g([n("x", "VecInput"), n("left", "VecScale", "x"),
    n("right", "VecQuantize", "x"), n("out", "VecAdd", "left", "right")]);
  errs("MODEL_MISSING_VJP", () => admit(graph, reg(), grad(["out"], ["x"])));
});
test("nested targets require intermediate VJP only if ancestor also requested", () => {
  const graph = g([n("w", "VecInput"), n("mid", "VecQuantize", "w"),
    n("out", "VecScale", "mid")]);
  assert.doesNotThrow(() => admit(graph, reg(), grad(["out"], ["mid"])));
  errs("MODEL_MISSING_VJP", () => admit(graph, reg(), grad(["out"], ["mid", "w"])));
});
test("disconnected gradient target is denied, not implicitly zero", () => {
  const graph = g([n("w", "VecInput"), n("other", "VecInput"),
    n("out", "VecScale", "w")]);
  errs("MODEL_GRADIENT_DISCONNECTED", () => admit(graph, reg(), grad(["out"], ["other"])));
});
test("gradient output must be one of graph's exposed outputs", () => {
  const graph = g([n("w", "VecInput"), n("hidden", "VecScale", "w"),
    n("out", "VecScale", "hidden")]);
  errs("MODEL_UNKNOWN_GRADIENT_OUTPUT", () => admit(graph, reg(), grad(["hidden"], ["w"])));
});
test("duplicate gradient endpoints rejected", () => {
  const graph = g([n("x", "VecInput"), n("y", "VecScale", "x")]);
  errs("MODEL_DUPLICATE_GRADIENT_ENDPOINT", () => admit(graph, reg(), grad(["y"], ["x", "x"])));
});
test("user-supplied VJP/effect/shape/ABI/scratch overrides always rejected", () => {
  const base = g([n("x", "VecInput"), n("q", "VecQuantize", "x")]);
  for (const [k, v] of [["vjp", true], ["effect", "pure"], ["output", V],
    ["abi", "v999"], ["scratchBytes", 0], ["mutableOwner", "nobody"]]) {
    const graph = structuredClone(base); graph.nodes[1][k] = v;
    errs("MODEL_FORGED_OP_METADATA", () => admit(graph, reg(), grad(["q"], ["x"])));
  }
});
test("prototype-inherited nodes and metadata are rejected at trust boundary", () => {
  const graph = g([n("x", "VecInput")]);
  const inherited = Object.create({ id: "x", op: "VecInput", inputs: [] });
  graph.nodes = [inherited];
  errs("MODEL_FORGED_OP_METADATA", () => admit(graph, reg()));
  const inheritedGraph = Object.create({ name: "SafeGraph", nodes: [n("x", "VecInput")], outputs: ["x"] });
  errs("MODEL_INVALID_GRAPH", () => admit(inheritedGraph, reg()));
});
test("unknown/malformed signature and untrusted registry rejected", () => {
  const graph = g([n("x", "VecInput")]);
  errs("MODEL_UNTRUSTED_OP_REGISTRY", () => admit(graph, { VecInput: op([], V) }));
  errs("MODEL_UNKNOWN_OP", () => admit(g([n("x", "UntrustedOp")]), reg()));
  const bad = reg(); bad.set("Bad", op([V], V, { abi: "" }));
  errs("MODEL_INVALID_OP_SIGNATURE", () => admit(graph, bad));
});
test("effectful operation is disallowed on use; unused registry entries remain harmless", () => {
  const unsafe = reg(); unsafe.set("Impure", op([V], V, { effect: "network", vjp: true }));
  assert.doesNotThrow(() => admit(g([n("x", "VecInput")]), unsafe));
  errs("MODEL_EFFECTFUL_OP", () =>
    admit(g([n("x", "VecInput"), n("bad", "Impure", "x")]), unsafe));
});
test("shape mismatch and mismatched physical units denied", () => {
  const safe = reg(); safe.delete("Impure");
  errs("MODEL_PORT_TYPE_MISMATCH", () =>
    admit(g([n("s", "ScalarInput"), n("scaled", "VecScale", "s")]), safe));
  errs("MODEL_PORT_TYPE_MISMATCH", () =>
    admit(g([n("x", "VecInput"), n("mass", "MassScale", "x")]), safe));
});
test("unit-bearing matching graph is allowed without unit conversion", () => {
  const safe = reg(); safe.delete("Impure");
  assert.equal(admit(g([n("x", "MassInput"), n("y", "MassScale", "x")]), safe).nodes, 2);
});
test("zero extent in any position avoids artificial multiplication overflow", () => {
  const safe = new Map([["Zero", op([], { dtype: "f64", shape: [Number.MAX_SAFE_INTEGER, 0] })]]);
  assert.equal(admit(g([n("empty", "Zero")]), safe).upperBoundBytes, 0);
});
test("reject unsafe integers, negative dimensions, oversize rank, false layout", () => {
  for (const shape of [[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(9).fill(1)]) {
    const safe = new Map([["Wrong", op([], { dtype: "f64", shape })]]);
    errs(shape.length > 8 ? "MODEL_INVALID_PORT" : "MODEL_INVALID_EXTENT",
      () => admit(g([n("x", "Wrong")]), safe));
  }
  const safe = new Map([["Wrong", op([], { dtype: "f64", shape: [1], layout: "scalar" })]]);
  errs("MODEL_INVALID_PORT", () => admit(g([n("x", "Wrong")]), safe));
});
test("computed byte count cannot overflow a safe integer", () => {
  const safe = new Map([["TooBig", op([], { dtype: "f64", shape: [2 ** 51] })]]);
  errs("MODEL_SIZE_OVERFLOW", () => admit(g([n("x", "TooBig")]), safe));
});
test("actual per-node scratch is charged to resource budget", () => {
  const safe = reg(); safe.delete("Impure");
  errs("MODEL_MEMORY_BUDGET", () =>
    admit(g([n("x", "VecInput"), n("big", "BigScratch", "x")]), safe, { maxBytes: 4100 }));
  assert.equal(admit(g([n("x", "VecInput"), n("big", "BigScratch", "x")]), safe, { maxBytes: 4160 }).upperBoundBytes, 4160);
});
test("edge, node and path-depth budgets enforced independently", () => {
  const safe = reg(); safe.delete("Impure");
  const graph = g([n("x", "VecInput"), n("a", "VecScale", "x"),
    n("b", "VecScale", "a"), n("c", "VecAdd", "a", "b")]);
  errs("MODEL_NODE_BUDGET", () => admit(graph, safe, { maxNodes: 3 }));
  errs("MODEL_EDGE_BUDGET", () => admit(graph, safe, { maxEdges: 2 }));
  errs("MODEL_DEPTH_BUDGET", () => admit(graph, safe, { maxDepth: 3 }));
});
test("malformed or unconstrained resource limits fail closed", () => {
  const graph = g([n("x", "VecInput")]);
  for (const budget of [-1, NaN, Infinity, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    errs("MODEL_INVALID_BUDGET", () => admit(graph, new Map([["VecInput", op([], V)]]), { maxBytes: budget }));
  }
  errs("MODEL_INVALID_BUDGET", () => admit(graph, new Map([["VecInput", op([], V)]]), { maxNodes: 0 }));
});
test("wrong ordering, cycles, ambiguous IDs and bad output rejected", () => {
  const safe = reg(); safe.delete("Impure");
  errs("MODEL_FORWARD_OR_CYCLIC_EDGE", () =>
    admit(g([n("a", "VecScale", "b"), n("b", "VecScale", "a")]), safe));
  errs("MODEL_DUPLICATE_NODE", () =>
    admit(g([n("x", "VecInput"), n("x", "VecInput")]), safe));
  errs("MODEL_DUPLICATE_OUTPUT", () =>
    admit(g([n("x", "VecInput")], ["x", "x"]), safe));
  errs("MODEL_UNKNOWN_OUTPUT", () =>
    admit(g([n("x", "VecInput")], ["x", "y"]), safe));
});
test("invalid input arity and forged dependency are rejected", () => {
  const safe = reg(); safe.delete("Impure");
  errs("MODEL_ARITY_MISMATCH", () => admit(g([n("x", "VecInput"), n("y", "VecScale")]), safe));
  errs("MODEL_FORWARD_OR_CYCLIC_EDGE", () =>
    admit(g([n("x", "VecInput"), n("y", "VecScale", "__proto__")]), safe));
});
test("deterministic repeated admission produces the same immutable summary", () => {
  const safe = reg(); safe.delete("Impure");
  const graph = g([n("x", "VecInput"), n("y", "VecScale", "x")]);
  const first = admit(graph, safe, grad(["y"], ["x"]));
  const second = admit(structuredClone(graph), new Map(safe), grad(["y"], ["x"]));
  assert.deepEqual(first, second);
  graph.nodes[1].op = "VecQuantize";
  assert.equal(first.gradientEdges, 1);
  errs("MODEL_MISSING_VJP", () => admit(graph, safe, grad(["y"], ["x"])));
});
test("bounded randomized DAG mutations detect non-differentiable gradients", () => {
  const safe = reg(); safe.delete("Impure");
  let seed = 0x1ab1c0de;
  const rnd = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let k = 0; k < 512; k++) {
    const count = 2 + rnd(14);
    const nodes = [n("x0", "VecInput")];
    let hasQuantize = false;
    for (let i = 1; i < count; i++) {
      const which = rnd(3);
      const opName = which === 0 ? "VecQuantize" : "VecScale";
      if (which === 0) hasQuantize = true;
      nodes.push(n("x" + i, opName, "x" + (i - 1)));
    }
    const graph = g(nodes), opts = grad(["x" + (count - 1)], ["x0"]);
    assert.doesNotThrow(() => admit(graph, safe));
    if (hasQuantize) errs("MODEL_MISSING_VJP", () => admit(graph, safe, opts));
    else assert.equal(admit(graph, safe, opts).gradientEdges, count - 1);
  }
});

test("accessors, symbol metadata and non-enumerable fields fail closed without getter execution", () => {
  let calls = 0;
  const graph = g([n("x", "VecInput")]);
  Object.defineProperty(graph.nodes[0], "op", { enumerable: true, get() { calls++; return "VecInput"; } });
  errs("MODEL_FORGED_OP_METADATA", () => admit(graph, reg()));
  assert.equal(calls, 0);
  const marked = g([n("x", "VecInput")]);
  marked.nodes[0][Symbol("untrusted")] = true;
  errs("MODEL_FORGED_OP_METADATA", () => admit(marked, reg()));
  const hidden = g([n("x", "VecInput")]);
  Object.defineProperty(hidden, "secret", { value: 1, enumerable: false });
  errs("MODEL_INVALID_GRAPH", () => admit(hidden, reg()));
});
test("sparse and accessor-backed dependency arrays fail closed", () => {
  const sparse = g([n("x", "VecInput")]);
  sparse.outputs = new Array(1);
  errs("MODEL_INVALID_GRAPH", () => admit(sparse, reg()));
  const graph = g([n("x", "VecInput"), n("y", "VecScale", "x")]);
  let calls = 0;
  Object.defineProperty(graph.nodes[1].inputs, "0", { enumerable: true, get() { calls++; return "x"; } });
  errs("MODEL_ARITY_MISMATCH", () => admit(graph, reg()));
  assert.equal(calls, 0);
});
