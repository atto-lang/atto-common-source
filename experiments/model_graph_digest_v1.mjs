import { modelBufferLayoutOrdinal } from "./model_buffer_layout_v1.mjs";
import { createHash } from "node:crypto";
import { modelSymbolKindOrdinal } from "./model_symbol_constant_v1.mjs";

export class ModelDigestError extends Error {
  constructor(code) { super(code); this.name = "ModelDigestError"; this.code = code; }
}
const fail = code => { throw new ModelDigestError(code); };
const EFFECT = ["pure","io","network","random","clock","actor","ffi","suspend"];
const PROVENANCE = ["verified-ores","trusted-native"];
const ALLOCATION = ["none","scratch","dynamic"];
const DTYPE = ["bool","i32","i64","f32","f64"];
const CONST_KIND = ["bool","i64","f64bits","string","symbol"];
const MAX_U32 = 0xffff_ffff;
const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

const plain = x => x !== null && typeof x === "object" && !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
const denseArray = x => Array.isArray(x) &&
  Object.keys(x).length === x.length &&
  Object.keys(x).every((k, i) => k === String(i)) &&
  Reflect.ownKeys(x).every(k => k === "length" ||
    (typeof k === "string" && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < x.length)) &&
  Object.keys(x).every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), "value"));
const exact = (x, fields, code) => {
  if (!plain(x)) fail(code);
  const keys = Reflect.ownKeys(x);
  if (keys.some(k => typeof k !== "string" || !fields.includes(k))) fail(code);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail(code);
  }
};
function wellFormedString(x, code) {
  if (typeof x !== "string") fail(code);
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (++i >= x.length) fail(code);
      const d = x.charCodeAt(i);
      if (d < 0xdc00 || d > 0xdfff) fail(code);
    } else if (c >= 0xdc00 && c <= 0xdfff) fail(code);
  }
  return x;
}
const enumOrdinal = (x, values, code) => {
  const n = values.indexOf(x);
  if (n < 0) fail(code);
  return n;
};
const safeCount = (x, code) => {
  if (!Number.isSafeInteger(x) || x < 0 || x > MAX_U32) fail(code);
  return x;
};
const u64Value = (x, code) => {
  let n;
  if (typeof x === "bigint") n = x;
  else if (Number.isSafeInteger(x) && x >= 0) n = BigInt(x);
  else fail(code);
  if (n < 0n || n > MAX_U64) fail(code);
  return n;
};

class Bytes {
  constructor() { this.parts = []; }
  raw(b) { this.parts.push(Buffer.from(b)); }
  u8(n) {
    if (!Number.isInteger(n) || n < 0 || n > 255) fail("MODEL_DIGEST_ENCODING");
    this.parts.push(Buffer.from([n]));
  }
  u32(n) {
    safeCount(n, "MODEL_DIGEST_ENCODING");
    const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n); this.parts.push(b);
  }
  u64(n) {
    const b = Buffer.allocUnsafe(8);
    b.writeBigUInt64BE(u64Value(n, "MODEL_DIGEST_ENCODING"));
    this.parts.push(b);
  }
  i64(n) {
    const b = Buffer.allocUnsafe(8);
    b.writeBigInt64BE(n);
    this.parts.push(b);
  }
  string(x) {
    wellFormedString(x, "MODEL_DIGEST_STRING");
    const b = Buffer.from(x, "utf8");
    this.u32(b.length); this.raw(b);
  }
  digest(x) {
    if (typeof x !== "string" || !/^[0-9a-f]{64}$/.test(x))
      fail("MODEL_INVALID_IMPLEMENTATION_DIGEST");
    this.raw(Buffer.from(x, "hex"));
  }
  finish() { return Buffer.concat(this.parts); }
}

function encodeConstant(out, c) {
  exact(c, ["kind","value"], "MODEL_INVALID_CONST");
  const tag = enumOrdinal(c.kind, CONST_KIND, "MODEL_INVALID_CONST");
  out.u8(tag);
  if (c.kind === "bool") {
    if (typeof c.value !== "boolean") fail("MODEL_INVALID_CONST");
    out.u8(c.value ? 1 : 0);
  } else if (c.kind === "i64") {
    if (typeof c.value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(c.value))
      fail("MODEL_INVALID_CONST");
    const n = BigInt(c.value);
    if (n < MIN_I64 || n > MAX_I64) fail("MODEL_CONST_OVERFLOW");
    out.i64(n);
  } else if (c.kind === "f64bits") {
    if (typeof c.value !== "string" || !/^0x[0-9a-f]{16}$/.test(c.value))
      fail("MODEL_INVALID_CONST");
    const bits = BigInt(c.value);
    const exponent = (bits >> 52n) & 0x7ffn;
    if (exponent === 0x7ffn) fail("MODEL_NONFINITE_CONST");
    out.raw(Buffer.from(c.value.slice(2), "hex"));
  } else if (c.kind === "symbol") {
    const symbolKind = modelSymbolKindOrdinal(c.value);
    if (symbolKind === null) fail("MODEL_INVALID_CONST");
    out.u8(symbolKind);
    out.string(c.value.name);
  } else {
    out.string(c.value);
  }
}

