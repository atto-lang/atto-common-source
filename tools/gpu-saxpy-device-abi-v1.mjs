/**
 * Fail-closed shared shape validation for the FIRST restricted GPU SAXPY ABI.
 * This is a descriptor/contract verifier, NOT a source parser, type checker,
 * backend authority, device allocation, fence, or physical execution proof.
 */
const fail = reason => { throw new TypeError(`GPU-ABI-G2-001: ${reason}`); };
const plain = x => x !== null && typeof x === 'object' &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
function ownRecord(record, names) {
  if (!plain(record)) fail('descriptor must be a plain own-data record');
  const descriptors=Object.getOwnPropertyDescriptors(record);
  const keys=Reflect.ownKeys(record);
  if (keys.length !== names.length || !names.every(n =>
      Object.hasOwn(descriptors,n) && Object.hasOwn(descriptors[n],'value')))
    fail('descriptor keys must be exact own-data fields');
  return Object.fromEntries(names.map(n=>[n,descriptors[n].value]));
}
function exactArray(x, length) {
  if (!Array.isArray(x) || Object.getPrototypeOf(x)!==Array.prototype ||
      x.length !== length || Reflect.ownKeys(x).length !== length + 1)
    fail('ABI array length, prototype or own keys invalid');
  return Array.from({length},(_,i)=>{
    const d=Object.getOwnPropertyDescriptor(x,String(i));
    if (!d || !Object.hasOwn(d,'value')) fail('sparse or accessor ABI array');
    return d.value;
  });
}
const expected = [
  ['scale','f32','value','device-copyable'],
  ['x','GpuArray<f32>','read','device'],
  ['y','GpuArray<f32>','read','device'],
  ['out','GpuArray<f32>','write','device'],
  ['n','u64','value','device-copyable'],
];
export function validateGpuSaxpyDeviceAbiV1(value) {
  const names=['schema','status','symbol','deviceSymbol','sourceBlobSha','openclArtifactSha256',
    'target','result','parameters','kernelEffects','indexIntrinsic','boundsGuard',
    'memoryPolicy','numericPolicy','evidence'];
  const v=ownRecord(value,names);
  const literals={
    schema:'attolang.gpu-kernel-device-abi/1', status:'RESTRICTED_SAXPY_G2_ONLY',
    symbol:'saxpy', deviceSymbol:'attolang_saxpy_v1',
    sourceBlobSha:'48290eaac9f64358cfb0e1b792d8a63fa48ae150',
    openclArtifactSha256:'b5076980355531632de445e05e35554d3fb54ceeebaf707457863571bdeb77a4',
    target:'spir64-unknown-unknown', result:'void',
    indexIntrinsic:'gpu.global_id(0)', boundsGuard:'i >= n => return',
    memoryPolicy:'exclusive-write-loan-required',
    numericPolicy:'OPENCL_FP_CONTRACT_OFF_NO_BITWISE_PARITY_CLAIM'
  };
  for(const [key,expectedValue] of Object.entries(literals))
    if(v[key]!==expectedValue) fail(`${key} is not the pinned restricted kernel contract`);
  const params=exactArray(v.parameters,5);
  for(let i=0;i<5;i++) {
    const p=ownRecord(params[i],['name','type','direction','residency']);
    for(const [j,key] of ['name','type','direction','residency'].entries())
      if(p[key]!==expected[i][j]) fail(`parameter ${i} invalid ${key}`);
  }
  const effects=exactArray(v.kernelEffects,2);
  if(effects[0]!=='device.read'||effects[1]!=='device.write')
    fail('host, async, actor, barrier and other unsupported effects rejected');
  const proof=ownRecord(v.evidence,['typedHostKernelIR','nativeLlvmGuestParser','physicalGpu','deviceFence']);
  if(proof.typedHostKernelIR!=='DESCRIPTOR_VALIDATION_ONLY'||
      proof.nativeLlvmGuestParser!=='NOT_EXECUTED'||
      proof.physicalGpu!=='NOT_EXECUTED'||proof.deviceFence!=='NOT_EXECUTED')
    fail('descriptor cannot promote any compiler or hardware evidence');
  return Object.freeze({
    stage:'SOURCE_ABI_DESCRIPTOR_ONLY',
    symbol:v.symbol, deviceSymbol:v.deviceSymbol, target:v.target,
    sourceBlobSha:v.sourceBlobSha, openclArtifactSha256:v.openclArtifactSha256,
    deviceExecutionProven:false,
    compilerGuestExecutionProven:false,
  });
}
