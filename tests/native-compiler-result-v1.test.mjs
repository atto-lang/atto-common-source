import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNativeCompilerResult as classify} from '../scripts/native-compiler-result-v1.mjs';
test('normal compiler outcomes are distinct from unavailable runners and crashes', () => {
  for (const [r,artifact,expected] of [
    [{status:0},true,'EMITTED'],
    [{status:0},false,'MISSING_ARTIFACT'],
    [{status:1},false,'REJECTED'],
    [{status:2},true,'FAILED_WITH_ARTIFACT'],
    [{status:null,error:new Error('ENOENT'),stdout:null},false,'INFRASTRUCTURE_FAILURE'],
    [{status:null,signal:'SIGSEGV',stdout:null},false,'INFRASTRUCTURE_FAILURE'],
    [{status:1,error:new Error('ETIMEDOUT')},false,'INFRASTRUCTURE_FAILURE'],
    [{status:null},true,'INFRASTRUCTURE_FAILURE'],
    [{status:2,stderr:'usage: oresforge check <file>'},false,'INFRASTRUCTURE_FAILURE'],
    [{status:2,stderr:'E_USAGE: forge_scalar input.atto -o output.cpp'},false,'INFRASTRUCTURE_FAILURE'],
    [{status:2,stderr:'E_PARSE: unexpected token at byte 10'},false,'REJECTED']
  ]) assert.deepEqual(classify(r,artifact),{status:expected,artifact});
});
