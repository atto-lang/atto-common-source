import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDispatchPlan, validateContract} from '../tools/validate-static-dispatch-aot-v1.mjs';

const contract = JSON.parse(readFileSync(
  new URL('../fixtures/static-dispatch-aot-v1.json', import.meta.url), 'utf8'));
const clone = obj => structuredClone(obj);
const accepted = Object.fromEntries(contract.cases
  .filter(x => x.expected === 'accept').map(x => [x.id, x.plan]));
const rejected = contract.cases.filter(x => x.expected === 'reject');

test('all versioned plans are fail-closed and all cases have explicit decisions', () => {
  assert.deepEqual(validateContract(contract), {accepted: 5, rejected: 19, total: 24});
});
test('each of four AOT dispatch categories has a positive proof', () => {
  for (const kind of contract.categories) {
    const positive = Object.values(accepted).find(p => p.kind === kind);
    assert.ok(positive, 'missing ' + kind);
    assert.equal(validateDispatchPlan(positive), true);
  }
});
test('all fixture negatives are genuinely rejected', () => {
  for (const c of rejected)
    assert.throws(() => validateDispatchPlan(c.plan), /DISPATCH_AOT_REJECT/, c.id);
});
test('cannot silently weaken exact emitted target identity', () => {
  for (const kind of contract.categories) {
    const p = clone(Object.values(accepted).find(q => q.kind === kind));
    p.emittedTargets = [...p.emittedTargets, 'root.Forged.callee'];
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, kind);
  }
});
test('runtime compilation/JIT/registry and compile-time admission cannot be forged', () => {
  for (const key of ['runtimeJitRequired', 'runtimeCompilerRequired',
                     'runtimeGeneratesCode', 'runtimeRegistry']) {
    const p = clone(accepted['direct-final']);
    p[key] = true;
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, key);
  }
  for (const key of ['compileTimeClosure','sourceMacrosEliminated','postMacroValidated']) {
    const p = clone(accepted['direct-final']);
    p[key] = false;
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, key);
  }
  for (const key of Object.keys(accepted['direct-final'].verified)) {
    const p = clone(accepted['direct-final']);
    p.verified[key] = false;
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, key);
  }
});
test('unknown, extra, prototype-looking and ill-typed policy fields reject', () => {
  const p = clone(accepted['direct-final']);
  p.surprise = true;
  assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/);
  const p2 = clone(accepted['direct-final']);
  p2.verified.__proto_marker__ = true;
  assert.throws(() => validateDispatchPlan(p2), /DISPATCH_AOT_REJECT/);
  const p3 = clone(accepted['direct-final']);
  p3.runtimeLookup = 'false';
  assert.throws(() => validateDispatchPlan(p3), /DISPATCH_AOT_REJECT/);
  const p4 = clone(accepted['direct-final']);
  p4.emittedTargets = 'root.Counter.read$arity0';
  assert.throws(() => validateDispatchPlan(p4), /DISPATCH_AOT_REJECT/);
});
test('closed indirect ABI/override admission must not disappear', () => {
  for (const key of ['abiVerified','sealedTargetSet','fallbackIncluded']) {
    const p = clone(accepted['closed-precompiled-indirect']);
    p[key] = false;
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, key);
  }
  const duplicate = clone(accepted['closed-precompiled-indirect']);
  duplicate.targets[1] = duplicate.targets[0];
  assert.throws(() => validateDispatchPlan(duplicate), /DISPATCH_AOT_REJECT/);
});
test('actor routing cannot skip generation, admission or nonreentrancy', () => {
  for (const key of ['stableActorId','generationFence','admission','nonreentrant','ownerIsolation']) {
    const p = clone(accepted['actor-message-closed']);
    p[key] = false;
    assert.throws(() => validateDispatchPlan(p), /DISPATCH_AOT_REJECT/, key);
  }
  const bypass = clone(accepted['actor-message-closed']);
  bypass.directStateCall = true;
  assert.throws(() => validateDispatchPlan(bypass), /DISPATCH_AOT_REJECT/);
});
test('contract validation rejects missing positive dispatch category and dishonest status', () => {
  const p = clone(contract);
  p.status = 'ALL_BACKENDS_EXECUTED';
  assert.throws(() => validateContract(p), /DISPATCH_AOT_REJECT/);
  const p2 = clone(contract);
  p2.cases = p2.cases.filter(x => !(x.plan.kind === 'DIRECT' && x.expected === 'accept'));
  assert.throws(() => validateContract(p2), /DISPATCH_AOT_REJECT/);
  const p3 = clone(contract);
  p3.cases.push(clone(p3.cases[0]));
  assert.throws(() => validateContract(p3), /DISPATCH_AOT_REJECT/);
});
