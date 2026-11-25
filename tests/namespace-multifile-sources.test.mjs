#!/usr/bin/env node
// Source fixture shape only: no Oreslang compiler execution.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const spec=JSON.parse(fs.readFileSync(new URL("../contracts/namespace-multifile-package-js-v1.json",import.meta.url),"utf8"));
const root=new URL("../fixtures/namespace-multifile-v1/",import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),"utf8");
test("each of ten files has exactly one matching flat source namespace header",()=>{
 assert.equal(spec.files.length,10);
 const counts=new Map();
 for(const f of spec.files){
   const source=read("foo/"+f.path);
   assert.ok(source.startsWith("namespace "+f.ns+";"),f.path);
   assert.equal((source.match(/\bnamespace\s+\w+\s*;/g)||[]).length,1,f.path);
   assert.ok(!source.includes("define module"),f.path);
   counts.set(f.ns,(counts.get(f.ns)||0)+1);
   for(const m of f.declarations){
     const prefix=m.scope==="public"?"pub ":m.scope==="pkg"?"pub[pkg] ":m.scope==="file"?"pub[file] ":"";
     assert.ok(source.includes(prefix+"fnc "+m.name+"("),f.path+":"+m.name);
   }
 }
 assert.deepEqual([...counts].sort((a,b)=>a[0].localeCompare(b[0])),[["a",3],["b",4],["c",3]]);
});
test("consumer imports namespace a from pinned foo only once",()=>{
 const source=read("app/src/main.ores");
 assert.equal((source.match(/import ns a from 'pkg:foo';/g)||[]).length,1);
 assert.ok(source.includes("a.aggregate(a.double(a.add(20, 1)))"));
});
test("foo manifest lists each of ten exact files once",()=>{
 const manifest=read("foo/.ores.pkg.toml");
 assert.ok(manifest.includes('schema_version = "2"'));
 for(const f of spec.files)assert.equal(manifest.split('"'+f.path+'"').length-1,1,f.path);
 assert.equal((manifest.match(/"src\/(?:compute|data|api)\/[^"]+\.ores"/g)||[]).length,10);
});
test("all ten declaration files belong to foo, never the consumer app",()=>{
 assert.ok(spec.files.every(f=>f.pkg==="foo@sha:1111"));
 const app=read("app/src/main.ores");
 assert.ok(!app.includes("namespace a;"));
 assert.ok(!app.includes("define module a"));
});
