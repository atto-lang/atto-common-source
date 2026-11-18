// Host-only semantic oracle for Atto std.test v1. Not executable Atto guest code.
// Explicit bounds, branded inert descriptors, immutable result receipts.
const TEST_NODES = new WeakSet();
const FIXTURES = new WeakSet();
const MAX_NODES = 8192, MAX_CASES = 4096, MAX_DEPTH = 64, MAX_FIXTURES = 16;
const MAX_SEGMENT = 256, MAX_FULL_NAME = 2048;

function name_ok(name) {
  return typeof name === "string" && name.trim().length > 0 && name.length <= MAX_SEGMENT;
}
function node_of(value) { const frozen = Object.freeze(value); TEST_NODES.add(frozen); return frozen; }
function suite(name, children) {
  if (!name_ok(name) || !Array.isArray(children)) throw new TypeError("invalid suite");
  return node_of({kind:"suite", name, children:Object.freeze([...children])});
}
function test_case(name, body, options = {}) {
  if (!name_ok(name) || typeof body !== "function" || !options || typeof options !== "object" ||
      ![undefined, true, false].includes(options.requires_pure)) throw new TypeError("invalid case");
  return node_of({kind:"case", name, body, requires_pure:options.requires_pure === true});
}
function skip_case(name, reason) {
  if (!name_ok(name) || typeof reason !== "string" || !reason.trim()) throw new TypeError("invalid skip");
  return node_of({kind:"skip",name,reason});
}
function fixture(acquire, release) {
  if (typeof acquire !== "function" || typeof release !== "function") throw new TypeError("fixture needs acquire/release");
  const frozen = Object.freeze({acquire, release}); FIXTURES.add(frozen); return frozen;
}
function using(fixture_value, children) {
  if (!FIXTURES.has(fixture_value) || !Array.isArray(children)) throw new TypeError("invalid fixture group");
  return node_of({kind:"using",fixture:fixture_value,children:Object.freeze([...children])});
}

function plan(root) {
  const cases=[], seen=new Set();
  const stack=[{node:root, parents:[], fixtures:[], ancestors:new Set(), depth:0}];
  let visited=0;
  while(stack.length) {
    const frame=stack.pop();
    const {node, parents, fixtures, ancestors, depth}=frame;
    if (++visited > MAX_NODES) throw new RangeError("test tree exceeds node budget");
    if (depth > MAX_DEPTH) throw new RangeError("test tree exceeds depth budget");
    if (!node || typeof node !== "object" || !TEST_NODES.has(node)) throw new TypeError("unregistered test descriptor");
    if (ancestors.has(node)) throw new Error("cyclic test tree");
    if (node.kind === "suite" || node.kind === "using") {
      const next_parents=node.kind === "suite" ? [...parents,node.name] : parents;
      const next_fixtures=node.kind === "using" ? [...fixtures,node.fixture] : fixtures;
      if (next_fixtures.length > MAX_FIXTURES) throw new RangeError("test fixture nesting budget exceeded");
      const next_ancestors=new Set(ancestors); next_ancestors.add(node);
      for (let i=node.children.length-1;i>=0;i--) stack.push({
        node:node.children[i], parents:next_parents,fixtures:next_fixtures,
        ancestors:next_ancestors,depth:depth+1
      });
    } else if (node.kind === "case" || node.kind === "skip") {
      const full_name=[...parents,node.name].join("/");
      if (full_name.length > MAX_FULL_NAME) throw new RangeError("test full name budget exceeded");
      if (node.requires_pure && fixtures.length) throw new Error("property fixture requires per-attempt acquisition: "+full_name);
      if (seen.has(full_name)) throw new Error("duplicate test path: "+full_name);
      seen.add(full_name);
      if (cases.length >= MAX_CASES) throw new RangeError("test case budget exceeded");
      cases.push(Object.freeze({full_name,node,fixtures:Object.freeze([...fixtures])}));
    } else throw new TypeError("unknown test descriptor kind");
  }
  return Object.freeze(cases);
}

