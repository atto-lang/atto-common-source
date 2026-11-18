// Host-only semantic oracle for the proposed Atto std.test v1.
// This is JavaScript, NOT compiled Atto guest code or production stdlib.
// Runtime services (actor isolation, cancellation, sandbox, coverage) are explicitly out of scope.

function suite(name, children) {
  if (typeof name !== "string" || !name.trim() || !Array.isArray(children)) throw new TypeError("invalid suite");
  return Object.freeze({kind: "suite", name, children: Object.freeze([...children])});
}

function test_case(name, body) {
  if (typeof name !== "string" || !name.trim() || typeof body !== "function") throw new TypeError("invalid case");
  return Object.freeze({kind: "case", name, body});
}

function skip_case(name, reason) {
  if (typeof name !== "string" || !name.trim() || typeof reason !== "string" || !reason.trim()) throw new TypeError("invalid skip");
  return Object.freeze({kind: "skip", name, reason});
}

function fixture(acquire, release) {
  if (typeof acquire !== "function" || typeof release !== "function") throw new TypeError("fixture needs acquire/release");
  return Object.freeze({acquire, release});
}

function using(fixture_value, children) {
  if (!fixture_value || typeof fixture_value.acquire !== "function" || !Array.isArray(children)) throw new TypeError("invalid fixture group");
  return Object.freeze({kind: "using", fixture: fixture_value, children: Object.freeze([...children])});
}

function plan(root) {
  const cases = [], seen = new Set();
  function visit(node, parents, fixtures) {
    if (!node || typeof node !== "object") throw new TypeError("test node required");
    if (node.kind === "suite") {
      for (const child of node.children) visit(child, [...parents, node.name], fixtures);
    } else if (node.kind === "using") {
      for (const child of node.children) visit(child, parents, [...fixtures, node.fixture]);
    } else if (node.kind === "case" || node.kind === "skip") {
      const full_name = [...parents, node.name].join("/");
      if (seen.has(full_name)) throw new Error("duplicate test path: " + full_name);
      seen.add(full_name);
      cases.push(Object.freeze({full_name, node, fixtures: Object.freeze([...fixtures])}));
    } else {
      throw new TypeError("unknown test node");
    }
  }
  visit(root, [], []);
  return Object.freeze(cases);
}

function case_seed(seed, name) {
  let h = (seed >>> 0) ^ 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h || 0x9e3779b9;
}

function case_context(seed, name) {
  let state = case_seed(seed, name);
  return Object.freeze({
    full_name: name,
    seed: state,
    random_int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min > 0xffffffff) throw new RangeError("invalid random range");
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      return min + (state % (max - min + 1));
    },
    expect_equal(actual, expected) {
      if (!Object.is(actual, expected)) throw new Error("expected " + String(expected) + ", got " + String(actual));
    },
    fail(message) { throw new Error(message); }
  });
}

async function run_suite(root, options = {}) {
  const list = plan(root);
  const only = options.only ?? "";
  const seed = options.seed ?? 1;
  const fail_fast = options.fail_fast ?? false;
  if (typeof only !== "string" || !Number.isSafeInteger(seed) || typeof fail_fast !== "boolean") throw new TypeError("invalid options");
  const events = [], counts = {total: 0, passed: 0, failed: 0, skipped: 0, filtered: 0};
  for (const entry of list) {
    if (only && entry.full_name !== only) { counts.filtered++; continue; }
    counts.total++;
    if (entry.node.kind === "skip") {
      counts.skipped++; events.push({status:"SKIP",name:entry.full_name,detail:entry.node.reason}); continue;
    }
    const context = case_context(seed, entry.full_name);
    const acquired = [];
    const errors = [];
    try {
      for (const current of entry.fixtures) {
        const value = await current.acquire(context);
        acquired.push({fixture: current, value});
      }
      const outcome = await entry.node.body(context, ...acquired.map(item => item.value));
      if (outcome === false || (outcome && typeof outcome === "object" && outcome.passed === false))
        throw new Error(outcome && outcome.message ? String(outcome.message) : "test returned failure");
    } catch (error) {
      errors.push("body/acquire: " + String(error && error.message || error));
    } finally {
      for (let i = acquired.length - 1; i >= 0; i--) {
        try { await acquired[i].fixture.release(acquired[i].value, context); }
        catch (error) { errors.push("release: " + String(error && error.message || error)); }
      }
    }
    if (errors.length) {
      counts.failed++; events.push({status:"FAIL",name:entry.full_name,detail:errors.join("; ")});
      if (fail_fast) break;
    } else {
      counts.passed++; events.push({status:"PASS",name:entry.full_name,detail:""});
    }
  }
  return Object.freeze({events:Object.freeze(events), summary:Object.freeze(counts)});
}

export { suite, test_case, skip_case, fixture, using, plan, case_seed, case_context, run_suite };
