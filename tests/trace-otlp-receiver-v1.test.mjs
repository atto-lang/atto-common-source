import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startReceiver} from '../tools/trace-e2e/otlp-http-receiver.mjs';

// This test sends synthetic OTLP JSON from Node, NOT a real Atto guest. It
// verifies the external capture tool only.
test('loopback receiver accepts and persists a valid OTLP JSON envelope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atto-otlp-test-'));
  const output = join(dir, 'capture.jsonl');
  const receiver = await startReceiver({output});
  try {
    const base = 'http://127.0.0.1:' + receiver.address.port;
    const payload = {resourceSpans: [{
      scopeSpans: [{spans: [{
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '1111111111111111',
        kind: 2, name: 'synthetic', startTimeUnixNano: '1', endTimeUnixNano: '2'
      }]}]
    }]};
    const accepted = await fetch(base + '/v1/traces', {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload)
    });
    assert.equal(accepted.status, 200);
    const missing = await fetch(base + '/not-traces', {method: 'POST'});
    assert.equal(missing.status, 404);
    const wrongFormat = await fetch(base + '/v1/traces', {
      method: 'POST',
      headers: {'content-type': 'application/x-protobuf'},
      body: 'no'
    });
    assert.equal(wrongFormat.status, 415);
    const malformed = await fetch(base + '/v1/traces', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: '{bad'
    });
    assert.equal(malformed.status, 400);
    await receiver.close();
    assert.deepEqual(JSON.parse((await readFile(output, 'utf8')).trim()), payload);
    assert.equal(receiver.count(), 2);
  } finally {
    await receiver.close();
    await rm(dir, {recursive: true, force: true});
  }
});

test('cannot expose receiver on unverified external port or missing output path', async () => {
  await assert.rejects(() => startReceiver({port: -1, output: '/tmp/none'}), /port/);
  await assert.rejects(() => startReceiver({port: 65536, output: '/tmp/none'}), /port/);
  await assert.rejects(() => startReceiver({port: 0}), /output path/);
});
