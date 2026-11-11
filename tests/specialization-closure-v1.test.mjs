import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpecializationManifest} from '../tools/validate-specialization-closure-v1.mjs';
const fixture = () => ({
  schema: 'atto.specialization-closure.v1', closureComplete: true,
  runtimeSpecialization: false, maxCodeBytes: 2048, roots: ['main-int'],
  nodes: [
    {id:'main-int',callee:'root.main',witness:'root.Main.int',types:['int'],
     emittedSymbol:'root.main$int',estimatedBytes:256,calls:['apply-int'],
     abiVerified:true,semanticChecksPassed:true},
    {id:'apply-int',callee:'root.apply',witness:'root.Numeric.int',types:['int'],
     emittedSymbol:'root.apply$int',estimatedBytes:384,calls:['apply-int'],
     abiVerified:true,semanticChecksPassed:true}
  ]
});
const expectReject = (mutate, name) => {
  const m = fixture(); mutate(m);
  assert.throws(() => validateSpecializationManifest(m), /SPECIALIZATION_REJECT/, name);
};
test('finite specialized witness closure allows self-recursion and accounts code bytes', () => {
  assert.deepEqual(validateSpecializationManifest(fixture()),
    {instantiations:2,estimatedCodeBytes:640});
});
test('compile-time closure cannot trigger runtime generic specialization', () => {
  expectReject(m => {m.runtimeSpecialization = true;}, 'runtime');
  expectReject(m => {m.closureComplete = false;}, 'partial closure');
});
test('missing or forged generic target identity cannot compile', () => {
  expectReject(m => {m.nodes[0].calls=['not-compiled'];}, 'missing callee');
  expectReject(m => {m.nodes[1].emittedSymbol=m.nodes[0].emittedSymbol;}, 'ABI alias');
  expectReject(m => {m.nodes[1].id=m.nodes[0].id;}, 'duplicate');
});
test('no unreachable or attacker-inserted specialization', () => {
  expectReject(m => {m.nodes[0].calls=[];}, 'unreachable emitted');
  expectReject(m => {m.roots=['apply-int','apply-int'];}, 'duplicate roots');
});
test('bounded compile size and instantiation budgets fail closed', () => {
  expectReject(m => {m.maxCodeBytes=639;}, 'binary growth');
  expectReject(m => {m.nodes[0].estimatedBytes=1.5;}, 'noninteger');
  expectReject(m => {m.maxCodeBytes=Number.MAX_SAFE_INTEGER;}, 'unbounded');
  expectReject(m => {m.nodes=Array.from({length:4097},(_,i)=>({...m.nodes[0],id:'n'+i,emittedSymbol:'root.n'+i}));}, 'node cap');
});
test('unverified witness and semantic gates reject', () => {
  expectReject(m => {m.nodes[1].abiVerified=false;}, 'witness ABI');
  expectReject(m => {m.nodes[0].semanticChecksPassed=false;}, 'borrow/effect');
  expectReject(m => {m.nodes[1].types=[];}, 'no concrete type');
});
test('strict schema protects against source/macro provenance spoofing', () => {
  expectReject(m => {m.nodes[0].runtimeLookup=true;}, 'unknown field');
  expectReject(m => {m.nodes[1].calls=['apply-int','apply-int'];}, 'duplicate dependency');
  expectReject(m => {m.schema='atto.specialization-closure.v2';}, 'version');
});
