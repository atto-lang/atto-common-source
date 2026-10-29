#!/usr/bin/env node
// Static Oreslang fixture consistency checks; NO compiler execution.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const contract=JSON.parse(fs.readFileSync(new URL("../contracts/named-module-multifile-js-v1.json",import.meta.url),"utf8"));
const root=new URL("../fixtures/named-module-multifile-v1/",import.meta.url);
const read=(path)=>fs.readFileSync(new URL(path,root),"utf8");
test("physical 10-file source graph mirrors the normative three module groups",()=>{
  assert.equal(contract.files.length,10);
  const counts=new Map();
  for(const file of contract.files) {
    const source=read("analytics/"+file.path);
    assert.ok(source.includes("define pub module "+file.modules[0].name+" as"),file.path);
    if(file.source_namespace) assert.ok(source.startsWith("namespace "+file.source_namespace+";"),file.path);
    assert.equal((source.match(/\bdefine pub module\b/g)||[]).length,file.modules.length,file.path);
    for(const mod of file.modules) {
      counts.set(mod.name,(counts.get(mod.name)||0)+1);
      for(const m of mod.members) {
        const modifier=m.scope==="public"?"pub ":m.scope==="pkg"?"pub[pkg] ":m.scope==="file"?"pub[file] ":"";
        assert.ok(source.includes(modifier+"fnc "+m.name+"("),file.path+":"+m.name);
      }
    }
  }
  assert.deepEqual([...counts].sort((a,b)=>a[0].localeCompare(b[0])),[["api",3],["compute",3],["data",4]]);
});
test("consumer imports the three-file compute module exactly once",()=>{
  const source=read("consumer/src/main.ores");
  assert.equal((source.match(/import module compute from "pkg:analytics";/g)||[]).length,1);
  assert.ok(source.includes("compute.aggregate(compute.double(compute.add(20, 1)))"));
});
test("manifest membership lists each source exactly once without file probes",()=>{
  const manifest=read("analytics/.ores.pkg.toml");
  assert.ok(manifest.includes('schema_version = "2"'));
  for(const file of contract.files) {
    const matches=manifest.split('"'+file.path+'"').length-1;
    assert.equal(matches,1,file.path);
  }
  assert.equal((manifest.match(/"src\/(?:data|compute|api)\/[^"]+\.ores"/g)||[]).length,10);
});
