// Source-contract reference checker. No compiler/guest execution is implied.
// This deliberately rejects unknown fields and unproved target identity.
const COMMON = [
  'kind','compileTimeClosure','sourceMacrosEliminated','postMacroValidated',
  'runtimeJitRequired','runtimeCompilerRequired','runtimeGeneratesCode',
  'runtimeRegistry','verified','emittedTargets'
];
const PERMISSIONS = ['type','borrow','effect','capability','visibility','actorIsolation'];
const KINDS = Object.freeze({
  DIRECT: ['target','overrideProof','runtimeLookup'],
  STATIC_WITNESS: ['target','witness','reachableInstantiations','abiVerified','runtimeLookup'],
  CLOSED_INDIRECT: ['targets','slotId','abiVerified','sealedTargetSet','fallbackIncluded','runtimeLookup'],
  ACTOR_MESSAGE: ['handlers','stableActorId','generationFence','admission','nonreentrant','ownerIsolation','directStateCall']
});
const SYMBOL = /^[A-Za-z_$][A-Za-z0-9_.$:<>-]*$/;
const OWN = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = message => { throw new Error('DISPATCH_AOT_REJECT: ' + message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equals = (actual, expected, where) => {
  if (actual !== expected) fail(where);
};
const exactKeys = (value, keys, where) => {
  if (!record(value)) fail(where + ': not a record');
  const actual = Object.keys(value).sort();
  const required = [...keys].sort();
  if (actual.length !== required.length || actual.some((k, i) => k !== required[i]))
    fail(where + ': missing or unknown fields');
};
const symbol = (value, where) => {
  if (typeof value !== 'string' || value.length > 512 || !SYMBOL.test(value))
    fail(where + ': invalid canonical symbol');
};
const uniqueSymbols = (value, where, limit = 256) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit)
    fail(where + ': not a nonempty bounded list');
  value.forEach((v, i) => symbol(v, where + '[' + i + ']'));
  if (new Set(value).size !== value.length) fail(where + ': duplicate identity');
};
const exactTargetSet = (planned, emitted) => {
  uniqueSymbols(planned, 'planned targets');
  uniqueSymbols(emitted, 'emitted targets');
  if (planned.length !== emitted.length || planned.some(t => !emitted.includes(t)))
    fail('compiler emission does not close all planned targets');
};

export function validateDispatchPlan(plan) {
  if (!record(plan) || !OWN(KINDS, plan.kind)) fail('unknown dispatch category');
  exactKeys(plan, [...COMMON, ...KINDS[plan.kind]], 'dispatch plan');
  for (const key of ['compileTimeClosure','sourceMacrosEliminated','postMacroValidated'])
    equals(plan[key], true, key + ' not verified');
  for (const key of ['runtimeJitRequired','runtimeCompilerRequired',
                      'runtimeGeneratesCode','runtimeRegistry'])
    equals(plan[key], false, key + ' forbidden in strict AOT');
  exactKeys(plan.verified, PERMISSIONS, 'semantic admission');
  for (const key of PERMISSIONS) equals(plan.verified[key], true, key + ' not verified');

  if (plan.kind === 'DIRECT') {
    symbol(plan.target, 'direct target');
    if (!['exact_final', 'sealed_unique', 'whole_program_unique'].includes(plan.overrideProof))
      fail('direct target not unique across possible overrides');
    equals(plan.runtimeLookup, false, 'runtime method-name lookup');
    exactTargetSet([plan.target], plan.emittedTargets);
  } else if (plan.kind === 'STATIC_WITNESS') {
    symbol(plan.target, 'static witness callee');
    symbol(plan.witness, 'static witness identity');
    equals(plan.abiVerified, true, 'witness ABI not checked');
    equals(plan.runtimeLookup, false, 'runtime witness lookup');
    uniqueSymbols(plan.reachableInstantiations, 'finite generic instantiations', 4096);
    exactTargetSet([plan.target], plan.emittedTargets);
  } else if (plan.kind === 'CLOSED_INDIRECT') {
    symbol(plan.slotId, 'indirect slot ABI identity');
    equals(plan.abiVerified, true, 'indirect slot ABI not checked');
    equals(plan.sealedTargetSet, true, 'indirect target set not closed');
    equals(plan.fallbackIncluded, true, 'override/unknown-tag fallback omitted');
    equals(plan.runtimeLookup, false, 'runtime registry or method-name lookup');
    exactTargetSet(plan.targets, plan.emittedTargets);
  } else if (plan.kind === 'ACTOR_MESSAGE') {
    for (const key of ['stableActorId','generationFence','admission',
                       'nonreentrant','ownerIsolation'])
      equals(plan[key], true, 'actor runtime ' + key + ' not checked');
    equals(plan.directStateCall, false, 'actor message bypasses mailbox/ownership');
    exactTargetSet(plan.handlers, plan.emittedTargets);
  }
  return true;
}

export function validateContract(contract) {
  exactKeys(contract, ['schema','status','purpose','runtimeJitOptional','limits','categories','cases'], 'manifest');
  equals(contract.schema, 'atto.static-dispatch-aot.v1', 'version mismatch');
  equals(contract.status, 'SOURCE_CONTRACT_ONLY', 'invalid evidence claim');
  equals(contract.runtimeJitOptional, true, 'JIT must be an optional optimization');
  exactKeys(contract.limits, ['maxEmittedTargets','maxReachableInstantiations'], 'limits');
  equals(contract.limits.maxEmittedTargets, 256, 'target bound mismatch');
  equals(contract.limits.maxReachableInstantiations, 4096, 'generic bound mismatch');
  if (!Array.isArray(contract.categories) ||
      JSON.stringify(contract.categories) !== JSON.stringify(Object.keys(KINDS)))
    fail('dispatch categories mismatch');
  if (!Array.isArray(contract.cases) || contract.cases.length < 20)
    fail('insufficient positive/negative fixtures');
  const ids = new Set();
  const coveredKinds = new Set();
  let accepted = 0, rejected = 0;
  for (const c of contract.cases) {
    exactKeys(c, ['id','expected','plan'], 'case');
    symbol(c.id, 'case id');
    if (ids.has(c.id)) fail('duplicate case id');
    ids.add(c.id);
    if (c.expected !== 'accept' && c.expected !== 'reject') fail('bad case expected');
    let ok = true;
    try { validateDispatchPlan(c.plan); } catch (e) {
      if (!String(e.message).startsWith('DISPATCH_AOT_REJECT:')) throw e;
      ok = false;
    }
    if (ok !== (c.expected === 'accept'))
      fail('case ' + c.id + ' unexpectedly ' + (ok ? 'accepted' : 'rejected'));
    if (ok) { accepted++; coveredKinds.add(c.plan.kind); } else rejected++;
  }
  if (accepted < 4 || rejected < 15 || coveredKinds.size !== Object.keys(KINDS).length)
    fail('missing positive category or adversarial coverage');
  return {accepted, rejected, total: contract.cases.length};
}
