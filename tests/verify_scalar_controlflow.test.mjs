import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractScalar,renderSmt} from '../scripts/verify_scalar_subset.mjs';
const core=readFileSync(new URL('./fixtures/stdlib-core-reviewed.ores',import.meta.url),'utf8');

test('reviewed core source lowers all nested branches into QF_BV64',()=>{
  for(const fn of ['min_int','max_int','clamp_int']){
    const ast=extractScalar(core,fn);
    const smt=renderSmt(ast,fn);
    assert.equal(smt.match(/\(check-sat\)/g).length,2);
    assert.match(smt,/\(assert \(distinct \(implementation/);
    assert.match(smt,/\(assert \(distinct \(ite /);
  }
  const clamp=renderSmt(extractScalar(core,'clamp_int'),'clamp_int');
  assert.match(clamp,/bvsgt arg1 arg2/);
  assert.match(clamp,/bvslt arg0 arg1/);
  assert.match(clamp,/bvsgt arg0 arg2/);
});
test('mutated lower/upper and return arms change SMT implementation',()=>{
  const baseline=renderSmt(extractScalar(core,'clamp_int'),'clamp_int');
  for(const altered of [
    core.replace('if lower > upper; do','if lower < upper; do'),
    core.replace('if value < lower; do','if value > lower; do'),
    core.replace('if value > upper; do','if value < upper; do'),
    core.replace('return upper;','return lower;'),
  ]) {
    assert.notEqual(renderSmt(extractScalar(altered,'clamp_int'),'clamp_int'),baseline);
  }
});
test('reject effectful arithmetic, missing termination, shadowing and extra statements',()=>{
  for(const altered of [
    core.replace('return upper;','return upper + 1;'),
    core.replace('if value > upper; do','if value == upper; do'),
    core.replace('return value;','return something;'),
    core.replace('return value;','stdio.stdout.println("side effect"); return value;'),
    core.replace('int value, int lower','int value, int value'),
    core.replace('else\n        return value;', ''),
    core.replace('return upper;','return upper; return lower;'),
  ]) assert.throws(()=>extractScalar(altered,'clamp_int'),/./);
});
