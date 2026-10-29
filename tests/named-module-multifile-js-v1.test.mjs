#!/usr/bin/env node
// SOURCE-FREE contract model only. Does NOT execute an Oreslang compiler.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const spec = JSON.parse(fs.readFileSync(new URL("../contracts/named-module-multifile-js-v1.json", import.meta.url), "utf8"));
const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
const scopes = new Set(["public", "pkg", "file", "private"]);
const forbidden = new Set(["__proto__", "prototype", "constructor", "__root__"]);
function die(code) { throw new Error(code); }
function validId(name) { return typeof name === "string" && ident.test(name) && !forbidden.has(name); }
function sourcePath(path) {
  return typeof path === "string" && path.endsWith(".ores") && !path.startsWith("/") &&
    !path.includes("\\") && path.length <= 4096 &&
    path.split("/").every(x => x && x !== "." && x !== ".." && /^[A-Za-z0-9_.-]+$/.test(x));
}
function copy(data) { return structuredClone(data); }
function compileGraph(input) {
  const packages = new Map();
  for (const pkg of input.package_instances) {
    if (!pkg.id || packages.has(pkg.id)) die("PACKAGE_INSTANCE_DUPLICATE");
    packages.set(pkg.id, pkg);
  }
  for (const pkg of packages.values()) {
    const aliases = new Map();
    for (const [alias, target] of Object.entries(pkg.dependencies ?? {})) {
      if (!validId(alias) || aliases.has(alias)) die("DEPENDENCY_ALIAS_INVALID");
      if (!packages.has(target)) die("DEPENDENCY_INSTANCE_MISSING");
      aliases.set(alias, target);
    }
    pkg.aliases = aliases;
  }
  const modules = new Map(), sourceIds = new Map(), paths = new Map();
  for (const file of input.files) {
    if (!packages.has(file.pkg)) die("UNKNOWN_PACKAGE_INSTANCE");
    if (!file.id || sourceIds.has(file.id)) die("DUPLICATE_SOURCE_UNIT");
    if (!sourcePath(file.path)) die("INVALID_SOURCE_PATH");
    const canonicalPath = file.pkg + "\0" + file.path;
    if (paths.has(canonicalPath)) die("DUPLICATE_PHYSICAL_SOURCE");
    sourceIds.set(file.id, file);
    paths.set(canonicalPath, file);
    const seenModules = new Set();
    for (const part of file.modules ?? []) {
      if (!validId(part.name) || !scopes.has(part.scope)) die("INVALID_MODULE_FRAGMENT");
      if (seenModules.has(part.name)) die("DUPLICATE_FILE_MODULE");
      seenModules.add(part.name);
      const key = file.pkg + "\0" + part.name;
      let module = modules.get(key);
      if (!module) {
        module = {pkg:file.pkg, name:part.name, scope:part.scope, members:[], fileIds:new Set()};
        modules.set(key,module);
      } else if (module.scope !== part.scope) die("MODULE_SCOPE_CONFLICT");
      else if (part.scope !== "public" && part.scope !== "pkg") die("PRIVATE_MULTIFILE_MERGE_DENIED");
      module.fileIds.add(file.id);
      for (const member of part.members ?? []) {
        if (!validId(member.name) || !scopes.has(member.scope) ||
            member.kind !== "fnc" || !Number.isSafeInteger(member.arity) || member.arity < 0)
          die("INVALID_DECLARATION");
        for (const old of module.members) {
          if (old.name !== member.name) continue;
          // A private/file-scoped helper in a different fragment is NOT the
          // same logical module export binding; preserve its lexical identity.
          if (old.fileId !== file.id &&
              (["private","file"].includes(old.scope) || ["private","file"].includes(member.scope)))
            continue;
          if (old.kind !== member.kind) die("BINDING_KIND_CONFLICT");
          if (old.arity === member.arity) die("DUPLICATE_OVERLOAD_IDENTITY");
        }
        module.members.push({...member, fileId:file.id, path:file.path});
      }
    }
  }
  return {modules, packages};
}
function selected(input, importer, alias, moduleName, fromFile = null) {
  const graph = compileGraph(input);
  const pkg = graph.packages.get(importer);
  if (!pkg) die("UNKNOWN_IMPORTER");
  if (!validId(alias) || !pkg.aliases.has(alias)) die("UNDECLARED_PACKAGE_ALIAS");
  const target = pkg.aliases.get(alias);
  const module = graph.modules.get(target + "\0" + moduleName);
  if (!module) die("MISSING_SELECTED_MODULE");
  if (target !== importer && module.scope !== "public") die("HIDDEN_SELECTED_MODULE");
  if (module.scope === "file" || module.scope === "private") die("PRIVATE_MODULE_IMPORT_DENIED");
  return module.members.filter(m =>
    m.scope === "public" ||
    (m.scope === "pkg" && target === importer) ||
    (m.scope === "file" && target === importer && fromFile === m.fileId)
  ).map(m => m.name).sort();
}
function esmEntry(input, packageId, moduleName) {
  const graph = compileGraph(input);
  const module = graph.modules.get(packageId + "\0" + moduleName);
  if (!module || module.scope !== "public") die("NO_PUBLIC_ESM_MODULE");
  const exported = module.members.filter(m => m.scope === "public")
    .sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path));
  const names = new Set();
  for (const m of exported) {
    if (names.has(m.name)) die("JS_EXPORT_OVERLOAD_NEEDS_DISPATCH");
    names.add(m.name);
  }
  return exported.map(m => {
    const outPath = "./" + m.path.replace(/^src\//, "").replace(/\.ores$/, ".mjs");
    // Reference entry assumes the code generator owns '__ores_' local bindings.
    return "export { __ores_" + m.name + " as " + m.name + " } from " + JSON.stringify(outPath) + ";";
  }).join("\n") + "\n";
}
function mutateFile(sourceId, callback) {
  const changed = copy(spec);
  const file = changed.files.find(f=>f.id === sourceId);
  assert.ok(file);
  callback(file, changed);
  return changed;
}
test("ten physical units aggregate into exactly three modules", () => {
  const graph = compileGraph(copy(spec));
  assert.equal(spec.files.length, 10);
  assert.deepEqual([...graph.modules.values()].map(m=>[m.name,m.fileIds.size]).sort((a,b)=>a[0].localeCompare(b[0])),
    [["api",3],["compute",3],["data",4]]);
});
test("one pinned cross-package module import resolves all public fragment members", () => {
  const q = spec.consumer_import;
  assert.deepEqual(selected(spec,q.from,q.alias,q.module),q.expect);
});
test("same package import gets package-scoped but not file/private members", () => {
  const q = spec.same_package_import;
  assert.deepEqual(selected(spec,q.from,q.alias,q.module),q.expect);
});
test("source namespace header is metadata, not the module aggregation key", () => {
  const changed = mutateFile("m5", f=>{f.source_namespace="arbitrary_distinct_header";});
  assert.deepEqual(selected(changed, "consumer@sha:2222","analytics","compute"),spec.consumer_import.expect);
});
test("unlisted/undeclared dependency aliases cannot act as package selectors", () => {
  assert.throws(()=>selected(spec,"consumer@sha:2222","missing","compute"),/UNDECLARED_PACKAGE_ALIAS/);
});
test("the other installed version cannot join module fragments of this package", () => {
  const changed = mutateFile("m7",f=>{f.pkg="analytics@sha:3333";});
  assert.deepEqual(selected(changed,"consumer@sha:2222","analytics","compute"),["add","double"]);
  assert.deepEqual(selected(changed,"analytics@sha:3333","analytics","compute"),["aggregate","internal"]);
});
test("module scope conflict is fatal even if final visibility would be public", () => {
  const changed = mutateFile("m7",f=>{f.modules[0].scope="pkg";});
  assert.throws(()=>compileGraph(changed),/MODULE_SCOPE_CONFLICT/);
});
test("same public function overload identity from different files is rejected", () => {
  const changed = mutateFile("m7",f=>{f.modules[0].members[0].name="double";});
  assert.throws(()=>compileGraph(changed),/DUPLICATE_OVERLOAD_IDENTITY/);
});
test("function overloads of different arity remain distinct in source graph", () => {
  const changed = mutateFile("m7",f=>{f.modules[0].members[0].name="double";f.modules[0].members[0].arity=2;});
  assert.deepEqual(selected(changed,"consumer@sha:2222","analytics","compute"),["add","double","double"]);
  assert.throws(()=>esmEntry(changed,"analytics@sha:1111","compute"),/JS_EXPORT_OVERLOAD_NEEDS_DISPATCH/);
});
test("file and private declarations do not escape through the public ESM facade", () => {
  const js=esmEntry(spec,"analytics@sha:1111","compute");
  assert.ok(js.includes("export { __ores_add as add }"));
  assert.ok(js.includes("export { __ores_double as double }"));
  assert.ok(js.includes("export { __ores_aggregate as aggregate }"));
  for (const blocked of ["file_only","internal","hidden"]) assert.ok(!js.includes(blocked));
  assert.equal(js.split("\n").filter(Boolean).length,3);
  assert.ok(!js.includes("export *"));
});
test("generated ESM output is independent of file enumeration order", () => {
  const reversed=copy(spec);reversed.files.reverse();
  assert.equal(esmEntry(spec,"analytics@sha:1111","compute"),esmEntry(reversed,"analytics@sha:1111","compute"));
});
test("untrusted path components cannot enter generated JS import specifiers", () => {
  for (const p of ["../secret.ores","src/../secret.ores","/tmp/secret.ores","src\\foo.ores","src//foo.ores"]) {
    const changed=mutateFile("m5",f=>{f.path=p;});
    assert.throws(()=>esmEntry(changed,"analytics@sha:1111","compute"),/INVALID_SOURCE_PATH/);
  }
});
test("duplicate file identity and physical source aliases fail closed", () => {
  const a=mutateFile("m2",f=>{f.id="m1";});
  assert.throws(()=>compileGraph(a),/DUPLICATE_SOURCE_UNIT/);
  const b=mutateFile("m2",f=>{f.path="src/data/models.ores";});
  assert.throws(()=>compileGraph(b),/DUPLICATE_PHYSICAL_SOURCE/);
});
test("a nonexistent module may not resolve via a same-named external path", () => {
  assert.throws(()=>selected(spec,"consumer@sha:2222","analytics","missing"),/MISSING_SELECTED_MODULE/);
});
test("the internal synthetic module cannot be declared by a fragment", () => {
  const changed=mutateFile("m5",f=>{f.modules[0].name="__root__";});
  assert.throws(()=>compileGraph(changed),/INVALID_MODULE_FRAGMENT/);
});
test("multi-file private modules require an explicit public/package interface", () => {
  const changed=mutateFile("m6",f=>{f.modules[0].scope="private";});
  assert.throws(()=>compileGraph(changed),/MODULE_SCOPE_CONFLICT/);
});
test("scope leaks through a named package alias are not admitted", () => {
  const changed=mutateFile("m5",f=>{f.modules[0].scope="pkg";});
  changed.files.find(f=>f.id==="m6").modules[0].scope="pkg";
  changed.files.find(f=>f.id==="m7").modules[0].scope="pkg";
  assert.throws(()=>selected(changed,"consumer@sha:2222","analytics","compute"),/HIDDEN_SELECTED_MODULE/);
});

test("distinct fragment-private helpers may reuse the same name without joining exports", () => {
  const changed=mutateFile("m7",f=>{
    f.modules[0].members.push({name:"hidden",kind:"fnc",arity:0,scope:"private"});
  });
  assert.deepEqual(selected(changed,"consumer@sha:2222","analytics","compute"),["add","aggregate","double"]);
  assert.ok(!esmEntry(changed,"analytics@sha:1111","compute").includes("hidden"));
});
test("same-file visibility requires source and package identity; caller cannot spoof a file across packages", () => {
  const pkg="analytics@sha:1111";
  assert.deepEqual(selected(spec,pkg,"analytics","compute","m7"),
    ["add","aggregate","double","file_only","internal"]);
  assert.deepEqual(selected(spec,"consumer@sha:2222","analytics","compute","m7"),
    ["add","aggregate","double"]);
});
