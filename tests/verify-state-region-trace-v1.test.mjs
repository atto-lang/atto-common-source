import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStateRegionTrace } from '../tools/verify-state-region-trace-v1.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
function positive(count) {
  const events = [];
  const add = (data) => events.push({ seq: events.length + 1, ...data });
  for (let i = 0; i < count; i++) {
    add({ op: 'request', ticket: `r${i}`, domain: 'd', actor_generation: 1,
      execution: `e${i}`, execution_generation: 1, carrier: `thread-${i}`, mode: 'read' });
    add({ op: 'grant', ticket: `r${i}` });
    add({ op: 'access', ticket: `r${i}`, execution: `e${i}`, execution_generation: 1, kind: 'read' });
  }
  add({ op: 'request', ticket: 'w', domain: 'd', actor_generation: 1,
    execution: 'writer', execution_generation: 1, carrier: 'thread-0', mode: 'write' });
  add({ op: 'request', ticket: 'late', domain: 'd', actor_generation: 1,
    execution: 'late', execution_generation: 1, carrier: 'thread-1', mode: 'read' });
  for (let i = 0; i < count; i++) add({ op: 'release', ticket: `r${i}`, execution: `e${i}`, execution_generation: 1 });
  add({ op: 'grant', ticket: 'w' });
  add({ op: 'access', ticket: 'w', execution: 'writer', execution_generation: 1, kind: 'write' });
  add({ op: 'release', ticket: 'w', execution: 'writer', execution_generation: 1 });
  add({ op: 'grant', ticket: 'late' });
  add({ op: 'release', ticket: 'late', execution: 'late', execution_generation: 1 });
  add({ op: 'retire', domain: 'd', actor_generation: 1 });
  add({ op: 'reclaim', domain: 'd', actor_generation: 1 });
  return { schema_version: 1, backend: 'java', source_sha: sha,
    thread_count: count, minimum_parallel_readers: count, events };
}
function replace(trace, matcher, replacement) {
  const copy = structuredClone(trace);
  const ix = copy.events.findIndex(matcher);
  assert.notEqual(ix, -1);
  copy.events[ix] = { ...copy.events[ix], ...replacement };
  return copy;
}
function insert(trace, after, newEvent) {
  const copy = structuredClone(trace);
  const ix = copy.events.findIndex(after);
  assert.notEqual(ix, -1);
  copy.events.splice(ix + 1, 0, newEvent);
  copy.events.forEach((event, i) => { event.seq = i + 1; });
  return copy;
}
for (const count of [3, 7, 15]) {
  test(`consistent read/write and retirement history across ${count} OS carriers`, () => {
    const result = verifyStateRegionTrace(positive(count));
    assert.equal(result.peak_readers, count);
    assert.equal(result.checked_accesses, count + 1);
    assert.equal(result.status, 'trace_consistent_not_guest_verified');
  });
}
test('refuses a write while the only loan is read-only', () => {
  const bad = replace(positive(3), e => e.op === 'access', { kind: 'write' });
  assert.throws(() => verifyStateRegionTrace(bad), /READONLY_MUTATION/);
});
test('refuses writer overlap with live readers', () => {
  const bad = insert(positive(3), e => e.op === 'request' && e.ticket === 'w', { op: 'grant', ticket: 'w' });
  assert.throws(() => verifyStateRegionTrace(bad), /OVERLAPPING_WRITER/);
});
test('refuses a late reader barging past waiting writer', () => {
  const bad = insert(positive(3), e => e.op === 'request' && e.ticket === 'late', { op: 'grant', ticket: 'late' });
  assert.throws(() => verifyStateRegionTrace(bad), /READ_BYPASSES_WRITER/);
});
test('refuses stale execution generation on access and release', () => {
  for (const op of ['access', 'release']) {
    const bad = replace(positive(3), e => e.op === op && e.ticket === 'r0', { execution_generation: 99 });
    assert.throws(() => verifyStateRegionTrace(bad), /FOREIGN_OR_STALE_EXECUTION/);
  }
});
test('refuses a successful suspend while loan is live', () => {
  const bad = insert(positive(3), e => e.op === 'grant' && e.ticket === 'r0',
    { op: 'suspend', ticket: 'r0', execution: 'e0', execution_generation: 1 });
  assert.throws(() => verifyStateRegionTrace(bad), /SUSPENSION_WITH_LIVE_LOAN/);
});
test('refuses reclaim before physical release', () => {
  const interrupted = insert(positive(3), e => e.op === 'grant' && e.ticket === 'r0',
    { op: 'retire', domain: 'd', actor_generation: 1 });
  const bad = insert(interrupted, e => e.op === 'retire',
    { op: 'reclaim', domain: 'd', actor_generation: 1 });
  assert.throws(() => verifyStateRegionTrace(bad), /PREMATURE_RECLAMATION/);
});
test('retirement fences access attempted by an ungranted writer', () => {
  const bad = replace(positive(3), e => e.op === 'grant' && e.ticket === 'w',
    { op: 'retire', domain: 'd', actor_generation: 1 });
  assert.throws(() => verifyStateRegionTrace(bad), /ACCESS_OUTSIDE_LOAN/);
});
test('refuses missing thread participation and fake source hashes', () => {
  const bad = positive(7);
  bad.events.filter(e => e.op === 'request').forEach(e => { e.carrier = 'thread-0'; });
  assert.throws(() => verifyStateRegionTrace(bad), /CARRIER_COUNT_MISMATCH/);
  const badSha = positive(3);
  badSha.source_sha = 'unverified';
  assert.throws(() => verifyStateRegionTrace(badSha), /INVALID_SOURCE_SHA/);
});