function encodePort(out, p) {
  if (!plain(p)) fail("MODEL_INVALID_PORT");
  if (p.kind === "nominal") {
    exact(p, ["kind","typeAbi","bytes"], "MODEL_INVALID_PORT");
    if (u64Value(p.bytes, "MODEL_INVALID_PORT") > MAX_I64)
      fail("MODEL_SIZE_OVERFLOW");
    out.u8(1);
    out.string(p.typeAbi);
    out.u64(p.bytes);
    return;
  }
  exact(p, ["dtype","shape","layout","unit"], "MODEL_INVALID_PORT");
  if (!denseArray(p.shape) || p.shape.length > 8) fail("MODEL_INVALID_PORT");
  const elementBytes = [1n, 4n, 8n, 4n, 8n][enumOrdinal(p.dtype, DTYPE, "MODEL_INVALID_PORT")];
  const extents = p.shape.map(d => u64Value(d, "MODEL_INVALID_PORT"));
  if (extents.some(d => d > MAX_I64)) fail("MODEL_SIZE_OVERFLOW");
  if (!extents.includes(0n)) {
    let bytes = elementBytes;
    for (const d of extents) {
      if (d !== 0n && bytes > MAX_I64 / d) fail("MODEL_SIZE_OVERFLOW");
      bytes *= d;
    }
  }
  if (p.unit !== undefined && (typeof p.unit !== "string" ||
      p.unit.length > 40 || !/^[A-Za-z0-9_\/^-]*$/.test(p.unit)))
    fail("MODEL_INVALID_PORT");
  out.u8(0);
  out.u8(enumOrdinal(p.dtype, DTYPE, "MODEL_INVALID_PORT"));
  out.u8(p.shape.length);
  for (const d of extents) out.u64(d);
  const layout = modelBufferLayoutOrdinal(p.layout, p.shape.length);
  if (layout < 0) fail("MODEL_INVALID_PORT");
  out.u8(layout);
  if (p.unit === undefined) out.u8(0);
  else { out.u8(1); out.string(p.unit); }
}

// Model ports are exact compiler-owned contracts, not structurally
// convertible values. Compare canonical default layout and encoded extents,
// not the host-language identity of a port metadata object.
function samePort(a, b) {
  if (!plain(a) || !plain(b)) return false;
  if (a.kind === "nominal" || b.kind === "nominal") {
    return a.kind === "nominal" && b.kind === "nominal" &&
      a.typeAbi === b.typeAbi &&
      u64Value(a.bytes, "MODEL_INVALID_PORT") === u64Value(b.bytes, "MODEL_INVALID_PORT");
  }
  if (a.dtype !== b.dtype || !denseArray(a.shape) || !denseArray(b.shape) ||
      a.shape.length !== b.shape.length) return false;
  if (modelBufferLayoutOrdinal(a.layout, a.shape.length) !==
      modelBufferLayoutOrdinal(b.layout, b.shape.length)) return false;
  if (a.unit !== b.unit) return false;
  for (let i = 0; i < a.shape.length; i++) {
    if (u64Value(a.shape[i], "MODEL_INVALID_PORT") !==
        u64Value(b.shape[i], "MODEL_INVALID_PORT")) return false;
  }
  return true;
}

