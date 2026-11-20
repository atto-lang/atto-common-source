import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('contracts/v1/actor-critical-modes/manifest.json', root)));
const blob = bytes => createHash('sha1').update(Buffer.concat([
  Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const bytesFor = path => readFileSync(new URL(path, root));
function validate(m, read = bytesFor) {
  assert.equal(m.status, 'draft_not_executed');
  assert.equal(m.cases.length, 9);
  assert.equal(new Set(m.cases.map(c => c.id)).size, 9);
  assert.equal(m.cases.filter(c => c.expected === 'run_stdout').length, 1);
  assert.equal(m.cases.filter(c => c.expected === 'compile_reject').length, 8);
  for (const c of m.cases) {
    assert.match(c.id, /^[a-z_]+$/);
    assert.equal(c.source, `contracts/v1/actor-critical-modes/fixtures/${c.id}.ores`);
    const bytes = read(c.source);
    assert.equal(blob(bytes), c.git_blob_sha);
    assert.match(bytes.toString(), /pub suspends fnc main\(\)/);
    assert.doesNotMatch(bytes.toString(), /\basync\b|&mut/);
  }
}

test('nine pending state-loan fixtures have exact source identities and current effect spelling', () => validate(manifest));
test('read/write suspension and mutable reborrow remain distinct negative candidates', () => {
  for (const mode of ['read', 'write']) {
    const c = manifest.cases.find(c => c.id === `reject_await_in_${mode}`);
    assert.equal(c.diagnostic_category, 'effect');
    assert.match(bytesFor(c.source).toString(), new RegExp(`critical\\[${mode}\\]`));
    assert.match(bytesFor(c.source).toString(), /await self.get_done\(\)/);
  }
  const c = manifest.cases.find(c => c.id === 'reject_read_mutable_reborrow');
  assert.equal(c.diagnostic_category, 'borrow');
  assert.match(bytesFor(c.source).toString(), /rt mut borrow s/);
});
test('modified sources, duplicate cases, path changes and false evidence promotion fail integrity validation', () => {
  assert.throws(() => validate(manifest, path => Buffer.concat([bytesFor(path), Buffer.from(' ')])));
  for (const mutate of [
    m => m.cases[1] = {...m.cases[0]},
    m => m.cases[0].source = '../foreign.ores',
    m => m.status = 'verified',
  ]) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => validate(changed));
  }
});
