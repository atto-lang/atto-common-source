// Source-free admission oracle for a proposed compiler-owned typed ModelGraph HIR.
// NOT a guest Oreslang compiler, runtime, verified op registry or executable tensor backend.
// Registry belongs to the compiler/library linker, never to guest graph input.
export class ModelAdmissionError extends Error {
  constructor(code) { super(code); this.name = "ModelAdmissionError"; this.code = code; }
}
const fail = code => { throw new ModelAdmissionError(code); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BYTES = new Map([["bool", 1n], ["i32", 4n], ["i64", 8n], ["f32", 4n], ["f64", 8n]]);
const record = x => x !== null && typeof x === "object" && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const exactFields = (x, fields, code) => {
  if (!record(x) || Object.keys(x).some(k => !fields.includes(k))) fail(code);
};
const boundInt = (x, code) => {
  if (!Number.isSafeInteger(x) || x < 0) fail(code);
  return BigInt(x);
};
const positiveInt = (x, code) => {
  const n = boundInt(x, code);
  if (n === 0n) fail(code);
  return n;
};
function port(p) {
  exactFields(p, ["dtype", "shape", "layout", "unit"], "MODEL_INVALID_PORT");
  if (!BYTES.has(p.dtype) || !Array.isArray(p.shape) || p.shape.length > 8)
    fail("MODEL_INVALID_PORT");
  if (p.layout !== undefined && !["contiguous", "scalar"].includes(p.layout))
    fail("MODEL_INVALID_PORT");
  if (p.unit !== undefined && (typeof p.unit !== "string" || !/^[a-zA-Z0-9_/^-]{1,40}$/.test(p.unit)))
    fail("MODEL_INVALID_PORT");
  // Validate ALL dimensions before multiplication; any zero extent has zero bytes.
  for (const d of p.shape) boundInt(d, "MODEL_INVALID_EXTENT");
  const hasZero = p.shape.includes(0);
  let count = 1n;
  if (hasZero) count = 0n;
  else for (const d of p.shape) {
    count *= BigInt(d);
    if (count > MAX_SAFE) fail("MODEL_SIZE_OVERFLOW");
  }
  const bytes = count * BYTES.get(p.dtype);
  if (bytes > MAX_SAFE) fail("MODEL_SIZE_OVERFLOW");
  if (p.shape.length === 0 && p.layout === "contiguous") fail("MODEL_INVALID_PORT");
  if (p.shape.length > 0 && p.layout === "scalar") fail("MODEL_INVALID_PORT");
  return bytes;
}
function samePort(a, b) {
  return a.dtype === b.dtype && (a.layout ?? "") === (b.layout ?? "") &&
    (a.unit ?? "") === (b.unit ?? "") &&
    a.shape.length === b.shape.length && a.shape.every((n, i) => n === b.shape[i]);
}
function prepareRegistry(registry) {
  if (!(registry instanceof Map)) fail("MODEL_UNTRUSTED_OP_REGISTRY");
  const prepared = new Map();
  for (const [key, sig] of registry) {
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key))
      fail("MODEL_INVALID_OP_ID");
    exactFields(sig, ["inputs", "output", "effect", "vjp", "scratchBytes", "abi"], "MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.effect !== "string" || !["pure", "io", "network", "random", "clock", "actor", "ffi", "suspend"].includes(sig.effect))
      fail("MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.vjp !== "boolean" || !Array.isArray(sig.inputs) || sig.inputs.length > 16)
      fail("MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.abi !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(sig.abi))
      fail("MODEL_INVALID_OP_SIGNATURE");
    const inputs = sig.inputs.map(x => { port(x); return x; });
    const outputBytes = port(sig.output);
    const scratchBytes = boundInt(sig.scratchBytes, "MODEL_INVALID_SCRATCH");
    prepared.set(key, { inputs, output: sig.output, outputBytes, scratchBytes, vjp: sig.vjp, effect: sig.effect });
  }
  return prepared;
}
export function admitModelGraph(graph, registry, options = {}) {
  exactFields(graph, ["name", "nodes", "outputs"], "MODEL_INVALID_GRAPH");
  if (typeof graph.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(graph.name)
      || !Array.isArray(graph.nodes) || graph.nodes.length === 0
      || !Array.isArray(graph.outputs) || graph.outputs.length === 0)
    fail("MODEL_INVALID_GRAPH");
  exactFields(options, ["maxNodes", "maxEdges", "maxDepth", "maxBytes", "gradient"], "MODEL_INVALID_OPTIONS");
  const maxNodes = positiveInt(options.maxNodes ?? 64, "MODEL_INVALID_BUDGET");
  const maxEdges = boundInt(options.maxEdges ?? 256, "MODEL_INVALID_BUDGET");
  const maxDepth = positiveInt(options.maxDepth ?? 64, "MODEL_INVALID_BUDGET");
  const maxBytes = boundInt(options.maxBytes ?? 65536, "MODEL_INVALID_BUDGET");
  if (BigInt(graph.nodes.length) > maxNodes) fail("MODEL_NODE_BUDGET");
  const signatures = prepareRegistry(registry);
  const found = new Map();
  const normalized = [];
  let edges = 0n, bytes = 0n;
  for (const n of graph.nodes) {
    exactFields(n, ["id", "op", "inputs"], "MODEL_FORGED_OP_METADATA");
    if (typeof n.id !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(n.id) || found.has(n.id))
      fail("MODEL_DUPLICATE_NODE");
    if (typeof n.op !== "string" || !signatures.has(n.op)) fail("MODEL_UNKNOWN_OP");
    if (!Array.isArray(n.inputs) || n.inputs.length !== signatures.get(n.op).inputs.length)
      fail("MODEL_ARITY_MISMATCH");
    const sig = signatures.get(n.op);
    if (sig.effect !== "pure") fail("MODEL_EFFECTFUL_OP");
    const parents = [];
    let depth = 1n;
    for (let i = 0; i < n.inputs.length; i++) {
      const parentId = n.inputs[i];
      if (typeof parentId !== "string" || !found.has(parentId))
        fail("MODEL_FORWARD_OR_CYCLIC_EDGE");
      const parent = found.get(parentId);
      if (!samePort(parent.sig.output, sig.inputs[i])) fail("MODEL_PORT_TYPE_MISMATCH");
      parents.push(parentId);
      depth = parent.depth + 1n > depth ? parent.depth + 1n : depth;
    }
    if (depth > maxDepth) fail("MODEL_DEPTH_BUDGET");
    edges += BigInt(parents.length);
    if (edges > maxEdges) fail("MODEL_EDGE_BUDGET");
    bytes += sig.outputBytes + sig.scratchBytes;
    if (bytes > maxBytes || bytes > MAX_SAFE) fail("MODEL_MEMORY_BUDGET");
    const entry = { id: n.id, op: n.op, parents, depth, sig };
    found.set(n.id, entry);
    normalized.push(entry);
  }
  const outputs = new Set();
  for (const id of graph.outputs) {
    if (typeof id !== "string" || !found.has(id)) fail("MODEL_UNKNOWN_OUTPUT");
    if (outputs.has(id)) fail("MODEL_DUPLICATE_OUTPUT");
    outputs.add(id);
  }
  let gradientEdges = 0n;
  if (options.gradient !== undefined) {
    exactFields(options.gradient, ["outputs", "targets"], "MODEL_INVALID_GRADIENT_REQUEST");
    const { outputs: derivativeOutputs, targets: derivativeTargets } = options.gradient;
    if (!Array.isArray(derivativeOutputs) || !derivativeOutputs.length ||
        !Array.isArray(derivativeTargets) || !derivativeTargets.length)
      fail("MODEL_INVALID_GRADIENT_REQUEST");
    const wants = new Set(derivativeTargets), outs = new Set(derivativeOutputs);
    if (wants.size !== derivativeTargets.length || outs.size !== derivativeOutputs.length)
      fail("MODEL_DUPLICATE_GRADIENT_ENDPOINT");
    if ([...wants, ...outs].some(id => typeof id !== "string" || !found.has(id)))
      fail("MODEL_UNKNOWN_GRADIENT_ENDPOINT");
    if ([...outs].some(id => !outputs.has(id))) fail("MODEL_UNKNOWN_GRADIENT_OUTPUT");
    // Topological forward pass computes which selected targets influence each node.
    // A per-node bitset avoids the erroneous short-circuiting of fan-in paths.
    const reaches = new Map();
    for (const n of normalized) {
      const set = new Set(wants.has(n.id) ? [n.id] : []);
      for (const parent of n.parents) for (const target of reaches.get(parent)) set.add(target);
      reaches.set(n.id, set);
    }
    const reachedTargets = new Set();
    for (const id of outs) {
      if (reaches.get(id).size === 0) fail("MODEL_GRADIENT_DISCONNECTED");
      for (const target of reaches.get(id)) reachedTargets.add(target);
    }
    if ([...wants].some(id => !reachedTargets.has(id))) fail("MODEL_GRADIENT_DISCONNECTED");
    // Reverse traverse all relevant edges. A VJP is required for every traversed
    // operation; a selected target is an explicit stop-grad boundary.
    const stack = [...outs], visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = found.get(id);
      const relevant = n.parents.filter(p => reaches.get(p).size !== 0);
      // If this target has target ancestors, gradient propagation must continue
      // for those other requested derivatives. Stop only for a leaf target.
      if (wants.has(id) && relevant.length === 0) continue;
      if (relevant.length && !n.sig.vjp) fail("MODEL_MISSING_VJP");
      gradientEdges += BigInt(relevant.length);
      for (const parent of relevant) stack.push(parent);
    }
  }
  // No user-controlled execution, code loading or closures returned.
  return Object.freeze({
    graphName: graph.name,
    nodes: normalized.length,
    edges: Number(edges),
    maxPathDepth: Number(normalized.reduce((n, x) => x.depth > n ? x.depth : n, 0n)),
    upperBoundBytes: Number(bytes),
    gradientEdges: Number(gradientEdges),
    executedGuest: false,
    executable: false
  });
}
