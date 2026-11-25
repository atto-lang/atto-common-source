import {createHash, createPublicKey, verify as cryptoVerify} from 'node:crypto';

const HEX32 = /^[a-f0-9]{32}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_.:]*$/;
const BACKENDS = new Set(['java-graal', 'llvm', 'dotnet', 'wasm', 'cranelift']);
const PROBES = new Set(['function_entry', 'function_exit', 'message_send', 'message_receive', 'suspend', 'resume', 'cancel', 'error', 'supervisor', 'http_in', 'http_out']);
const ERR = message => { throw new Error('instrumentation v1: ' + message); };
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exact = (o, keys, label) => {
  if (!isObject(o)) ERR(label + ' must be an object');
  if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) ERR(label + ' unexpected or missing fields');
};
const hex = (v, re, label) => { if (typeof v !== 'string' || !re.test(v)) ERR(label + ' invalid digest'); };

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  ERR('unsupported canonical JSON value');
}
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
export const stableFunctionId = (module, qualifiedName) => digest('atto-function-v1\0' + module + '\0' + qualifiedName).slice(0, 32);
export const stableProbeId = (functionId, kind, site) => digest('atto-probe-v1\0' + functionId + '\0' + kind + '\0' + site).slice(0, 32);

export function validateManifest(manifest) {
  exact(manifest, ['schema', 'backend', 'binding', 'capabilities', 'functions'], 'manifest');
  if (manifest.schema !== 'atto.instrumentation-manifest.v1' || !BACKENDS.has(manifest.backend)) ERR('unknown schema/backend');
  exact(manifest.binding, ['source_head', 'source_tree', 'compiler_sha256', 'executable_sha256'], 'binding');
  hex(manifest.binding.source_head, HEX40, 'source_head');
  hex(manifest.binding.source_tree, HEX40, 'source_tree');
  hex(manifest.binding.compiler_sha256, HEX64, 'compiler_sha256');
  hex(manifest.binding.executable_sha256, HEX64, 'executable_sha256');
  exact(manifest.capabilities, ['aot_probes', 'jit_codegen', 'hard_realtime', 'tenant_isolation'], 'capabilities');
  for (const [key, value] of Object.entries(manifest.capabilities)) if (typeof value !== 'boolean') ERR('capability ' + key + ' not boolean');
  if (!manifest.capabilities.tenant_isolation) ERR('tenant isolation is required');
  if (manifest.capabilities.hard_realtime && manifest.capabilities.jit_codegen) ERR('hard realtime cannot enable runtime code generation');
  if (!Array.isArray(manifest.functions) || manifest.functions.length === 0 || manifest.functions.length > 65536) ERR('function inventory missing or over budget');
  const ids = new Set();
  const probes = new Set();
  for (const f of manifest.functions) {
    exact(f, ['id', 'module', 'qualified_name', 'abi_sha256', 'effects_sha256', 'ownership_sha256', 'continuation_sha256', 'dispatch_boundary', 'replacement_policy', 'probes'], 'function');
    if (typeof f.module !== 'string' || !IDENT.test(f.module) || typeof f.qualified_name !== 'string' || !IDENT.test(f.qualified_name)) ERR('invalid function name');
    hex(f.id, HEX32, 'function id');
    if (f.id !== stableFunctionId(f.module, f.qualified_name) || ids.has(f.id)) ERR('function id mismatch or collision');
    ids.add(f.id);
    for (const key of ['abi_sha256', 'effects_sha256', 'ownership_sha256', 'continuation_sha256']) hex(f[key], HEX64, key);
    if (typeof f.dispatch_boundary !== 'boolean' || f.replacement_policy !== 'new_calls_only') ERR('unsafe function replacement contract');
    if (!Array.isArray(f.probes) || f.probes.length > 4096) ERR('probe inventory invalid or over budget');
    for (const p of f.probes) {
      exact(p, ['id', 'kind', 'site'], 'probe');
      hex(p.id, HEX32, 'probe id');
      if (!PROBES.has(p.kind) || !Number.isSafeInteger(p.site) || p.site < 0) ERR('invalid probe site');
      if (p.id !== stableProbeId(f.id, p.kind, p.site) || probes.has(p.id)) ERR('probe id mismatch or collision');
      probes.add(p.id);
    }
  }
  return true;
}

// A signed build-bound descriptor is not authorization or evidence of guest/JIT
// execution; enforce tenant permissions, W^X and version retirement elsewhere.
export function verifyArtifact({envelope, trustedKeys, expected, mode = 'OFF', authorized = false}) {
  try {
    exact(envelope, ['schema', 'key_id', 'manifest', 'signature'], 'envelope');
    if (envelope.schema !== 'atto.instrumentation-envelope.v1') ERR('unknown envelope schema');
    if (typeof envelope.key_id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(envelope.key_id)) ERR('invalid key id');
    validateManifest(envelope.manifest);
    if (!isObject(trustedKeys) || !Object.hasOwn(trustedKeys, envelope.key_id)) ERR('untrusted signer');
    const publicKey = createPublicKey(trustedKeys[envelope.key_id]);
    if (publicKey.asymmetricKeyType !== 'ed25519') ERR('only Ed25519 signer keys are supported');
    if (typeof envelope.signature !== 'string' || !/^[a-zA-Z0-9+/]{86}==$/.test(envelope.signature)) ERR('invalid signature encoding');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== envelope.signature) ERR('non-canonical signature');
    if (!cryptoVerify(null, Buffer.from(canonicalJson(envelope.manifest)), publicKey, signature)) ERR('invalid signature');
    exact(expected, ['backend', 'source_head', 'source_tree', 'compiler_sha256', 'executable_sha256'], 'expected binding');
    if (envelope.manifest.backend !== expected.backend) ERR('backend mismatch');
    for (const key of ['source_head', 'source_tree', 'compiler_sha256', 'executable_sha256']) {
      if (envelope.manifest.binding[key] !== expected[key]) ERR(key + ' not bound to deployed build');
    }
    if (!['OFF', 'ON', 'DEEP'].includes(mode)) ERR('unknown tracing mode');
    if (mode !== 'OFF' && !authorized) ERR('no tenant-scoped tracing authorization');
    const {capabilities, functions} = envelope.manifest;
    if (mode === 'ON' && !capabilities.aot_probes) ERR('no AOT probes');
    if (mode === 'DEEP' && (!capabilities.jit_codegen || capabilities.hard_realtime || !functions.every(f => f.dispatch_boundary))) ERR('deep mode not safely supported');
    return {accepted: true, classification: 'SIGNED_CONTRACT_ONLY_NO_EXECUTION_CREDIT', mode};
  } catch (error) {
    return {accepted: false, classification: 'REJECTED', reason: String(error.message ?? error)};
  }
}
