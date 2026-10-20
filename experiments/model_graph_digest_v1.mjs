import { createHash } from "node:crypto";

export class ModelDigestError extends Error {
  constructor(code) { super(code); this.name = "ModelDigestError"; this.code = code; }
}
const fail = code => { throw new ModelDigestError(code); };
const EFFECT = ["pure","io","network","random","clock","actor","ffi","suspend"];
const PROVENANCE = ["verified-ores","trusted-native"];
const ALLOCATION = ["none","scratch","dynamic"];
const DTYPE = ["bool","i32","i64","f32","f64"];
const LAYOUT = ["scalar","contiguous"];
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
  } else {
    out.string(c.value);
  }
}

function encodePort(out, p) {
  if (!plain(p)) fail("MODEL_INVALID_PORT");
  if (p.kind === "nominal") {
    exact(p, ["kind","typeAbi","bytes"], "MODEL_INVALID_PORT");
    out.u8(1);
    out.string(p.typeAbi);
    out.u64(p.bytes);
    return;
  }
  exact(p, ["dtype","shape","layout","unit"], "MODEL_INVALID_PORT");
  if (!denseArray(p.shape) || p.shape.length > 8) fail("MODEL_INVALID_PORT");
  out.u8(0);
  out.u8(enumOrdinal(p.dtype, DTYPE, "MODEL_INVALID_PORT"));
  out.u8(p.shape.length);
  for (const d of p.shape) out.u64(d);
  const canonicalLayout = p.layout ?? (p.shape.length === 0 ? "scalar" : "contiguous");
  if ((p.shape.length === 0 && canonicalLayout !== "scalar") ||
      (p.shape.length > 0 && canonicalLayout !== "contiguous"))
    fail("MODEL_INVALID_PORT");
  out.u8(enumOrdinal(canonicalLayout, LAYOUT, "MODEL_INVALID_PORT"));
  if (p.unit === undefined) out.u8(0);
  else { out.u8(1); out.string(p.unit); }
}

export function canonicalModelGraphV1Bytes(graph) {
  exact(graph, ["version","modelTypeId","nodes","outputs"], "MODEL_INVALID_RESOLVED_GRAPH");
  if (graph.version !== 1 || !denseArray(graph.nodes) || graph.nodes.length === 0 ||
      !denseArray(graph.outputs) || graph.outputs.length === 0)
    fail("MODEL_INVALID_RESOLVED_GRAPH");

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

    out.u32(n.constArgs.length);
    for (const c of n.constArgs) encodeConstant(out, c);

    out.u32(n.inputs.length);
    for (const id of n.inputs) {
      if (!ordinals.has(id) || ordinals.get(id) >= index)
        fail("MODEL_FORWARD_OR_CYCLIC_EDGE");
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
