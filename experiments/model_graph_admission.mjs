// Source-free admission oracle for a proposed compiler-owned typed ModelGraph HIR.
// NOT a guest Oreslang compiler, runtime, verified op registry or executable tensor backend.
// Registry belongs to the compiler/library linker, never to guest graph input.
export class ModelAdmissionError extends Error {
  constructor(code) { super(code); this.name = "ModelAdmissionError"; this.code = code; }
}
const fail = code => { throw new ModelAdmissionError(code); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const BYTES = new Map([["bool", 1n], ["i32", 4n], ["i64", 8n], ["f32", 4n], ["f64", 8n]]);
const EFFECTS = new Set(["pure", "io", "network", "random", "clock", "actor", "ffi", "suspend"]);
const CONST_KINDS = new Set(["bool", "i64", "f64bits", "string", "symbol"]);
const ALLOCATION_CLASSES = new Set(["none", "scratch", "dynamic"]);

const record = x => x !== null && typeof x === "object" && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);

const exactFields = (x, fields, code) => {
  if (!record(x)) fail(code);
  // Reject accessors and non-enumerable/symbol metadata before reading any fields.
  // A hostile getter must never be invoked as part of graph admission.
  const keys = Reflect.ownKeys(x);
  if (keys.some(k => typeof k !== "string" || !fields.includes(k))) fail(code);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail(code);
  }
};

const denseArray = x => Array.isArray(x) &&
  Object.keys(x).length === x.length &&
  Object.keys(x).every((k, i) => k === String(i)) &&
  Reflect.ownKeys(x).every(k => k === "length" ||
    (typeof k === "string" && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < x.length)) &&
  Object.keys(x).every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), "value"));

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
  exactFields(p, ["kind", "typeAbi", "bytes", "dtype", "shape", "layout", "unit"], "MODEL_INVALID_PORT");

  // General-purpose nominal scalar/record/domain values. typeAbi is compiler/linker
  // owned and bytes is a conservative fixed storage upper bound for admission.
  if (p.kind === "nominal") {
    exactFields(p, ["kind", "typeAbi", "bytes"], "MODEL_INVALID_PORT");
    if (typeof p.typeAbi !== "string" || !/^[A-Za-z][A-Za-z0-9_.:@-]{0,127}$/.test(p.typeAbi))
      fail("MODEL_INVALID_PORT");
    return boundInt(p.bytes, "MODEL_INVALID_PORT");
  }

  // Dense fixed-shape numeric/bool buffer port. This intentionally does not try to
  // describe arbitrary strided tensors or dynamic dimensions in the v1 host oracle.
  if (p.kind !== undefined) fail("MODEL_INVALID_PORT");
  exactFields(p, ["dtype", "shape", "layout", "unit"], "MODEL_INVALID_PORT");
  if (!BYTES.has(p.dtype) || !denseArray(p.shape) || p.shape.length > 8)
    fail("MODEL_INVALID_PORT");
  if (p.layout !== undefined && !["contiguous", "scalar"].includes(p.layout))
    fail("MODEL_INVALID_PORT");
  if (p.unit !== undefined &&
      (typeof p.unit !== "string" || !/^[a-zA-Z0-9_/^-]{1,40}$/.test(p.unit)))
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
  if (a.kind === "nominal" || b.kind === "nominal") {
    return a.kind === "nominal" && b.kind === "nominal" &&
      a.typeAbi === b.typeAbi && a.bytes === b.bytes;
  }
  return a.dtype === b.dtype && (a.layout ?? "") === (b.layout ?? "") &&
    (a.unit ?? "") === (b.unit ?? "") &&
    a.shape.length === b.shape.length && a.shape.every((n, i) => n === b.shape[i]);
}

