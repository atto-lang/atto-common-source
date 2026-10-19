// Source-free reference admission model for the PROPOSED general-purpose model contract.
// These are NOT parser, guest execution, numerical kernel or Java/LLVM runtime tests.
import test from "node:test";
import assert from "node:assert/strict";

const diag = (code) => { throw new Error(code); };
const equals = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function sizeOf(port) {
  if (!port || !["f64", "f32", "i32", "bool"].includes(port.dtype) || !Array.isArray(port.shape))
    diag("MODEL_INVALID_PORT");
  let bytes = BigInt({ f64: 8, f32: 4, i32: 4, bool: 1 }[port.dtype]);
  for (const d of port.shape) {
    if (!Number.isSafeInteger(d) || d < 0) diag("MODEL_INVALID_EXTENT");
    bytes *= BigInt(d);
    if (bytes > MAX) diag("MODEL_SIZE_OVERFLOW");
  }
  return bytes;
}

function admit(graph, { gradient = null, budgetBytes = 4096, maxNodes = 64 } = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) diag("MODEL_EMPTY_BODY");
  if (graph.nodes.length > maxNodes) diag("MODEL_NODE_BUDGET");
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) diag("MODEL_INVALID_BUDGET");
  const nodes = new Map();
  let total = 0n;
  for (const n of graph.nodes) {
    if (!n || typeof n.id !== "string" || !n.id || nodes.has(n.id)) diag("MODEL_DUPLICATE_NODE");
    if (n.effect !== "pure") diag("MODEL_EFFECTFUL_BODY");
    if (n.dynamic === true) diag("MODEL_DYNAMIC_TOPOLOGY");
    if (!Array.isArray(n.inputs)) diag("MODEL_INVALID_PORT");
    for (const edge of n.inputs) {
      if (!nodes.has(edge.from)) diag("MODEL_FORWARD_OR_CYCLIC_EDGE");
      const predecessor = nodes.get(edge.from);
      if (!equals(predecessor.output, edge.expected)) diag("MODEL_PORT_TYPE_MISMATCH");
    }
    total += sizeOf(n.output);
    if (total > BigInt(budgetBytes)) diag("MODEL_MEMORY_BUDGET");
    nodes.set(n.id, n);
  }
  if (!Array.isArray(graph.outputs) || !graph.outputs.length
      || graph.outputs.some(id => !nodes.has(id))) diag("MODEL_UNKNOWN_OUTPUT");
  if (gradient) {
    if (!Array.isArray(gradient.outputs) || !Array.isArray(gradient.targets)
        || !gradient.outputs.length || !gradient.targets.length) diag("MODEL_INVALID_GRADIENT_REQUEST");
    const targets = new Set(gradient.targets);
    if ([...targets, ...gradient.outputs].some(id => !nodes.has(id))) diag("MODEL_UNKNOWN_GRADIENT_ENDPOINT");
    // A node requires a VJP only if it lies on a live output-to-target path.
    // The target leaf itself requires no VJP: it terminates the requested derivative.
    const reaches = new Map();
    const hitsTarget = (id) => {
      if (reaches.has(id)) return reaches.get(id);
      if (targets.has(id)) { reaches.set(id, true); return true; }
      const yes = nodes.get(id).inputs.some(e => hitsTarget(e.from));
      reaches.set(id, yes);
      return yes;
    };
    for (const output of gradient.outputs) {
      if (!hitsTarget(output)) diag("MODEL_GRADIENT_DISCONNECTED");
      const visit = (id) => {
        if (targets.has(id) || !reaches.get(id)) return;
        const node = nodes.get(id);
        if (node.vjp !== true) diag("MODEL_MISSING_VJP");
        for (const e of node.inputs) if (reaches.get(e.from)) visit(e.from);
      };
      visit(output);
    }
  }
  return Object.freeze({ graphName: graph.name, nodeCount: nodes.size, provisionedBytes: Number(total), runner: "none" });
}

const vec = Object.freeze({ dtype: "f64", shape: [4] });
const scalar = Object.freeze({ dtype: "f64", shape: [] });
const input = (id, output = vec) => ({ id, effect: "pure", output, inputs: [] });
const unary = (id, from, { vjp = false, output = vec, expected = vec } = {}) =>
  ({ id, effect: "pure", output, inputs: [{ from, expected }], vjp });
