import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Source-only guard, not a parser/typechecker or proof that OwnedBytes exists.
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const abi = JSON.parse(read('contracts/owned-bytes-runtime-abi-v1.json'));
const manifest = JSON.parse(read('contracts/canonical-stdlib-v1.json'));
const source = read('stdlib/std/buffer.atto');
const bounds = read('stdlib/core/byte_bounds.atto');
const endian = read('stdlib/core/u32_endian.atto');

test('sealed owned byte ABI is not falsely certified', () => {
  assert.equal(abi.schema, 'atto.owned-bytes.runtime-abi.v1');
  assert.equal(abi.status, 'CANDIDATE_NOT_COMPILED');
  assert.equal(abi.canonical_source, 'stdlib/alloc/byte_region.atto');
  assert.equal(abi.layer, 'alloc');
  assert.equal(abi.visibility, 'COMPILER_SEALED_LIBRARY_ONLY');
  assert.equal(abi.authority.cross_tenant_transfer, 'DENIED_BY_DEFAULT');
  assert.equal(abi.authority.write_borrow, 'EXCLUSIVE');
  assert.equal(abi.evidence.actual_guest_runs, 0);
  assert.equal(abi.evidence.release_authorized, false);
  const allBackends=["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","wasm"];
  assert.deepEqual(abi.evidence.backend_results.map(x=>x.backend),allBackends);
  assert.deepEqual(manifest.targets.map(x=>x.backend),allBackends);
  for (const backend of abi.evidence.backend_results) assert.equal(backend.status,'NOT_EXECUTED');
  const methods = abi.surface.map(x=>x.name);
  assert.deepEqual(methods, [
    'OwnedBytes.empty', 'OwnedBytes.allocate_zeroed', 'OwnedBytes.length',
    'OwnedBytes.read_byte', 'OwnedBytes.write_byte'
  ]);
});

test('public ByteBuffer source has all u8/u16/u32 endian reads/writes and explicit ownership', () => {
  assert.match(source, /define class ByteBuffer as/);
  assert.match(source, /private let mut alloc_bytes\\.ByteRegion storage = alloc_bytes\\.ByteRegion\\.empty\\(\\);/);
  assert.match(source, /import module alloc_bytes from "stdlib\\/alloc\\/byte_region\\.atto";/);
  assert.doesNotMatch(source, /\\bOwnedBytes\\s*\\./);
  assert.match(source, /pub static fnc allocate\(int count\): ByteBuffer throws Error/);
  for (const method of [
    'read_u8', 'read_u16_le', 'read_u16_be', 'read_u32_le', 'read_u32_be',
    'write_u8', 'write_u16_le', 'write_u16_be', 'write_u32_le', 'write_u32_be'
  ]) assert.match(source, new RegExp('\\b'+method+'\\('));
  for (const method of ['write_u8','write_u16_le','write_u16_be','write_u32_le','write_u32_be'])
    assert.match(source, new RegExp('pub mtd \\(mut self: ByteBuffer\\) '+method+'\\('));
  assert.match(source, /self\.require_range\(offset, 4\);/);
  assert.match(source, /self\.require_u32\(value\);/);
  assert.doesNotMatch(source, /\b(?:stdio|process|socket|ffi|syscall)\./);
});

test('bounds and lane helpers are pinned, pure and overflow-safe in source', () => {
  assert.match(bounds, /if width > length then return false; fi/);
  assert.match(bounds, /return offset <= length - width;/);
  assert.match(bounds, /value >= 0 && value <= 4294967295/);
  assert.match(endian, /pub fnc u32_pack_le/);
  assert.match(endian, /pub fnc u32_pack_be/);
  for (const [path, text] of [
    ['stdlib/core/byte_bounds.atto',bounds],
    ['stdlib/core/u32_endian.atto',endian],
    ['stdlib/std/buffer.atto',source]
  ]) {
    const entry=manifest.sources.find(x=>x.path===path);
    assert.ok(entry, 'missing canonical source: '+path);
    const bytes=Buffer.from(text,'utf8');
    assert.equal(entry.bytes,bytes.length);
    assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.doesNotMatch(text, /\r|\u0000/);
  }
  assert.equal(manifest.status,'CANDIDATE_NOT_COMPILED');
});
