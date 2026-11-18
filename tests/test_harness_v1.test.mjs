import test from "node:test";
import assert from "node:assert/strict";
import { suite, test_case, skip_case, fixture, using, plan, case_context, run_suite } from "../reference/test_harness_v1.mjs";

test("discovery never acquires fixtures or invokes case bodies", async () => {
  let hits = 0;
  const s = suite("lazy", [using(fixture(() => { hits++; return 1; }, () => { hits++; }),
    [test_case("one", () => { hits++; })])]);
  assert.equal(plan(s).length, 1);
  assert.equal(hits, 0);
  const r = await run_suite(s);
  assert.equal(r.summary.passed, 1);
  assert.equal(hits, 3);
});

test("each case receives independently acquired mutable fixture state", async () => {
  const seen = [];
  let next = 0;
  const s = suite("counter", [using(fixture(
    () => ({ value: 0, id: ++next }),
    value => { seen.push(value.id); }
  ), [
    test_case("first", (t, value) => { t.expect_equal(value.value, 0); value.value = 12; }),
    test_case("second", (t, value) => { t.expect_equal(value.value, 0); value.value = 34; })
  ])]);
  const r = await run_suite(s);
  assert.deepEqual(r.summary, { total: 2, passed: 2, failed: 0, skipped: 0, filtered: 0 });
  assert.deepEqual(seen, [1, 2]);
});

test("nested fixture release is LIFO and occurs even when body fails", async () => {
  const events = [];
  const a = fixture(() => { events.push("acquire-a"); return 1; }, () => events.push("release-a"));
  const b = fixture(() => { events.push("acquire-b"); return 2; }, () => events.push("release-b"));
  const s = suite("scope", [using(a, [using(b, [
    test_case("failure", () => { throw Error("bad assertion"); })
  ])])]);
  const r = await run_suite(s);
  assert.equal(r.summary.failed, 1);
  assert.match(r.events[0].detail, /bad assertion/);
  assert.deepEqual(events, ["acquire-a", "acquire-b", "release-b", "release-a"]);
});

test("failed fixture acquisition unwinds only acquired resources", async () => {
  const events = [];
  const s = suite("scope", [
    using(fixture(() => { events.push("acquire-a"); return 1; }, () => events.push("release-a")), [
      using(fixture(() => { throw Error("acquire-b"); }, () => events.push("release-b")), [
        test_case("a", () => assert.fail("must not run"))
      ])
    ])
  ]);
  const r = await run_suite(s);
  assert.equal(r.summary.failed, 1);
  assert.deepEqual(events, ["acquire-a", "release-a"]);
});

test("release errors are preserved, not converted to PASS", async () => {
  const s = suite("release", [using(fixture(() => "x", () => { throw Error("release failed"); }), [
    test_case("ok-body", () => {})
  ])]);
  const r = await run_suite(s);
  assert.equal(r.summary.failed, 1);
  assert.match(r.events[0].detail, /release failed/);
});

test("duplicate full paths fail before any fixture is acquired", async () => {
  let invokes = 0;
  const s = suite("name", [
    test_case("same", () => { invokes++; }),
    suite("inner", [test_case("a", () => { invokes++; })]),
    test_case("same", () => { invokes++; })
  ]);
  await assert.rejects(run_suite(s), /duplicate test path/);
  assert.equal(invokes, 0);
});

test("exact full-name filtering preserves skip accounting", async () => {
  const s = suite("name", [
    test_case("one", () => {}),
    skip_case("two", "pending guest ABI"),
    test_case("three", () => {})
  ]);
  const r = await run_suite(s, { only: "name/two" });
  assert.deepEqual(r.summary, { total: 1, passed: 0, failed: 0, skipped: 1, filtered: 2 });
  assert.equal(r.events[0].status, "SKIP");
});

test("fail fast ends after one failure", async () => {
  let visited = 0;
  const s = suite("fail", [
    test_case("one", () => { visited++; throw Error("first"); }),
    test_case("two", () => { visited++; })
  ]);
  const r = await run_suite(s, { fail_fast: true });
  assert.equal(visited, 1);
  assert.deepEqual(r.summary, { total: 1, passed: 0, failed: 1, skipped: 0, filtered: 0 });
});

test("per-test seed is deterministic and independent of visitation order", async () => {
  const samples = new Map();
  const c = name => test_case(name, ctx => { samples.set(ctx.full_name, [ctx.seed, ctx.random_int(0, 100000)]); });
  await run_suite(suite("seed", [c("a"), c("b")]), { seed: 42 });
  const first = new Map(samples);
  await run_suite(suite("seed", [c("b"), c("a")]), { seed: 42 });
  assert.deepEqual(samples, first);
  assert.notEqual(samples.get("seed/a")[0], samples.get("seed/b")[0]);
});

test("async fixture acquisition, case body, and release are awaited", async () => {
  const order = [];
  const s = suite("async", [using(fixture(
    async () => { await Promise.resolve(); order.push("acquire"); return 9; },
    async () => { await Promise.resolve(); order.push("release"); }
  ), [test_case("one", async (ctx, v) => { await Promise.resolve(); ctx.expect_equal(v, 9); order.push("body"); })])]);
  const r = await run_suite(s);
  assert.equal(r.summary.passed, 1);
  assert.deepEqual(order, ["acquire", "body", "release"]);
});

test("returning explicit failure is never treated as success", async () => {
  const r = await run_suite(suite("legacy", [
    test_case("false", () => false),
    test_case("outcome", () => ({ passed: false, message: "legacy failure" }))
  ]));
  assert.equal(r.summary.failed, 2);
  assert.match(r.events[1].detail, /legacy failure/);
});
