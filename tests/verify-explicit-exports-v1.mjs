#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";

const contractPath = new URL("../contracts/explicit-exports-v1.json", import.meta.url);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const allowedScopes = new Set(["file", "pkg", "public"]);
const visibilityRank = new Map([["private", -1], ["default", -1], ["file", 0], ["pkg", 1], ["public", 2]]);
const typeKinds = new Set(["class","actor","type","trait","interface","contract","struct","enum","module"]);
const valueKinds = new Set(["fnc","routine","const","val","let","symbol"]);

function namespaceOf(kind) {
  if (typeKinds.has(kind)) return kind === "module" ? "module" : "type";
  if (valueKinds.has(kind)) return "value";
  throw new Error("unknown declaration kind: " + kind);
}

function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}

function parseVisibilityToken(token) {
  const aliases = contract.scope_aliases;
  if (aliases[token]) return aliases[token];
  if (token === "private") return "private";
  return null;
}

function parseModifierHeader(source) {
  const tokens = source.trim().split(/\s+/);
  let defineCount = 0;
  const vis = [];
  let kind = null;
  for (const token of tokens) {
    if (token === "define") {
      defineCount++;
      continue;
    }
    const v = parseVisibilityToken(token);
    if (v) {
      vis.push(v);
      continue;
    }
    if (["class","actor","type","trait","interface","contract","struct","enum","module"].includes(token)) {
      kind = token;
      break;
    }
  }
  if (defineCount !== 1) fail("INVALID_DEFINE_COUNT");
  if (vis.length > 1) fail("DUPLICATE_VISIBILITY");
  if (!kind) fail("MISSING_DECLARATION_KIND");
  return {kind, visibility:vis[0] ?? "default"};
}

function bindingKey(b) {
  return [b.local, b.external, b.scope].join("\0");
}

function canonicalBindings(bindings) {
  return [...bindings].sort((a,b) =>
    a.external.localeCompare(b.external) ||
    a.local.localeCompare(b.local) ||
    a.scope.localeCompare(b.scope)
  );
}

function resolve(items) {
  let declarationSeen = false;
  const decls = [];
  const imports = [];
  const exports = [];

  for (const item of items) {
    if (item.op === "export") {
      exports.push(item);
      continue;
    }
    if (item.op === "import") {
      if (declarationSeen) fail("IMPORT_AFTER_DECLARATION");
      imports.push(item);
      continue;
    }
    if (item.op === "decl") {
      declarationSeen = true;
      if (!visibilityRank.has(item.visibility)) fail("INVALID_VISIBILITY");
      decls.push(item);
      continue;
    }
    fail("UNKNOWN_ITEM");
  }

  const byName = new Map();
  for (const d of decls) {
    const key = d.name;
    const list = byName.get(key) ?? [];
    if (list.some(x => namespaceOf(x.kind) === namespaceOf(d.kind) && !(x.kind === "fnc" && d.kind === "fnc"))) {
      fail("DUPLICATE_LOCAL_SYMBOL");
    }
    list.push(d);
    byName.set(key, list);
  }

  const importedByName = new Map();
  for (const i of imports) {
    const list = importedByName.get(i.name) ?? [];
    list.push(i);
    importedByName.set(i.name, list);
  }

  const bindings = [];
  const bindingKeys = new Set();

  function addBinding(binding) {
    const existing = bindings.find(b => b.external === binding.external);
    if (existing && existing.local !== binding.local) fail("EXPORT_ALIAS_COLLISION");
    if (existing && existing.local === binding.local && existing.scope !== binding.scope) fail("SCOPE_CONFLICT");
    const key = bindingKey(binding);
    if (!bindingKeys.has(key)) {
      bindingKeys.add(key);
      bindings.push(binding);
    }
  }

  for (const d of decls) {
    if (["file","pkg","public"].includes(d.visibility)) {
      addBinding({local:d.name, external:d.name, scope:d.visibility});
    }
  }

  for (const ex of exports) {
    if (!allowedScopes.has(ex.scope)) fail("INVALID_EXPORT_SCOPE");
    let candidates = byName.get(ex.name) ?? [];
    if (ex.kind) {
      const typed = candidates.filter(d => d.kind === ex.kind);
      if (typed.length === 0) {
        if (candidates.length > 0) fail("EXPORT_KIND_MISMATCH");
        if (importedByName.has(ex.name)) fail("IMPORTED_LOCAL_EXPORT");
        fail("UNKNOWN_EXPORT");
      }
      candidates = typed;
    } else {
      if (candidates.length === 0) {
        if (importedByName.has(ex.name)) fail("IMPORTED_LOCAL_EXPORT");
        fail("UNKNOWN_EXPORT");
      }
      const logical = new Set(candidates.map(d => namespaceOf(d.kind) + ":" + d.kind));
      if (logical.size > 1) fail("AMBIGUOUS_EXPORT");
    }
    if (candidates.length !== 1) fail("AMBIGUOUS_EXPORT");
    const d = candidates[0];
    if (d.visibility === "private") fail("PRIVATE_EXPORT_CONFLICT");
    if (["file","pkg","public"].includes(d.visibility) && d.visibility !== ex.scope) fail("SCOPE_CONFLICT");
    addBinding({local:d.name, external:ex.external ?? d.name, scope:ex.scope});
  }

  const effectiveScope = new Map();
  for (const d of decls) {
    let rank = visibilityRank.get(d.visibility);
    for (const b of bindings) {
      if (b.local === d.name) rank = Math.max(rank, visibilityRank.get(b.scope));
    }
    effectiveScope.set(d.name, rank);
  }

  for (const d of decls) {
    const dBindings = bindings.filter(b => b.local === d.name);
    for (const b of dBindings) {
      for (const ref of d.signatureRefs ?? []) {
        if (!effectiveScope.has(ref)) fail("UNKNOWN_SIGNATURE_REF");
        if (effectiveScope.get(ref) < visibilityRank.get(b.scope)) fail("VISIBILITY_LEAK");
      }
    }
  }

  return {bindings:canonicalBindings(bindings)};
}

