import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateGpuSaxpyDeviceAbiV1 as admit} from '../tools/gpu-saxpy-device-abi-v1.mjs';

const original=JSON.parse(readFileSync(new URL('../contracts/v1/gpu-saxpy-device-abi-v1.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(original);

test('valid descriptor never mints a provider or physical GPU claim',()=>{
  const result=admit(fresh());
  assert.ok(Object.isFrozen(result));
  assert.equal(result.stage,'SOURCE_ABI_DESCRIPTOR_ONLY');
  assert.equal(result.deviceExecutionProven,false);
  assert.equal(result.compilerGuestExecutionProven,false);
});

for(const [name,mutate] of [
  ['legacy cuda surface', x=>x.indexIntrinsic='gpu<<<1,256>>>'],
  ['unsupported target', x=>x.target='nvidia-cuda'],
  ['forged native guest evidence', x=>x.evidence.nativeLlvmGuestParser='PASS'],
  ['forged hardware', x=>x.evidence.physicalGpu='PASS'],
  ['forged fence', x=>x.evidence.deviceFence='PASS'],
  ['forged host proof', x=>x.evidence.typedHostKernelIR='COMPILER_EXECUTED'],
  ['unsupported effect', x=>x.kernelEffects.push('host.io')],
  ['unsupported effect order', x=>x.kernelEffects.reverse()],
  ['immutable output', x=>x.parameters[3].direction='read'],
  ['host buffer', x=>x.parameters[1].type='HostBuffer<f32>'],
  ['host residency', x=>x.parameters[1].residency='host'],
  ['renamed output', x=>x.parameters[3].name='x'],
  ['different scalar ABI', x=>x.parameters[4].type='i32'],
  ['different device symbol', x=>x.deviceSymbol='saxpy_v2'],
  ['unsafe numeric promise', x=>x.numericPolicy='bitwise CUDA equivalent'],
  ['missing guard', x=>x.boundsGuard='none'],
  ['unverified source blob', x=>x.sourceBlobSha='a'.repeat(40)],
  ['unverified output artifact', x=>x.openclArtifactSha256='b'.repeat(64)],
  ['extra pointer key', x=>x.parameters[0].pointer='0xdeadbeef'],
  ['extra top key', x=>x.hardwareReady=true],
  ['missing evidence key', x=>delete x.evidence.deviceFence],
  ['missing parameter', x=>x.parameters.pop()],
  ['accessor instead of data field', x=>Object.defineProperty(x.parameters[0],'name',{get(){throw Error('NEVER_CALLED')},enumerable:true})],
  ['symbol hidden field', x=>x.evidence[Symbol('evade')]=true],
  ['sparse array', x=>delete x.parameters[2]],
  ['nonplain descriptor', x=>Object.setPrototypeOf(x,{unexpected:true})],
]) test(`GPU ABI fail closed: ${name}`,()=>{
  const x=fresh(); mutate(x);
  assert.throws(()=>admit(x),/GPU-ABI-G2-001/);
});
