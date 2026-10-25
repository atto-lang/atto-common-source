import test from "node:test";
import assert from "node:assert/strict";
import {extractScalar,renderSmt,checkWithZ3} from "../scripts/verify_scalar_subset.mjs";

const MIN = [
  "define module core as",
  "  // pub fnc min_int(int fake, int fake): int {}",
  "  pub fnc min_int(int left, int right): int {",
  "    if left < right; do",
  "      return left;",
  "    else",
  "      return right;",
  "    fi",
  "  }",
  "end"
].join("\n");
const MAX = "pub fnc max_int(int left, int right): int { if left > right; do return left; else return right; fi }";

test("imports supported min/max bodies and emits BV64 checks", () => {
  const min=renderSmt(extractScalar(MIN,"min_int"),"min_int");
  const max=renderSmt(extractScalar(MAX,"max_int"),"max_int");
  assert.match(min,/bvslt arg0 arg1/);
  assert.match(max,/bvsgt arg0 arg1/);
  assert.match(min,/distinct \(implementation x y\) \(contract x y\)/);
  assert.equal(min.match(/\(check-sat\)/g).length,2);
  assert.equal(max.match(/\(check-sat\)/g).length,2);
});
test("whitespace and comment layout preserve imported implementation",()=>{
  const alt=MIN.replace("if left < right; do","if\n left   <  right ; do");
  assert.equal(renderSmt(extractScalar(alt,"min_int"),"min_int"),
    renderSmt(extractScalar(MIN,"min_int"),"min_int"));
});
test("wrong comparator changes the source-derived proof obligation",()=>{
  const changed=MIN.replace("left < right","left > right");
  const good=renderSmt(extractScalar(MIN,"min_int"),"min_int");
  const bad=renderSmt(extractScalar(changed,"min_int"),"min_int");
  assert.notEqual(good,bad);
  assert.match(bad,/bvsgt arg0 arg1/);
});
test("unsupported and malformed source fails closed",()=>{
  const mutations=[
    MIN.replace("if left < right", "if left == right"),
    MIN.replace("return right;", "return 5;"),
    MIN.replace("return right;", "return left + right;"),
    MIN.replace(/\bfi\b/, "return left; fi"),
    MIN.replace(/\bfi\b/, "fi if left < right; do return left; fi"),
    MIN.replace("int right", "String right"),
    MIN.replace("int right", "int left"),
    MIN.replace("return left;", "return missing;"),
    MIN.replace("left < right", "left < left"),
    MIN.replace("return right;", "return right"),
    MIN.replace(/\bfi\b/, "end"),
    MIN+"\npub fnc min_int(int a, int b): int {if a < b; do return a; else return b; fi}",
    MIN.replace("left < right", "left < right @"),
    MIN.replace("fi\n  }","fi"),
  ];
  for(const [index,bad] of mutations.entries()) assert.throws(()=>extractScalar(bad,"min_int"), "mutation " + index);
  assert.throws(()=>extractScalar(MIN,"clamp_int"));
});
test("solver output gate rejects unknown, incorrect, extra or missing results",()=>{
  const ok=stdout=>()=>({error:undefined,status:0,signal:null,stdout,stderr:""});
  assert.equal(checkWithZ3("(ignored)",ok("unsat\nsat\n")),true);
  for(const stdout of ["sat\nsat\n","unsat\nunsat\n","unknown\nsat\n",
    "unsat\nsat\nsat\n","","error: invalid\n"]) {
    assert.throws(()=>checkWithZ3("(ignored)",ok(stdout)));
  }
  assert.throws(()=>checkWithZ3("",()=>({status:1,signal:null,stderr:"bad",stdout:""})));
  assert.throws(()=>checkWithZ3("",()=>({error:Error("missing"),status:null,stderr:"",stdout:""})));
});