export function canonicalModelGraphV1Bytes(graph) {
  exact(graph, ["version","modelTypeId","nodes","outputs"], "MODEL_INVALID_RESOLVED_GRAPH");
  if (graph.version !== 1 || !denseArray(graph.nodes) || graph.nodes.length === 0 ||
      !denseArray(graph.outputs) || graph.outputs.length === 0)
    fail("MODEL_INVALID_RESOLVED_GRAPH");
  if (graph.nodes.length > 65536 || graph.outputs.length > 65536)
    fail("MODEL_GRAPH_BUDGET");

  const out = new Bytes();
  out.raw(Buffer.from("ORESLANG-MODEL-GRAPH-V1\0", "ascii"));
  out.u32(1);
  out.string(graph.modelTypeId);

  const ordinals = new Map();
  graph.nodes.forEach((n, index) => {
    if (!plain(n) || typeof n.id !== "string" || ordinals.has(n.id))
      fail("MODEL_DUPLICATE_NODE");
    ordinals.set(n.id, index);
  });

  out.u32(graph.nodes.length);
  graph.nodes.forEach((n, index) => {
    exact(n, ["id","op","inputs","constArgs","signature"], "MODEL_INVALID_RESOLVED_NODE");
    if (!denseArray(n.inputs) || !denseArray(n.constArgs))
      fail("MODEL_INVALID_RESOLVED_NODE");
    const sig = n.signature;
    exact(sig, ["inputs","output","effect","vjp","scratchBytes","abi","implDigest",
                "provenance","constKinds","profile"], "MODEL_INVALID_OP_SIGNATURE");
    if (!denseArray(sig.inputs) || !denseArray(sig.constKinds) ||
        typeof sig.vjp !== "boolean") fail("MODEL_INVALID_OP_SIGNATURE");
    exact(sig.profile, ["freestanding","allocation","deterministic"], "MODEL_INVALID_OP_PROFILE");
    if (typeof sig.profile.freestanding !== "boolean" ||
        typeof sig.profile.deterministic !== "boolean")
      fail("MODEL_INVALID_OP_PROFILE");

    out.string(n.op);
    out.string(sig.abi);
    out.digest(sig.implDigest);
    out.u8(enumOrdinal(sig.provenance, PROVENANCE, "MODEL_INVALID_OP_SIGNATURE"));
    out.u8(enumOrdinal(sig.effect, EFFECT, "MODEL_INVALID_OP_SIGNATURE"));
    out.u8(sig.vjp ? 1 : 0);

    out.u32(sig.constKinds.length);
    for (const k of sig.constKinds)
      out.u8(enumOrdinal(k, CONST_KIND, "MODEL_INVALID_OP_SIGNATURE"));

    if (n.constArgs.length !== sig.constKinds.length)
      fail("MODEL_CONST_ARITY_MISMATCH");
    out.u32(n.constArgs.length);
    for (let i = 0; i < n.constArgs.length; i++) {
      if (n.constArgs[i].kind !== sig.constKinds[i])
        fail("MODEL_CONST_TYPE_MISMATCH");
      encodeConstant(out, n.constArgs[i]);
    }

    // Ordered v1: the first node may consume one external run(input).
    // No other unmatched ports are permitted; later nodes must name all parents.
    const externalUnary = index === 0 && n.inputs.length === 0 && sig.inputs.length === 1;
    if (!externalUnary && n.inputs.length !== sig.inputs.length)
      fail("MODEL_PORT_ARITY_MISMATCH");
    out.u32(n.inputs.length);
    for (let edge = 0; edge < n.inputs.length; edge++) {
      const id = n.inputs[edge];
      if (!ordinals.has(id) || ordinals.get(id) >= index)
        fail("MODEL_FORWARD_OR_CYCLIC_EDGE");
      const upstream = graph.nodes[ordinals.get(id)].signature.output;
      if (!samePort(upstream, sig.inputs[edge]))
        fail("MODEL_PORT_TYPE_MISMATCH");
      out.u32(ordinals.get(id));
    }

    out.u32(sig.inputs.length);
    for (const p of sig.inputs) encodePort(out, p);
    encodePort(out, sig.output);
    out.u64(sig.scratchBytes);
    out.u8(sig.profile.freestanding ? 1 : 0);
    out.u8(enumOrdinal(sig.profile.allocation, ALLOCATION, "MODEL_INVALID_OP_PROFILE"));
    out.u8(sig.profile.deterministic ? 1 : 0);
  });

  const seenOutputs = new Set();
  out.u32(graph.outputs.length);
  for (const id of graph.outputs) {
    if (!ordinals.has(id)) fail("MODEL_UNKNOWN_OUTPUT");
    if (seenOutputs.has(id)) fail("MODEL_DUPLICATE_OUTPUT");
    seenOutputs.add(id);
    out.u32(ordinals.get(id));
  }
  return out.finish();
}

export function digestModelGraphV1(graph) {
  return createHash("sha256").update(canonicalModelGraphV1Bytes(graph)).digest("hex");
}
