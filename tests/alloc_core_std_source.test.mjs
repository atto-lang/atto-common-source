import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Source-level only: these checks do NOT parse/compile/link/execute .atto.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('contracts/canonical-stdlib-v1.json'));
const sourcePaths = [
  'stdlib/alloc/byte_region.atto',
  'stdlib/core/byte_bounds.atto',
  'stdlib/core/identity.atto',
  'stdlib/core/size_math.atto',
  'stdlib/core/u32_endian.atto',
  'stdlib/std/buffer.atto',
  'stdlib/std/byte_ops.atto'
];
const core = read('stdlib/core/size_math.atto');
const alloc = read('stdlib/alloc/byte_region.atto');
const std = read('stdlib/std/byte_ops.atto');

test('all canonical Atto sources are pinned by exact bytes and layer inventory', () => {
  assert.deepEqual(manifest.sources.map(s => s.path), sourcePaths);
  for (const entry of manifest.sources) {
    const bytes = Buffer.from(read(entry.path), 'utf8');
    assert.equal(bytes.byteLength, entry.bytes, entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
  assert.equal(manifest.status, 'CANDIDATE_NOT_COMPILED');
  assert.ok(manifest.targets.every(x => x.execution === 'NOT_EXECUTED'));
});

test('layer DAG is core -> alloc -> std only; no ambient host capabilities', () => {
  for (const path of sourcePaths) {
    const text = read(path);
    const layer = path.split('/')[1];
    const imports = [...text.matchAll(/^import module [a-z_]+ from "(stdlib\/[^"]+)";$/gm)].map(m=>m[1]);
    assert.equal((text.match(/^import module /gm) || []).length, imports.length, path);
    for (const dep of imports) {
      assert.ok(sourcePaths.includes(dep), path + ' missing import ' + dep);
      const target = dep.split('/')[1];
      if (layer === 'core') assert.fail('core must not import: ' + dep);
      if (layer === 'alloc') assert.equal(target, 'core');
      if (layer === 'std') assert.ok(target === 'alloc' || target === 'core' || target === 'std');
    }
    assert.doesNotMatch(text, /\b(?:stdio|process|socket|syscall|ffi)\s*\./);
  }
});
test('freestanding size helpers reject signed inputs before subtract/divide', () => {
  assert.match(core, /if a < 0 \|\| b < 0 \|\| limit < 0 then return false; fi/g);
  assert.match(core, /return b <= limit - a;/);
  assert.match(core, /return a <= limit \/ b;/);
  assert.doesNotMatch(core, /\b(?:new|alloc|await|spawn)\b/);
});
test('alloc ByteRegion is sealed-backed, checks bounds and requires mutable receiver', () => {
  assert.match(alloc, /private let mut OwnedBytes storage = OwnedBytes\.empty\(\);/);
  assert.match(alloc, /OwnedBytes\\.allocate_zeroed\\(count\\)/);
  assert.match(alloc, /pub static fnc empty\\(\\): ByteRegion/);
  assert.match(alloc, /pub mtd \(mut self: ByteRegion\) write_byte/);
  assert.match(alloc, /bounds\.byte_range_valid/);
  assert.match(alloc, /bounds\.byte_u8_valid/);
  assert.doesNotMatch(alloc, /\b(?:Pointer|malloc|free|Unsafe)\b/);
});
test('std byte equality builds on alloc without host I/O', () => {
  assert.match(std, /import module alloc_bytes from "stdlib\/alloc\/byte_region.atto";/);
  assert.match(std, /pub fnc bytes_equal/);
  assert.match(std, /left\.read_byte\(index\) != right\.read_byte\(index\)/);
});
