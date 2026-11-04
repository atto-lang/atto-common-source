import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FrozenBytes } from './tcp_shared_pool_model_v1.test.mjs';

const fixture = JSON.parse(await readFile(new URL(
  '../contracts/v1/tcp-frozen-slab-portable-v1.json', import.meta.url), 'utf8'));

test('portable frozen slab fixture is pinned to one-byte octets and a one MiB budget', () => {
  assert.equal(fixture.schema, 'oreslang.tcp.frozen_slab.portable.v1');
  assert.equal(fixture.maxBytes, 1024*1024);
  assert.equal(fixture.guestRawPointer, false);
  assert.equal(fixture.guestMutableAlias, false);
  assert.deepEqual(Object.keys(fixture.runtimeStatus).sort(),
    ['java','llvm','wasm','cranelift','net'].sort());
  assert.equal(fixture.cases.length, 4);
  for (const c of fixture.cases) {
    assert.match(c.id, /^PB0[1-4]$/);
    assert.ok(c.bytes.length <= fixture.maxBytes);
    assert.ok(c.bytes.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
  }
});

test('reference slab executes canonical vectors, denies wrong pin and preserves snapshot', () => {
  for (const c of fixture.cases) {
    const input=Array.from(c.bytes);
    const slab=new FrozenBytes(input);
    input.fill(17);
    const pin=slab.pin();
    if (c.readError) {
      assert.throws(() => slab.read_at(c.index, pin), /invalid-read/);
    } else {
      assert.equal(slab.read_at(c.index, pin), c.expected);
    }
    assert.throws(() => slab.read_at(0, Object.freeze({})), /buffer-access-denied/);
    slab.retire();
    assert.throws(() => slab.pin(), /revoked-buffer/);
    assert.equal(slab.freed, false);
    slab.release_pin(pin);
    assert.equal(slab.freed, true);
    assert.throws(() => slab.read_at(c.index, pin), /buffer-access-denied/);
    assert.throws(() => slab.release_pin(pin), /pin-underflow/);
  }
});

test('byte publication rejects unbounded or nonbyte sources', () => {
  assert.throws(() => new FrozenBytes([256]), /invalid-byte/);
  assert.throws(() => new FrozenBytes([-1]), /invalid-byte/);
  assert.throws(() => new FrozenBytes([Number.NaN]), /invalid-byte/);
  assert.throws(() => new FrozenBytes([{}]), /invalid-byte/);
  assert.throws(() => new FrozenBytes(new Uint8Array(1024*1024+1)), /buffer-capacity/);
});
