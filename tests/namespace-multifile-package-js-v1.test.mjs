#!/usr/bin/env node
// Reference-only namespace model. Does NOT compile or execute Oreslang code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const spec = JSON.parse(fs.readFileSync(new URL("../contracts/namespace-multifile-package-js-v1.json", import.meta.url), "utf8"));
const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const forbidden = new Set(["__root__", "__proto__", "prototype", "constructor"]);
const scopes = new Set(["public", "pkg", "file", "private"]);
const validId = x => typeof x === "string" && ident.test(x) && !forbidden.has(x);
const clone = x => structuredClone(x);
function fail(code) { throw Error(code); }
function goodPath(path) {
  return typeof path === "string" && path.endsWith(".ores") &&
    path.length <= 4096 && !path.startsWith("/") && !path.includes("\\") &&
    path.split("/").every(p => p && p !== "." && p !== ".." && /^[a-zA-Z0-9_.-]+$/.test(p));
}
function graph(doc) {
  if (doc.syntax?.import !== "import ns a from 'pkg:foo';") fail("WRONG_NS_IMPORT_SYNTAX");
  const packages = new Map(), ids = new Set(), physical = new Set(), namespaces = new Map();
  for (const pkg of doc.packages) {
    if (!pkg.id || packages.has(pkg.id)) fail("DUPLICATE_PACKAGE_INSTANCE");
    packages.set(pkg.id, { ...pkg, aliases: new Map() });
  }
  for (const pkg of packages.values()) {
    for (const [alias, pin] of Object.entries(pkg.dependencies || {})) {
      if (!validId(alias) || pkg.aliases.has(alias)) fail("INVALID_DEPENDENCY_ALIAS");
      if (!packages.has(pin)) fail("UNKNOWN_OR_UNPINNED_DEPENDENCY");
      pkg.aliases.set(alias, pin);
    }
  }
  for (const f of doc.files) {
    if (!packages.has(f.pkg)) fail("UNKNOWN_PACKAGE_OWNER");
    if (!f.id || ids.has(f.id)) fail("DUPLICATE_SOURCE_ID");
    if (!goodPath(f.path)) fail("INVALID_SOURCE_PATH");
    if (physical.has(f.pkg + "\0" + f.path)) fail("DUPLICATE_SOURCE_PATH");
    ids.add(f.id);
    physical.add(f.pkg + "\0" + f.path);
    if (!validId(f.ns)) fail("MISSING_OR_INVALID_NAMESPACE_HEADER");
    if (f.modules?.length || f.namespace_headers?.length > 1) fail("MODULE_IS_NOT_NAMESPACE_FRAGMENT");
    const key = f.pkg + "\0" + f.ns;
    let ns = namespaces.get(key);
    if (!ns) {
      ns = { pkg:f.pkg, name:f.ns, files:new Set(), members:[] };
      namespaces.set(key, ns);
    }
    ns.files.add(f.id);
    for (const m of f.declarations || []) {
      if (!validId(m.name) || m.kind !== "fnc" || !Number.isSafeInteger(m.arity) ||
          m.arity < 0 || !scopes.has(m.scope)) fail("INVALID_NAMESPACE_DECLARATION");
      for (const old of ns.members) {
        if (old.name !== m.name) continue;
        // Private/file scope remains unique to its physical source fragment.
        if (old.file !== f.id &&
            (old.scope === "private" || old.scope === "file" ||
             m.scope === "private" || m.scope === "file")) continue;
        if (old.kind !== m.kind) fail("NAMESPACE_KIND_COLLISION");
        if (old.arity === m.arity) fail("DUPLICATE_NAMESPACE_OVERLOAD");
      }
      ns.members.push({...m, file:f.id, path:f.path});
    }
  }
  return { packages, namespaces };
}
function selected(doc, importer, alias, nsName, file = null) {
  const g = graph(doc), pkg = g.packages.get(importer);
  if (!pkg) fail("UNKNOWN_IMPORTING_PACKAGE");
  if (!validId(alias) || !pkg.aliases.has(alias)) fail("UNDECLARED_PACKAGE_ALIAS");
  if (!validId(nsName)) fail("INVALID_IMPORTED_NAMESPACE");
  const target = pkg.aliases.get(alias);
  const ns = g.namespaces.get(target + "\0" + nsName);
  if (!ns) fail("NAMESPACE_NOT_IN_SELECTED_PACKAGE");
  return ns.members.filter(m =>
    m.scope === "public" ||
    (m.scope === "pkg" && importer === target) ||
    (m.scope === "file" && importer === target && file === m.file)
  ).map(m => m.name).sort();
}
function emitEsmEntry(doc, pkg, nsName) {
  const g = graph(doc), ns = g.namespaces.get(pkg + "\0" + nsName);
  if (!ns) fail("NAMESPACE_NOT_IN_SELECTED_PACKAGE");
  const members = ns.members.filter(m => m.scope === "public")
    .sort((a,b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const seen = new Set();
  for (const m of members) {
    if (seen.has(m.name)) fail("JS_NAMESPACE_OVERLOAD_DISPATCH_REQUIRED");
    seen.add(m.name);
  }
  return members.map(m => "export { __ores_" + m.name + " as " + m.name + " } from " +
    JSON.stringify("../" + m.path.replace(/\.ores$/, ".mjs")) + ";").join("\n") + "\n";
}
function modified(id, fn) {
  const d = clone(spec), f = d.files.find(x => x.id === id);
  assert.ok(f); fn(f,d); return d;
}

test("ten files give three package-owned namespaces a=3,b=4,c=3", () => {
  const g = graph(clone(spec));
  assert.equal(spec.files.length, 10);
  assert.deepEqual([...g.namespaces.values()].map(ns => [ns.name,ns.files.size])
    .sort((a,b)=>a[0].localeCompare(b[0])), [["a",3],["b",4],["c",3]]);
});
test("one namespace import from pinned foo resolves all three public declarations", () => {
  const i=spec.imports[0];
  assert.equal(i.specifier, "pkg:" + i.alias);
  assert.deepEqual(selected(spec,i.importer,i.alias,i.name),i.expected);
});
test("same-package namespace import includes package-scoped members only for same package", () => {
  const i=spec.imports[1];
  assert.deepEqual(selected(spec,i.importer,i.alias,i.name),i.expected);
});
test("file visibility requires exact package and exact physical file", () => {
  assert.deepEqual(selected(spec,"foo@sha:1111","foo","a","u7"),
    ["add","aggregate","double","file_only","internal"]);
  assert.deepEqual(selected(spec,"app@sha:2222","foo","a","u7"),["add","aggregate","double"]);
});
test("same header spelling in two packages cannot merge namespace identity", () => {
  const d=modified("u7",f=>{ f.pkg="app@sha:2222"; });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","double"]);
  assert.deepEqual([...graph(d).namespaces.keys()].filter(k=>k.endsWith("\0a")).sort(),
    ["app@sha:2222\0a","foo@sha:1111\0a"]);
});
test("two separately installed versions of foo do not merge namespace fragments", () => {
  const d=modified("u7",f=>{ f.pkg="foo@sha:3333"; });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","double"]);
  assert.deepEqual(selected(d,"foo@sha:3333","foo","a"),["aggregate","internal"]);
});
test("move a namespace file across folders without changing declared namespace", () => {
  const d=modified("u5",f=>{ f.path="src/far/nested/math.ores"; });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","aggregate","double"]);
});
test("changing the header changes namespace membership even if file path is unchanged", () => {
  const d=modified("u7",f=>{ f.ns="b"; });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","double"]);
  assert.ok(selected(d,"app@sha:2222","foo","b").includes("aggregate"));
});
test("existing define module declarations must not be merged as namespaces", () => {
  assert.throws(()=>graph(modified("u5",f=>{ f.modules=[{name:"a"}]; })),
    /MODULE_IS_NOT_NAMESPACE_FRAGMENT/);
});
test("one source file cannot silently declare two flat namespaces", () => {
  assert.throws(()=>graph(modified("u5",f=>{ f.namespace_headers=["a","b"]; })),
    /MODULE_IS_NOT_NAMESPACE_FRAGMENT/);
});
test("missing or dotted source namespace header fails closed in the model", () => {
  assert.throws(()=>graph(modified("u5",f=>{ delete f.ns; })),/MISSING_OR_INVALID_NAMESPACE_HEADER/);
  assert.throws(()=>graph(modified("u5",f=>{ f.ns="a.b"; })),/MISSING_OR_INVALID_NAMESPACE_HEADER/);
});
test("unknown package alias cannot fallback to global namespace", () => {
  assert.throws(()=>selected(spec,"app@sha:2222","missing","a"),/UNDECLARED_PACKAGE_ALIAS/);
});
test("missing namespace in the selected package cannot resolve from another package", () => {
  assert.throws(()=>selected(spec,"app@sha:2222","foo","not_declared"),/NAMESPACE_NOT_IN_SELECTED_PACKAGE/);
});
test("missing pinned dependency instance is rejected before namespace linking", () => {
  const d=clone(spec);
  d.packages[1].dependencies.foo="foo@sha:missing";
  assert.throws(()=>graph(d),/UNKNOWN_OR_UNPINNED_DEPENDENCY/);
});
test("same visible name and overload arity across files is a collision", () => {
  assert.throws(()=>graph(modified("u7",f=>{ f.declarations[0].name="double"; })),
    /DUPLICATE_NAMESPACE_OVERLOAD/);
});
test("distinct overload arities preserve source identity but require JS dispatcher", () => {
  const d=modified("u7",f=>{ f.declarations[0].name="double"; f.declarations[0].arity=2; });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","double","double"]);
  assert.throws(()=>emitEsmEntry(d,"foo@sha:1111","a"),/JS_NAMESPACE_OVERLOAD_DISPATCH_REQUIRED/);
});
test("private helper spellings may repeat in different namespace files", () => {
  const d=modified("u7",f=>{ f.declarations.push({name:"hidden",kind:"fnc",arity:0,scope:"private"}); });
  assert.deepEqual(selected(d,"app@sha:2222","foo","a"),["add","aggregate","double"]);
  assert.ok(!emitEsmEntry(d,"foo@sha:1111","a").includes("hidden"));
});
test("generated ESM namespace entry only explicitly reexports public declarations", () => {
  const code=emitEsmEntry(spec,"foo@sha:1111","a");
  for (const name of ["add","aggregate","double"]) assert.ok(code.includes(" as "+name+" }"));
  for (const name of ["hidden","internal","file_only"]) assert.ok(!code.includes(name));
  assert.equal(code.split("\n").filter(Boolean).length,3);
  assert.ok(!code.includes("export *"));
});
test("generated ESM namespace entry is deterministic across source ordering", () => {
  const d=clone(spec); d.files.reverse();
  assert.equal(emitEsmEntry(d,"foo@sha:1111","a"),emitEsmEntry(spec,"foo@sha:1111","a"));
});
test("bad source paths reject before constructing ESM relative module specifiers", () => {
  for (const path of ["../bad.ores","src/../bad.ores","/tmp/bad.ores","src\\bad.ores","src//bad.ores","src/good.js"])
    assert.throws(()=>graph(modified("u5",f=>{ f.path=path; })),/INVALID_SOURCE_PATH/);
});
test("duplicate source IDs and duplicate physical paths reject", () => {
  assert.throws(()=>graph(modified("u6",f=>{ f.id="u5"; })),/DUPLICATE_SOURCE_ID/);
  assert.throws(()=>graph(modified("u6",f=>{ f.path="src/compute/math.ores"; })),/DUPLICATE_SOURCE_PATH/);
});
test("compiler synthetic root cannot be used as user namespace header", () => {
  assert.throws(()=>graph(modified("u5",f=>{ f.ns="__root__"; })),/MISSING_OR_INVALID_NAMESPACE_HEADER/);
});
test("retargeting alias to other package version cannot silently resolve old module", () => {
  const d=clone(spec);d.packages[1].dependencies.foo="foo@sha:3333";
  assert.throws(()=>selected(d,"app@sha:2222","foo","a"),/NAMESPACE_NOT_IN_SELECTED_PACKAGE/);
});
