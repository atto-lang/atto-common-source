import test from 'node:test';
import assert from 'node:assert/strict';
import { suite, test_case, skip_case, run_suite } from '../reference/test_harness_v1.mjs';
import { report_jsonl } from '../reference/test_reporters_v1.mjs';

test('JSONL escapes newlines, delimiters, unicode and keeps one terminal event', async () => {
  const special = 'a\n|b\u2028🔒';
  const r = await run_suite(suite('root', [test_case(special, () => { throw Error('bad\nline|2"'); })]));
  const lines = report_jsonl(r, { compiler: 'host-only' }).trimEnd().split('\n');
  assert.equal(lines.length, 2);
  const evt = JSON.parse(lines[0]);
  assert.equal(evt.name, 'root/' + special);
  assert.match(evt.detail, /line\|2/);
  const summary = JSON.parse(lines[1]);
  assert.equal(summary.kind, 'summary');
  assert.equal(summary.counts.failed, 1);
});
test('reporter rejects counterfeit PASS totals and duplicate terminal event names', () => {
  assert.throws(() => report_jsonl({
    events: [{status: 'PASS', name: 'a', detail: ''}],
    summary: {total: 1, passed: 0, failed: 1, skipped: 0, filtered: 0}
  }), /summary/);
  assert.throws(() => report_jsonl({
    events: [{status: 'PASS', name: 'a', detail: ''}, {status: 'PASS', name: 'a', detail: ''}],
    summary: {total: 2, passed: 2, failed: 0, skipped: 0, filtered: 0}
  }), /duplicate/);
});
test('reporter rejects prototype-based status and nonfinite metadata', () => {
  assert.throws(() => report_jsonl({
    events: [{status: 'toString', name: 'a', detail: ''}],
    summary: {total: 1, passed: 0, failed: 1, skipped: 0, filtered: 0}
  }), /invalid event/);
  assert.throws(() => report_jsonl({
    events: [], summary: {total: 0, passed: 0, failed: 0, skipped: 0, filtered: 0}
  }, { nan: NaN }), /unsafe metadata/);
});
test('a skipped case is one event and does not execute body', async () => {
  const r = await run_suite(suite('root', [skip_case('later', 'not yet')]));
  const lines = report_jsonl(r).trim().split('\n').map(JSON.parse);
  assert.equal(lines[0].status, 'SKIP');
  assert.equal(lines[1].counts.skipped, 1);
});