// FNV-1a 32-bit over UTF-8 test name, seeded by an unsigned 32-bit run seed.
// This is a reproducibility contract, NOT a cryptographically secure PRNG.
function case_seed(seed, name) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || typeof name !== "string") throw new RangeError("invalid seed/name");
  let h=(seed ^ 2166136261) >>> 0;
  for (const byte of new TextEncoder().encode(name)) h=Math.imul(h ^ byte, 16777619)>>>0;
  return h || 0x9e3779b9;
}
function case_context(seed, name) {
  let state=case_seed(seed,name);
  const initial_seed=state;
  const next_u32=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;return state;};
  return Object.freeze({
    full_name:name,seed:initial_seed,
    random_int(min,max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max<min || max-min>0xffffffff)
        throw new RangeError("invalid random range");
      const span=max-min+1, cardinality=0x100000000;
      const limit=Math.floor(cardinality/span)*span;
      let sample;
      do {sample=next_u32();} while(sample>=limit);
      return min+(sample%span);
    },
    expect_equal(actual,expected) {
      // JS oracle uses Object.is, not Atto's typed eq operation.
      if (!Object.is(actual,expected)) throw new Error("expected "+String(expected)+", got "+String(actual));
    },
    fail(message) {throw new Error(String(message));}
  });
}
function error_detail(error) {
  try {return String(error?.message ?? error);} catch {return "<unprintable error>";}
}
function checked_outcome(outcome) {
  if (outcome === undefined || outcome === true) return;
  if (outcome === false) throw new Error("test returned failure");
  if (outcome && typeof outcome === "object" && typeof outcome.passed === "boolean") {
    if (outcome.passed) return;
    throw new Error(typeof outcome.message === "string" && outcome.message ? outcome.message : "test returned failure");
  }
  throw new TypeError("test returned unsupported outcome");
}
async function run_suite(root, options = {}) {
  const list=plan(root);
  if (!options || typeof options !== "object") throw new TypeError("invalid options");
  const only=options.only??"",seed=options.seed??1;
  const fail_fast=options.fail_fast??false,allow_empty=options.allow_empty??false;
  if (typeof only!=="string" || !Number.isInteger(seed) || seed<0 || seed>0xffffffff ||
      typeof fail_fast!=="boolean" || typeof allow_empty!=="boolean") throw new TypeError("invalid options");
  if (!allow_empty && !list.some(entry=>!only||entry.full_name===only)) throw new Error("no tests matched filter");
  const events=[],counts={total:0,passed:0,failed:0,skipped:0,filtered:0};
  for(const entry of list) {
    if (only && entry.full_name!==only) {counts.filtered++;continue;}
    counts.total++;
    if(entry.node.kind==="skip") {
      counts.skipped++;events.push(Object.freeze({status:"SKIP",name:entry.full_name,detail:entry.node.reason}));
      continue;
    }
    const ctx=case_context(seed,entry.full_name), acquired=[], issues=[];
    let phase="acquire";
    try {
      for(const current of entry.fixtures) {
        const value=await current.acquire(ctx);
        acquired.push({fixture:current,value});
      }
      phase="body";
      const outcome=await entry.node.body(ctx,...acquired.map(resource=>resource.value));
      checked_outcome(outcome);
    } catch(error) {issues.push(Object.freeze({phase,detail:error_detail(error)}));}
    finally {
      for(let i=acquired.length-1;i>=0;i--) {
        try {await acquired[i].fixture.release(acquired[i].value,ctx);}
        catch(error) {issues.push(Object.freeze({phase:"release",detail:error_detail(error)}));}
      }
    }
    if(issues.length) {
      counts.failed++;
      events.push(Object.freeze({
        status:"FAIL",name:entry.full_name,
        detail:issues.map(issue=>issue.phase+": "+issue.detail).join("; "),
        issues:Object.freeze(issues)
      }));
      if(fail_fast) break;
    } else {counts.passed++;events.push(Object.freeze({status:"PASS",name:entry.full_name,detail:""}));}
  }
  return Object.freeze({events:Object.freeze(events),summary:Object.freeze(counts)});
}
export {suite,test_case,skip_case,fixture,using,plan,case_seed,case_context,run_suite};