assert.equal(contract.schema, "oreslang.explicit-exports.v1");
assert.equal(contract.version, 1);
assert.deepEqual(contract.canonical_scopes, ["file","pkg","public"]);
assert.equal(contract.native_exposure, "separate");
assert.equal(contract.local_export_resolves_imports, false);
assert.equal(contract.export_transparent_to_import_prelude, true);

for (const [spell, scope] of Object.entries(contract.scope_aliases)) {
  assert.ok(["file","pkg","public"].includes(scope), "bad scope alias: " + spell);
}

for (const c of contract.modifier_cases) {
  try {
    const got = parseModifierHeader(c.source);
    if (c.error) assert.fail(c.source + " expected " + c.error);
    assert.deepEqual(got, c.expect, c.source);
  } catch (e) {
    if (!c.error) throw e;
    assert.equal(e.code, c.error, c.source);
  }
}

let fixed = 0;
for (const c of contract.cases) {
  try {
    const got = resolve(c.items);
    if (c.error) assert.fail(c.name + " expected " + c.error);
    assert.deepEqual(got, {bindings:canonicalBindings(c.expect.bindings)}, c.name);
  } catch (e) {
    if (!c.error) throw e;
    assert.equal(e.code, c.error, c.name);
  }
  fixed++;
}

// Property: moving a local export before/after its declaration cannot change the resolved interface.
for (const scope of ["file","pkg","public"]) {
  const before = resolve([
    {op:"export",name:"X",kind:"class",scope},
    {op:"decl",name:"X",kind:"class",visibility:"default"}
  ]);
  const after = resolve([
    {op:"decl",name:"X",kind:"class",visibility:"default"},
    {op:"export",name:"X",kind:"class",scope}
  ]);
  assert.deepEqual(before, after, "order independence at scope " + scope);
}

// Property: arbitrary runs of export metadata are transparent to the import prelude.
for (let n = 0; n <= 32; n++) {
  const prefix = Array.from({length:n}, (_,i) => ({op:"export",name:"X"+i,kind:"class",scope:"public"}));
  const decls = Array.from({length:n}, (_,i) => ({op:"decl",name:"X"+i,kind:"class",visibility:"default"}));
  const got = resolve([...prefix, {op:"import",name:"Dep",kind:"class"}, ...decls]);
  assert.equal(got.bindings.length, n);
}

// Property: once a real declaration appears, later imports fail regardless of surrounding exports.
for (let n = 0; n <= 16; n++) {
  const around = Array.from({length:n}, (_,i) => ({op:"export",name:"X",kind:"class",scope:"public"}));
  let code = null;
  try {
    resolve([
      {op:"decl",name:"X",kind:"class",visibility:"default"},
      ...around,
      {op:"import",name:"Dep",kind:"class"}
    ]);
  } catch (e) { code = e.code; }
  assert.equal(code, "IMPORT_AFTER_DECLARATION");
}

// Property: no source export can imply target-native exposure in this contract.
assert.equal(contract.native_exposure, "separate");

console.log(JSON.stringify({
  status:"PASS",
  schema:contract.schema,
  fixed_cases:fixed,
  modifier_cases:contract.modifier_cases.length,
  order_independence_scopes:3,
  export_prelude_prefix_cases:33,
  declaration_closes_prelude_cases:17,
  total_assertion_groups:fixed + contract.modifier_cases.length + 3 + 33 + 17 + 1
}));
