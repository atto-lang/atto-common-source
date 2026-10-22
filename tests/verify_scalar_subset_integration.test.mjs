// Requires a real z3 executable. Do not substitute a mocked solver receipt.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {extractScalar,renderSmt,checkWithZ3} from "../scripts/verify_scalar_subset.mjs";

const source=readFileSync(new URL("./fixtures/stdlib-core-reviewed.ores",import.meta.url),"utf8");

test("actual Z3 proves three source-derived imported core functions",()=>{
  for(const name of ["min_int","max_int","clamp_int"]) {
    const smt=renderSmt(extractScalar(source,name),name);
    assert.equal(checkWithZ3(smt),true);
  }
});
test("incorrect source min branch fails the proof with an actual SAT witness",()=>{
  assert.match(source,/if left < right; do/);
  const mutant=source.replace("if left < right; do","if left > right; do");
  const smt=renderSmt(extractScalar(mutant,"min_int"),"min_int");
  const p=spawnSync("z3",["-smt2","-in"],{
    input:smt,encoding:"utf8",timeout:30000,maxBuffer:2_000_000
  });
  assert.equal(p.error,undefined);
  assert.equal(p.status,0);
  assert.equal(p.stderr,"");
  assert.equal(p.stdout.trim(),"sat\nsat");
  assert.throws(()=>checkWithZ3(smt),/proof\/mutant expected/);
});

test("incorrect clamp reversed-bound source fails against actual Z3",()=>{
  const bad=source.replace("if lower > upper; do","if lower < upper; do");
  assert.notEqual(bad,source);
  const smt=renderSmt(extractScalar(bad,"clamp_int"),"clamp_int");
  const p=spawnSync("z3",["-smt2","-in"],{
    input:smt,encoding:"utf8",timeout:30000,maxBuffer:2_000_000
  });
  assert.equal(p.error,undefined);
  assert.equal(p.status,0);
  assert.equal(p.stderr,"");
  assert.equal(p.stdout.trim(),"sat\nsat");
  assert.throws(()=>checkWithZ3(smt),/proof\/mutant expected/);
});
