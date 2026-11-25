import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateGpuActorSignatureV0 as validate} from '../models/gpu-actor-signature-hir-v0.mjs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/v1/gpu-actor-signature-hir-v0.json', import.meta.url), 'utf8'));
const make = () => ({
  name:'VectorWorker',visibility:'PRIVATE',state:[
    {name:'scale',kind:'F32'},{name:'ready',kind:'BOOL'}
  ],methods:[{name:'multiply',arguments:[
    {name:'buffer',kind:'F32_DEVICE_BUFFER'},
    {name:'factor',kind:'F32'}
  ],result:'VOID',sourceTokenCount:2}],
  admissionStage:'TYPED_SIGNATURE_ONLY',
  bodyEffectsVerified:false,ownedDeviceBuffersVerified:false,
  executable:false,physicalGpuVerified:false
});
const denial = (patch,match) => {
  const result=validate(patch);
  assert.equal(result.ok,false,JSON.stringify(patch));
  assert.match(result.errors.join(' '),match);
};

test('canonical HIR status must not be mistaken for GPU execution',()=>{
  assert.equal(contract.schema,'attolang.gpu-actor-signature-hir/0');
  assert.equal(contract.status,'TYPED_SIGNATURE_ONLY_NOT_EXECUTABLE');
  assert.deepEqual(contract.sourceDescriptor.proofFlags,{
    bodyEffectsVerified:false,ownedDeviceBuffersVerified:false,
    executable:false,physicalGpuVerified:false
  });
  assert.deepEqual(Object.keys(contract.backends).sort(),
    ['java','llvm','wasm','forge','net'].sort());
  for(const k of Object.values(contract.backends)) assert.equal(k,'GPU_EXECUTION_NOT_ATTESTED');
});

test('typed source signature matches bounded Java candidate shapes',()=>{
  assert.deepEqual(validate(make()),{ok:true,errors:[]});
});

test('forged evidence fields and status promotions are rejected',()=>{
  for(const key of ['bodyEffectsVerified','ownedDeviceBuffersVerified',
     'executable','physicalGpuVerified']) {
    let d=make();d[key]=true;denial(d,/GPU_ACTOR_UNPROVEN_PROMOTION/);
  }
  let d=make();d.admissionStage='PHYSICAL_GPU';denial(d,/GPU_ACTOR_FORGED_STAGE/);
  d=make();d.tenantAuthority='fake';denial(d,/GPU_ACTOR_DESCRIPTOR_SCHEMA/);
  d=make();delete d.executable;denial(d,/GPU_ACTOR_DESCRIPTOR_SCHEMA/);
});

test('reject host-resident values, invalid signatures and duplicate state names',()=>{
  for(const kind of ['String','ActorMail','Channel','Future','HostBuffer','Pointer']) {
    let d=make();d.state[0].kind=kind;denial(d,/GPU_ACTOR_STATE_FIELD_INVALID/);
  }
  let d=make();d.state.push({...d.state[0]});denial(d,/GPU_ACTOR_DUPLICATE_STATE/);
  d=make();d.methods[0].arguments[0].kind='VOID';denial(d,/GPU_ACTOR_ARGUMENT_INVALID/);
  d=make();d.methods[0].name='BadCamelCase';denial(d,/GPU_ACTOR_METHOD_INVALID/);
  d=make();d.methods[0].sourceTokenCount=0;denial(d,/GPU_ACTOR_METHOD_INVALID/);
  d=make();d.methods[0].sourceTokenCount=1025;denial(d,/GPU_ACTOR_METHOD_INVALID/);
  d=make();d.methods.push(structuredClone(d.methods[0]));denial(d,/GPU_ACTOR_DUPLICATE_METHOD_ARITY/);
});

test('reject mutable argument duplicates and fake symbols',()=>{
  let d=make();d.methods[0].arguments[1].name='buffer';
  denial(d,/GPU_ACTOR_DUPLICATE_PARAMETER/);
  d=make();d.name='';denial(d,/GPU_ACTOR_NAME_INVALID/);
  d=make();d.name='X'.repeat(1025);denial(d,/GPU_ACTOR_NAME_INVALID/);
});

test('resource budgets fail closed',()=>{
  let d=make();d.state=Array.from({length:129},(_,i)=>({name:'v'+i,kind:'I32'}));
  denial(d,/GPU_ACTOR_STATE_BUDGET/);
  d=make();d.methods=Array.from({length:65},(_,i)=>({
    name:'m'+i,arguments:[],result:'VOID',sourceTokenCount:1
  }));
  denial(d,/GPU_ACTOR_METHOD_BUDGET/);
  d=make();d.methods[0].arguments=Array.from({length:33},(_,i)=>({name:'p'+i,kind:'F32'}));
  denial(d,/GPU_ACTOR_METHOD_INVALID/);
});

test('descriptor is only a type boundary, not provider-authenticated dispatch',()=>{
  const required = contract.futureRuntimeMir.required;
  for(const x of ['actorGeneration','perActorMailboxSequence','tenantAuthority',
      'bufferAccessFootprints','allocationGenerations','completionEventAuthority',
      'retirementFence','supervisorControlSink']) assert.ok(required.includes(x));
  assert.equal(contract.futureRuntimeMir.status,'NOT_IMPLEMENTED');
  assert.equal(contract.promotion.neverInferHardwareFromSourceFields,true);
  assert.equal(validate(null).ok,false);
  assert.equal(validate([]).ok,false);
});
