import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest = JSON.parse(readFileSync(
  new URL('../contracts/library/v1/canonical-numeric-source.json', import.meta.url), 'utf8'));
const bytes = readFileSync(new URL('../library/ores.core/numeric.ores', import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sha1 = data => createHash('sha1').update(data).digest('hex');
const gitBlob = data => sha1(Buffer.concat([
  Buffer.from('blob ' + data.length + String.fromCharCode(0), 'utf8'), data]));

test('canonical native Oreslang numeric source has exact pinned bytes and Git blob identity', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'oreslang.canonical-library-source');
  assert.equal(manifest.module, 'ores.core/numeric');
  assert.equal(manifest.sourcePath, 'library/ores.core/numeric.ores');
  assert.equal(manifest.sourceEncoding, 'UTF-8');
  assert.equal(sha256(bytes), manifest.sourceSha256);
  assert.equal(gitBlob(bytes), manifest.gitBlobSha1);
  assert.equal(bytes.at(-1), 10);
  assert.equal(manifest.semanticsContract, 'contracts/library/v1/core-math-i64.json');
  assert.deepEqual(manifest.canonicalApi, [
    'min_int(int,int):int', 'max_int(int,int):int', 'clamp_int(int,int,int):int']);
  assert.equal(manifest.policy.requireByteIdenticalVendorCopy, true);
  assert.equal(manifest.policy.compilersMustCompileOreslangSource, true);
  assert.equal(manifest.policy.backendExecutionEvidenceRequired, true);
});

test('numeric source contains only native Oreslang semantics, not privileged imports', () => {
  const source = bytes.toString('utf8');
  assert.match(source, /define module numeric as/);
  for (const fn of ['min_int', 'max_int', 'clamp_int'])
    assert.match(source, new RegExp('pub fnc ' + fn + '\\('));
  assert.doesNotMatch(source, /^\\s*import\\s+.*(?:java:|ores\\.std\\/|std\\/)/m);
  assert.doesNotMatch(source, /(?:^|\\s)(?:do\\s+)?java\\s*\\{/m);
});

test('source mutation is detected without claiming successful guest execution', () => {
  assert.notEqual(sha256(Buffer.concat([bytes, Buffer.from(' ')])), manifest.sourceSha256);
  assert.notEqual(gitBlob(Buffer.concat([bytes, Buffer.from(' ')])), manifest.gitBlobSha1);
  assert.match(manifest.status, /not a claim of executable cross-backend parity/);
});
