import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contract = JSON.parse(await readFile(new URL('../contracts/global-symbol-identity-v1.json', import.meta.url)));

function identity(value) {
  if (value.type === 'string') return ['str', value.value];
  const { scope, module, symbol, isolate } = value;
  const segments = [scope, module, symbol];
  if (scope === 'local') segments.splice(1, 0, isolate);
  return segments;
}

test('shared symbol conformance table has complete, unique cases', () => {
  assert.equal(contract.schema, 'atto.symbol.identity.v1');
  assert.equal(contract.source_syntax.public_declaration, 'define pub symbol #ready;');
  assert.equal(contract.identity.copyable_sendable, true);
  assert.equal(contract.identity.symbol_handles_are_capabilities, false);
  assert.equal(contract.identity.string_equals_symbol, false);
  const seen = new Set();
  for (const row of contract.conformance_cases) {
    assert.equal(typeof row.id, 'string');
    assert.equal(seen.has(row.id), false, row.id);
    seen.add(row.id);
    assert.equal(typeof row.same, 'boolean');
    assert.equal(row.same, JSON.stringify(identity(row.left)) === JSON.stringify(identity(row.right)), row.id);
  }
  assert.ok(seen.size >= 10);
});

test('identity excludes isolate ID only for global declarations', () => {
  const cases = new Map(contract.conformance_cases.map(testCase => [testCase.id, testCase]));
  assert.equal(cases.get('global-supervisor-actor').same, true);
  assert.equal(cases.get('private-two-actors').same, false);
  assert.equal(cases.get('public-versus-private').same, false);
  assert.equal(cases.get('symbol-versus-string').same, false);
  assert.equal(contract.limits.utf8_key_bytes_per_tenant, 1 << 20);
});

test('executable private and qualified import model rejects identity as authority', () => {
  const runtime = contract.executable_browser_profile;
  assert.equal(runtime.private_declaration, 'define symbol #secret;');
  assert.equal(runtime.public_guest_ordinal.startsWith('positive'), true);
  assert.equal(runtime.private_guest_ordinal.startsWith('negative'), true);
  assert.equal(runtime.guest_private_symbol_transport,false);
  assert.equal(runtime.guest_symbol_is_capability,false);
  assert.equal(runtime.guest_cross_module_import_linking,false);
  assert.deepEqual(runtime.wasm_sections,
    ['atto.symbols','atto.private_symbols','atto.actor_mail']);
  assert.ok(runtime.mail_security.includes('indirect local binding'));
  assert.ok(runtime.host_linker.includes('trusted host package'));
});