const graph = (...nodes) => ({ name: "Example", nodes, outputs: [nodes.at(-1).id] });
const expects = (code, fn) => assert.throws(fn, e => e instanceof Error && e.message === code);

test("forward-only model accepts nondifferentiable op and requires neither actor nor autograd", () => {
  const result = admit(graph(input("x"), unary("quantize", "x")));
  assert.equal(result.runner, "none");
  assert.equal(result.provisionedBytes, 64);
});
test("VJP missing on a requested gradient path is rejected, but forward is still legal", () => {
  const g = graph(input("weight"), unary("quantize", "weight"));
  assert.doesNotThrow(() => admit(g));
  expects("MODEL_MISSING_VJP", () => admit(g, { gradient: { outputs: ["quantize"], targets: ["weight"] } }));
});
test("irrelevant nondifferentiable branch does not prohibit requested gradient", () => {
  const g = { name: "Branched", nodes: [
    input("w"), unary("train", "w", { vjp: true }),
    input("unused"), unary("notDifferentiable", "unused")
  ], outputs: ["train", "notDifferentiable"] };
  assert.doesNotThrow(() => admit(g, { gradient: { outputs: ["train"], targets: ["w"] } }));
});
test("gradient against disconnected input is denied", () => {
  const g = { name:"X", nodes: [input("x"), input("y"), unary("f", "x", { vjp: true })], outputs: ["f"] };
  expects("MODEL_GRADIENT_DISCONNECTED", () => admit(g, { gradient: { outputs: ["f"], targets: ["y"] } }));
});
test("no implicit dtype/shape change", () => {
  const g = graph(input("x"), unary("f", "x", { expected: scalar }));
  expects("MODEL_PORT_TYPE_MISMATCH", () => admit(g));
});
test("effectful node and dynamic topology fail closed", () => {
  const a = graph(input("x"), unary("f", "x")); a.nodes[1].effect = "io";
  expects("MODEL_EFFECTFUL_BODY", () => admit(a));
  const b = graph(input("x"), unary("f", "x")); b.nodes[1].dynamic = true;
  expects("MODEL_DYNAMIC_TOPOLOGY", () => admit(b));
});
test("cyclic/forward dependency and duplicate identity rejected", () => {
  expects("MODEL_FORWARD_OR_CYCLIC_EDGE", () =>
    admit(graph(unary("a", "b"), unary("b", "a"))));
  expects("MODEL_DUPLICATE_NODE", () =>
    admit(graph(input("x"), input("x"))));
});
test("extents, checked integer overflow, memory and node budgets", () => {
  expects("MODEL_INVALID_EXTENT", () => admit(graph(input("x", { dtype: "f64", shape: [-1] }))));
  expects("MODEL_SIZE_OVERFLOW", () => admit(graph(input("x", { dtype: "f64", shape: [2 ** 48] }))));
  expects("MODEL_MEMORY_BUDGET", () => admit(graph(input("x"), unary("f", "x")), { budgetBytes: 63 }));
  expects("MODEL_NODE_BUDGET", () => admit(graph(input("x"), unary("f", "x")), { maxNodes: 1 }));
});
test("zero-length buffers and input-only model are legal", () => {
  const r = admit(graph(input("empty", { dtype: "i32", shape: [0, 100] })));
  assert.equal(r.provisionedBytes, 0);
});
test("unknown output and empty graph are not admitted", () => {
  expects("MODEL_EMPTY_BODY", () => admit({ nodes: [], outputs: [] }));
  expects("MODEL_UNKNOWN_OUTPUT", () => admit({ nodes: [input("x")], outputs: ["absent"] }));
});
test("host model has no mutable instance state or scheduling by default", () => {
  const frozenBlueprint = Object.freeze(graph(input("x"), unary("f", "x")));
  const spec = admit(frozenBlueprint);
  assert.equal(spec.runner, "none");
  assert(!("optimizer" in spec));
  assert(!("actors" in spec));
  assert(!("gpu" in spec));
});
