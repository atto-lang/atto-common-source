import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalJson, stableFunctionId, stableProbeId, validateManifest, verifyArtifact} from '../tools/verify-instrumentation-v1.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/runtime/v1/instrumentation-v1.json', import.meta.url), 'utf8'));
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const {publicKey: hostileKey} = generateKeyPairSync('ed25519');
const trustedKeys = {'ci-trusted': publicKey.export({type: 'spki', format: 'pem'})};
const h = (ch, size = 64) => ch.repeat(size);
function manifest() {
  const id = stableFunctionId('checkout', 'calculate_total');
  return {
    schema: 'atto.instrumentation-manifest.v1', backend: 'llvm',
    binding: {source_head: h('a', 40), source_tree: h('b', 40), compiler_sha256: h('c'), executable_sha256: h('d')},
    capabilities: {aot_probes: true, jit_codegen: true, hard_realtime: false, tenant_isolation: true},
    functions: [{id, module: 'checkout', qualified_name: 'calculate_total',
      abi_sha256: h('e'), effects_sha256: h('f'), ownership_sha256: h('1'), continuation_sha256: h('2'),
      dispatch_boundary: true, replacement_policy: 'new_calls_only',
      probes: [{id: stableProbeId(id, 'function_entry', 0), kind: 'function_entry', site: 0},
        {id: stableProbeId(id, 'function_exit', 1), kind: 'function_exit', site: 1}]
    }]
  };
}
const expected = () => ({backend: 'llvm', ...manifest().binding});
function envelope(m = manifest()) {
  return {schema: 'atto.instrumentation-envelope.v1', key_id: 'ci-trusted', manifest: m,
    signature: sign(null, Buffer.from(canonicalJson(m)), privateKey).toString('base64')};
}
const check = (e = envelope(), opts = {}) => verifyArtifact({envelope: e, trustedKeys, expected: expected(), mode: 'ON', authorized: true, ...opts});

test('contract is explicitly source-level; no backend execution credit', () => {
  assert.equal(contract.status, 'CONTRACT_ONLY_NO_BACKEND_EXECUTION_CREDIT');
  assert.deepEqual(contract.backend_ids, ['java-graal', 'llvm', 'dotnet', 'wasm', 'cranelift']);
  assert.equal(contract.code_replacement.suspended_continuations, 'pin_original_version');
  assert.equal(contract.security.signature_does_not_grant_authorization, true);
});
test('deterministic function/probe IDs and signed ON/DEEP admission', () => {
  assert.match(stableFunctionId('checkout', 'calculate_total'), /^[a-f0-9]{32}$/);
  assert.notEqual(stableFunctionId('checkout', 'calculate_total'), stableFunctionId('other', 'calculate_total'));
  assert.equal(check().accepted, true);
  assert.equal(check(envelope(), {mode: 'DEEP'}).accepted, true);
  assert.equal(check().classification, 'SIGNED_CONTRACT_ONLY_NO_EXECUTION_CREDIT');
});
test('OFF does not require tracing authorization, ON and DEEP do', () => {
  assert.equal(check(envelope(), {mode: 'OFF', authorized: false}).accepted, true);
  for (const mode of ['ON', 'DEEP']) assert.equal(check(envelope(), {mode, authorized: false}).accepted, false);
});
test('reject unsigned, wrong signer, modified payload, and substituted key', () => {
  const e = envelope(); e.signature = ''; assert.equal(check(e).accepted, false);
  const f = envelope(); f.key_id = 'attacker'; assert.equal(check(f).accepted, false);
  const g = envelope(); g.manifest.functions[0].abi_sha256 = h('0'); assert.equal(check(g).accepted, false);
  const i = envelope(); assert.equal(check(i, {trustedKeys: {'ci-trusted': hostileKey.export({type:'spki',format:'pem'})}}).accepted, false);
});
test('reject mismatched deployed source/tree/compiler/binary/backend', () => {
  for (const key of ['source_head', 'source_tree', 'compiler_sha256', 'executable_sha256']) {
    const e = expected(); e[key] = h('0', key.endsWith('head') || key.endsWith('tree') ? 40 : 64);
    assert.equal(check(envelope(), {expected: e}).accepted, false, key);
  }
  assert.equal(check(envelope(), {expected: {...expected(), backend: 'wasm'}}).accepted, false);
});
test('reject forged identities, duplicate probes, missing fingerprints and unknown fields', () => {
  const cases = [
    m => {m.functions[0].id = h('0', 32);},
    m => {m.functions[0].probes.push({...m.functions[0].probes[0]});},
    m => {delete m.functions[0].ownership_sha256;},
    m => {m.extra_grant = true;},
    m => {m.functions[0].replacement_policy = 'overwrite_inflight';},
    m => {m.functions[0].probes[0].site = -1;},
    m => {m.capabilities.tenant_isolation = false;}
  ];
  for (const mutate of cases) {
    const m = manifest(); mutate(m);
    assert.throws(() => validateManifest(m));
    assert.equal(check(envelope(m)).accepted, false);
  }
});
test('DEEP fails closed for hard realtime, missing JIT, or missing dispatch boundary', () => {
  const x = manifest(); x.capabilities.jit_codegen = false;
  assert.equal(check(envelope(x), {mode: 'DEEP'}).accepted, false);
  assert.equal(check(envelope(x), {mode: 'ON'}).accepted, true);
  const y = manifest(); y.capabilities.hard_realtime = true;
  assert.equal(check(envelope(y), {mode: 'DEEP'}).accepted, false);
  const z = manifest(); z.functions[0].dispatch_boundary = false;
  assert.equal(check(envelope(z), {mode: 'DEEP'}).accepted, false);
});
test('bounded inventories, strict mode, and noncanonical signature reject', () => {
  const x = manifest(); x.functions[0].probes = Array.from({length: 4097}, (_, i) => ({id: stableProbeId(x.functions[0].id, 'cancel', i), kind: 'cancel', site: i}));
  assert.equal(check(envelope(x)).accepted, false);
  assert.equal(check(envelope(), {mode: 'TEST'}).accepted, false);
  const e = envelope(); e.signature += '\n'; assert.equal(check(e).accepted, false);
});
test('canonical JSON insensitive to insertion order; rejects NaN/unsafe integers', () => {
  assert.equal(canonicalJson({z: 2, a: 1}), canonicalJson({a: 1, z: 2}));
  assert.throws(() => canonicalJson({bad: NaN}));
  assert.throws(() => canonicalJson({bad: Number.MAX_SAFE_INTEGER + 1}));
});
