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
  const matches = [...source.matchAll(/\bdefine pub trait (\w+)(?:<([^>]+)>)?(?: extends ([^\n]+?))? as\s*([\s\S]*?)\n\s*end/g)];
  assert.deepEqual(matches.map(m => m[1]).sort(), Object.keys(manifest.traits).sort());
  for (const match of matches) {
    const [full, name, args, parents, body] = match;
    const spec = manifest.traits[name];
    assert.equal(args ? args.split(',').length : 0, spec.arity, name);
    assert.equal(parents || null, spec.extends ? spec.extends.join(', ') : null,
      name + ' parent conformance must match manifest');
    const methods = [...body.matchAll(/\bfnc\s+(\w+)\s*\(/g)].map(m => m[1]).sort();
    assert.deepEqual(methods, [...spec.methods].sort(),
      name + ' must have exactly the declared method set');
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


test('exact Atto guest fixtures remain SHA-pinned with no evidence laundering', () => {
  assert.equal(manifest.fixtures.length, 8);
  assert.equal(manifest.fixtures.filter(f => f.kind === 'positive').length, 3);
  assert.equal(manifest.fixtures.filter(f => f.kind === 'compile_reject_expected').length, 5);
  assert.equal(new Set(manifest.fixtures.map(f => f.id)).size, manifest.fixtures.length);
  assert.equal(new Set(manifest.fixtures.map(f => f.path)).size, manifest.fixtures.length);
  for (const fixture of manifest.fixtures) {
    assert.match(fixture.id, /^[a-z][a-z0-9-]*$/);
    assert.match(fixture.path, /^tests\/fixtures\/core-protocols-v1\/[a-z0-9-]+\.atto$/);
    const target = root + fixture.path;
    assert.equal(lstatSync(target).isSymbolicLink(), false, fixture.id);
    const bytes = readFileSync(target);
    const sha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(sha, fixture.git_blob_sha, fixture.id);
    if (fixture.kind === 'positive') {
      assert.equal(fixture.expected_exit_code, 42);
      assert.match(bytes.toString('utf8'), /pub fnc main\(\): int/);
    } else {
      assert.equal(fixture.kind, 'compile_reject_expected');
      assert.equal(fixture.expected_exit_code, undefined);
    }
  }
});

test('core traits remain freestanding and do not launder actor or I/O privileges', () => {
  const pureContracts = ['TryFrom', 'ReadWrite', 'Transform', 'BatchWritable', 'KeyValueStore'];
  for (const name of pureContracts) assert.ok(manifest.traits[name], name);
  assert.ok(manifest.compiler_intrinsics_not_user_implementable.includes('ActorLifecycle'));
  assert.doesNotMatch(source, /(?:^|\n)\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:external|critical|unsafe|spawn|await)\b\s+(?:fnc|mtd)/);
  assert.doesNotMatch(source, /\b(?:std\/|ores\.std|java\.|dotnet\.)/);
  for (const name of ['ReadWrite', 'Transform']) {
    assert.deepEqual(manifest.traits[name].methods, [],
      name + ' must be composition, not new authority');
  }
});