function validateConstant(c, expectedKind) {
  exactFields(c, ["kind", "value"], "MODEL_INVALID_CONST");
  if (!CONST_KINDS.has(c.kind)) fail("MODEL_INVALID_CONST");
  if (c.kind !== expectedKind) fail("MODEL_CONST_TYPE_MISMATCH");

  switch (c.kind) {
    case "bool":
      if (typeof c.value !== "boolean") fail("MODEL_INVALID_CONST");
      return;
    case "i64": {
      if (typeof c.value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(c.value) || c.value === "-0")
        fail("MODEL_INVALID_CONST");
      const n = BigInt(c.value);
      if (n < I64_MIN || n > I64_MAX) fail("MODEL_CONST_OVERFLOW");
      return;
    }
    case "f64bits": {
      // Canonical lowercase IEEE-754 bits avoid locale/text-rounding drift in HIR.
      if (typeof c.value !== "string" || !/^0x[0-9a-f]{16}$/.test(c.value))
        fail("MODEL_INVALID_CONST");
      const bits = BigInt(c.value);
      const exponent = (bits >> 52n) & 0x7ffn;
      if (exponent === 0x7ffn) fail("MODEL_NONFINITE_CONST");
      return;
    }
    case "string":
      if (typeof c.value !== "string" || c.value.length > 256 || c.value.includes("\u0000"))
        fail("MODEL_INVALID_CONST");
      return;
    case "symbol":
      if (typeof c.value !== "string" || !/^#[A-Za-z][A-Za-z0-9_]{0,63}$/.test(c.value))
        fail("MODEL_INVALID_CONST");
      return;
    default:
      fail("MODEL_INVALID_CONST");
  }
}

function prepareRegistry(registry) {
  if (!(registry instanceof Map) || Object.getPrototypeOf(registry) !== Map.prototype) fail("MODEL_UNTRUSTED_OP_REGISTRY");
  const prepared = new Map();

  for (const [key, sig] of registry) {
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key))
      fail("MODEL_INVALID_OP_ID");

    exactFields(sig,
      ["inputs", "output", "effect", "vjp", "scratchBytes", "abi", "constKinds", "profile"],
      "MODEL_INVALID_OP_SIGNATURE");

    if (typeof sig.effect !== "string" || !EFFECTS.has(sig.effect))
      fail("MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.vjp !== "boolean" || !denseArray(sig.inputs) || sig.inputs.length > 16)
      fail("MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.abi !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(sig.abi) ||
        typeof sig.implDigest !== "string" || !/^[0-9a-f]{64}$/.test(sig.implDigest) ||
        !["verified-ores", "trusted-native"].includes(sig.provenance))
      fail("MODEL_INVALID_OP_SIGNATURE");
    if (!denseArray(sig.constKinds) || sig.constKinds.length > 32 ||
        sig.constKinds.some(k => typeof k !== "string" || !CONST_KINDS.has(k)))
      fail("MODEL_INVALID_OP_SIGNATURE");

    exactFields(sig.profile, ["freestanding", "allocation", "deterministic"],
      "MODEL_INVALID_OP_SIGNATURE");
    if (typeof sig.profile.freestanding !== "boolean" ||
        typeof sig.profile.deterministic !== "boolean" ||
        typeof sig.profile.allocation !== "string" ||
        !ALLOCATION_CLASSES.has(sig.profile.allocation))
      fail("MODEL_INVALID_OP_SIGNATURE");

    const inputs = sig.inputs.map(x => { port(x); return x; });
    const outputBytes = port(sig.output);
    const scratchBytes = boundInt(sig.scratchBytes, "MODEL_INVALID_SCRATCH");

    prepared.set(key, {
      inputs,
      output: sig.output,
      outputBytes,
      scratchBytes,
      vjp: sig.vjp,
      effect: sig.effect,
      abi: sig.abi,
      constKinds: sig.constKinds,
      profile: sig.profile
    });
  }

  return prepared;
}

