import test from 'node:test';
import assert from 'node:assert/strict';
import { suite, run_suite, test_case } from '../reference/test_harness_v1.mjs';
import { property_case, strategy_int, strategy_list } from '../reference/test_property_v1.mjs';

test('composable int strategy keeps values in bounds and shrink preserves bounds', () => {
  const s = strategy_int(-100, 100);
  for (let n = -100; n <= 100; n++) for (const x of s.shrink(n)) assert.ok(x >= -100 && x <= 100);
});
test('simple true property passes', async () => {
  const r = await run_suite(suite('props', [property_case('reflexive', strategy_int(-500, 500), (ctx, x) => x === x, { runs: 128 })]));
  assert.equal(r.summary.passed, 1);
});
test('int shrinking finds minimal positive threshold', async () => {
  const r = await run_suite(suite('props', [property_case('threshold', {
    draw: () => 97, shrink: strategy_int(0, 100).shrink
  }, (ctx, x) => x < 10, { runs: 1 })]));
  assert.equal(r.summary.failed, 1);
  assert.match(r.events[0].detail, /minimal=10\b/);
});
test('negative shrink finds minimal outside -10 threshold', async () => {
  const r = await run_suite(suite('props', [property_case('neg', {
    draw: () => -97, shrink: strategy_int(-100, 0).shrink
  }, (ctx, x) => x >= -10, { runs: 1 })]));
  assert.equal(r.summary.failed, 1);
  assert.match(r.events[0].detail, /minimal=-11\b/);
});
test('list generator emits bounded lists and deletion shrinks', () => {
  const s = strategy_list(strategy_int(-5, 5), { min_length: 0, max_length: 5 });
  const alt = s.shrink([3, 4, 5]);
  assert.ok(alt.some(x => x.length === 0));
  assert.ok(alt.some(x => x.length === 2));
});
test('property replay reproduces the same counterexample', async () => {
  const p = property_case('fails', strategy_int(0, 100), (ctx, x) => x < 10, { runs: 100 });
  const a = await run_suite(suite('props', [p]), { seed: 42 });
  const b = await run_suite(suite('props', [p]), { seed: 42 });
  assert.deepEqual(a.events, b.events);
  assert.equal(a.summary.failed, 1);
});
test('invariants disallow out of range bounds and shrinking options', () => {
  assert.throws(() => strategy_int(20, 10), RangeError);
  assert.throws(() => strategy_list(strategy_int(0, 1), { max_length: 99999 }), RangeError);
  assert.throws(() => property_case('x', strategy_int(0, 1), () => true, { runs: 0 }), RangeError);
});
test('adversarial oversized shrinker respects attempt budget', async () => {
  const p = property_case('bad', {
    draw: () => 99, shrink: x => Array.from({ length: 1000 }, (_, i) => i + 1)
  }, () => false, { runs: 1, max_shrinks: 5 });
  const r = await run_suite(suite('props', [p]));
  assert.equal(r.summary.failed, 1);
  assert.match(r.events[0].detail, /shrinks=5\b/);
});
test('a property with injected resources must fail closed', async () => {
  const p = property_case('with fixture', strategy_int(0, 9), () => true);
  const r = await p.body({ seed: 1, random_int: () => 4 }, 'resource');
  assert.equal(r.passed, false);
  assert.match(r.message, /fixture replay is unsupported/);
});
test('predicate cannot mutate the captured shrink candidate', async () => {
  let original;
  const g = { draw: () => { original = [50, 10]; return original; }, shrink: () => [[10], [0]] };
  const p = property_case('mutate', g, (ctx, x) => { x.push(999); return false; }, { runs: 1, max_shrinks: 2 });
  const r = await run_suite(suite('props', [p]));
  assert.equal(r.summary.failed, 1);
  assert.deepEqual(original, [50, 10]);
});
test('predicate gets no random function: generation owns randomness', async () => {
  const p = property_case('no ambient random', strategy_int(0, 9), ctx => !('random_int' in ctx), { runs: 3 });
  const r = await run_suite(suite('props', [p]));
  assert.equal(r.summary.passed, 1);
});


test('pure property with fixture rejects during discovery before acquisition', async () => {
  const { using, fixture } = await import('../reference/test_harness_v1.mjs');
  let hits = 0;
  const root = suite('bad', [using(fixture(() => { hits++; return {}; }, () => { hits++; }), [
    property_case('property', strategy_int(0, 100), () => true)
  ])]);
  await assert.rejects(run_suite(root), /property fixture requires per-attempt acquisition/);
  assert.equal(hits, 0);
});

test('zero matched tests fails closed unless explicitly allowed', async () => {
  const root = suite('filter', [test_case('exists', () => true)]);
  await assert.rejects(run_suite(root, { only: 'filter/missing' }), /no tests matched/);
  const result = await run_suite(root, { only: 'filter/missing', allow_empty: true });
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.filtered, 1);
});
