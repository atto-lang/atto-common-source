import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = root + 'library/ores.core/protocols.atto';
const manifest = JSON.parse(readFileSync(root + 'contracts/v1/core-protocols-v1.json', 'utf8'));
const content = readFileSync(path);
const source = content.toString('utf8');
const blobSha = createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');

test('canonical freestanding source is regular, pinned, and closed', () => {
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.equal(blobSha, manifest.git_blob_sha);
  assert.equal(manifest.import_root, 'ores.core/');
  assert.equal(manifest.status, 'SOURCE_DECLARED_BACKEND_EXECUTION_UNVERIFIED');
  assert.match(source, /^define module protocols as/m);
  assert.match(source, /^end\s*$/m);
  assert.doesNotMatch(source, /\b(java|shell|ffi|filesystem|process)\s*\{/);
});

test('every declared protocol and required method is present, and no extra traits', () => {
  const matches = [...source.matchAll(/\bdefine pub trait (\w+)(?:<([^>]+)>)?(?: extends \w+(?:<[^>]+>)?)? as\s*([\s\S]*?)\n\s*end/g)];
  assert.deepEqual(matches.map(m => m[1]).sort(), Object.keys(manifest.traits).sort());
  for (const match of matches) {
    const [full, name, args, body] = match;
    const spec = manifest.traits[name];
    assert.equal(args ? args.split(',').length : 0, spec.arity, name);
    for (const method of spec.methods) {
      assert.match(body, new RegExp('\\bfnc ' + method + '\\('), name + '.' + method);
    }
    assert.ok(full.length < 2048);
  }
});

test('guest conformance cannot forge compiler-owned auto traits or actors', () => {
  for (const name of manifest.compiler_intrinsics_not_user_implementable) {
    assert.doesNotMatch(source, new RegExp('\\bdefine\\s+(?:pub\\s+)?trait\\s+' + name + '\\b'));
  }
  assert.doesNotMatch(source, /\bfnc\s+(?:read|write|seek|flush)_blocking\(/);
  for (const status of Object.values(manifest.backend_evidence)) {
    assert.equal(status, 'NOT_EXECUTED', 'do not claim backend execution from source-only checks');
  }
});