export function admitModelGraph(graph, registry, options = {}) {
  exactFields(graph, ["name", "nodes", "outputs"], "MODEL_INVALID_GRAPH");
  if (typeof graph.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(graph.name) ||
      !denseArray(graph.nodes) || graph.nodes.length === 0 ||
      !denseArray(graph.outputs) || graph.outputs.length === 0)
    fail("MODEL_INVALID_GRAPH");

  exactFields(options, [
    "maxNodes", "maxEdges", "maxDepth", "maxBytes", "gradient",
    "requireFreestanding", "forbidDynamicAllocation", "requireDeterministic"
  ], "MODEL_INVALID_OPTIONS");

  for (const flag of ["requireFreestanding", "forbidDynamicAllocation", "requireDeterministic"]) {
    if (options[flag] !== undefined && typeof options[flag] !== "boolean")
      fail("MODEL_INVALID_OPTIONS");
  }

  const maxNodes = positiveInt(options.maxNodes ?? 64, "MODEL_INVALID_BUDGET");
  const maxEdges = boundInt(options.maxEdges ?? 256, "MODEL_INVALID_BUDGET");
  const maxDepth = positiveInt(options.maxDepth ?? 64, "MODEL_INVALID_BUDGET");
  const maxBytes = boundInt(options.maxBytes ?? 65536, "MODEL_INVALID_BUDGET");
  if (BigInt(graph.nodes.length) > maxNodes) fail("MODEL_NODE_BUDGET");

  const signatures = prepareRegistry(registry);
  const found = new Map();
  const normalized = [];
  let edges = 0n;
  let bytes = 0n;
  let staticArgs = 0n;
  let freestandingEligible = true;
  let noDynamicAllocation = true;
  let deterministic = true;

  for (const n of graph.nodes) {
    exactFields(n, ["id", "op", "inputs", "constArgs"], "MODEL_FORGED_OP_METADATA");
    if (typeof n.id !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(n.id) || found.has(n.id))
      fail("MODEL_DUPLICATE_NODE");
    if (typeof n.op !== "string" || !signatures.has(n.op)) fail("MODEL_UNKNOWN_OP");

    const sig = signatures.get(n.op);
    if (!denseArray(n.inputs) || n.inputs.length !== sig.inputs.length)
      fail("MODEL_ARITY_MISMATCH");

    const constArgs = n.constArgs ?? [];
    if (!denseArray(constArgs) || constArgs.length !== sig.constKinds.length)
      fail("MODEL_CONST_ARITY_MISMATCH");
    for (let i = 0; i < constArgs.length; i++) validateConstant(constArgs[i], sig.constKinds[i]);
    staticArgs += BigInt(constArgs.length);

    if (sig.effect !== "pure") fail("MODEL_EFFECTFUL_OP");
    if (options.requireFreestanding && !sig.profile.freestanding)
      fail("MODEL_PROFILE_UNSUPPORTED");
    if (options.forbidDynamicAllocation && sig.profile.allocation === "dynamic")
      fail("MODEL_DYNAMIC_ALLOCATION");
    if (options.requireDeterministic && !sig.profile.deterministic)
      fail("MODEL_NONDETERMINISTIC_OP");

    freestandingEligible &&= sig.profile.freestanding;
    noDynamicAllocation &&= sig.profile.allocation !== "dynamic";
    deterministic &&= sig.profile.deterministic;

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
    if (!denseArray(derivativeOutputs) || !derivativeOutputs.length ||
        !denseArray(derivativeTargets) || !derivativeTargets.length)
      fail("MODEL_INVALID_GRADIENT_REQUEST");

    const wants = new Set(derivativeTargets);
    const outs = new Set(derivativeOutputs);
    if (wants.size !== derivativeTargets.length || outs.size !== derivativeOutputs.length)
      fail("MODEL_DUPLICATE_GRADIENT_ENDPOINT");
    if ([...wants, ...outs].some(id => typeof id !== "string" || !found.has(id)))
      fail("MODEL_UNKNOWN_GRADIENT_ENDPOINT");
    if ([...outs].some(id => !outputs.has(id))) fail("MODEL_UNKNOWN_GRADIENT_OUTPUT");

    // Topological forward pass computes which selected targets influence each node.
    // A per-node set avoids the erroneous short-circuiting of fan-in paths.
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
    const stack = [...outs];
    const visited = new Set();
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

  // No user-controlled execution, code loading or closures returned. In
  // particular, "hard real time" is intentionally NOT a derived boolean here:
  // it requires target-specific WCET/scheduler/platform evidence.
  return Object.freeze({
    graphName: graph.name,
    nodes: normalized.length,
    edges: Number(edges),
    staticArgs: Number(staticArgs),
    maxPathDepth: Number(normalized.reduce((n, x) => x.depth > n ? x.depth : n, 0n)),
    upperBoundBytes: Number(bytes),
    gradientEdges: Number(gradientEdges),
    capabilities: Object.freeze({
      freestandingEligible,
      noDynamicAllocation,
      deterministic
    }),
    executedGuest: false,
    executable: false
  });
}
