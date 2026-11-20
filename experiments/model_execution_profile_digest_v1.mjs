import { createHash } from "node:crypto";

export class ModelProfileDigestError extends Error {
  constructor(code) { super(code); this.name="ModelProfileDigestError"; this.code=code; }
}
const fail=code=>{throw new ModelProfileDigestError(code);};
const exact=(x,fields)=>{
  if(x===null||typeof x!=="object"||Array.isArray(x)||Object.getPrototypeOf(x)!==Object.prototype)
    fail("MODEL_INVALID_EXECUTION_PROFILE");
  const keys=Reflect.ownKeys(x);
  if(keys.some(k=>typeof k!=="string"||!fields.includes(k))) fail("MODEL_INVALID_EXECUTION_PROFILE");
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(x,k);if(!d||!Object.hasOwn(d,"value")||!d.enumerable)fail("MODEL_INVALID_EXECUTION_PROFILE");}
};
const validString=x=>{
  if(typeof x!=="string")fail("MODEL_INVALID_EXECUTION_PROFILE");
  for(let i=0;i<x.length;i++){const c=x.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){if(++i>=x.length||x.charCodeAt(i)<0xdc00||x.charCodeAt(i)>0xdfff)fail("MODEL_DIGEST_STRING");}else if(c>=0xdc00&&c<=0xdfff)fail("MODEL_DIGEST_STRING");}
  const b=Buffer.from(x,"utf8");if(b.length>256)fail("MODEL_INVALID_EXECUTION_PROFILE");return b;
};
class Bytes{
  constructor(){this.parts=[];}
  raw(b){this.parts.push(Buffer.from(b));}
  u8(n){this.parts.push(Buffer.from([n]));}
  u32(n){const b=Buffer.allocUnsafe(4);b.writeUInt32BE(n);this.parts.push(b);}
  string(x){const b=validString(x);this.u32(b.length);this.raw(b);}
  finish(){return Buffer.concat(this.parts);}
}
const ord=(x,a)=>{const n=a.indexOf(x);if(n<0)fail("MODEL_INVALID_EXECUTION_PROFILE");return n;};
export function canonicalExecutionProfileV1Bytes(p){
  exact(p,["version","backendId","backendSemanticVersion","compilerSemanticVersion","targetTriple","dataLayout","runtimeAbi","numericMode","deterministic","allocation","freestanding","deviceAbi","numericFeatures"]);
  if(p.version!==1||typeof p.deterministic!=="boolean"||typeof p.freestanding!=="boolean"||!Array.isArray(p.numericFeatures))
    fail("MODEL_INVALID_EXECUTION_PROFILE");
  const featureKeys=Reflect.ownKeys(p.numericFeatures);
  if(Object.keys(p.numericFeatures).length!==p.numericFeatures.length||
     featureKeys.some(k=>k!=="length"&&!(typeof k==="string"&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<p.numericFeatures.length)))
    fail("MODEL_INVALID_EXECUTION_PROFILE");
  const token=/^[A-Za-z0-9_.+-]{1,64}$/;
  for(let i=0;i<p.numericFeatures.length;i++){
    const d=Object.getOwnPropertyDescriptor(p.numericFeatures,String(i));
    if(!d||!Object.hasOwn(d,"value")||typeof d.value!=="string"||!token.test(d.value))
      fail("MODEL_INVALID_EXECUTION_PROFILE");
    if(i&&Buffer.compare(Buffer.from(p.numericFeatures[i-1],"ascii"),Buffer.from(d.value,"ascii"))>=0)
      fail("MODEL_NONCANONICAL_EXECUTION_PROFILE");
  }
  if(p.deviceAbi!==null&&typeof p.deviceAbi!=="string")fail("MODEL_INVALID_EXECUTION_PROFILE");
  const out=new Bytes();
  out.raw(Buffer.from("ORESLANG-MODEL-PROFILE-V1\0","ascii"));out.u32(1);
  for(const k of ["backendId","backendSemanticVersion","compilerSemanticVersion","targetTriple","dataLayout","runtimeAbi"])out.string(p[k]);
  out.u8(ord(p.numericMode,["strict","ieee","fast"]));
  out.u8(p.deterministic?1:0);
  out.u8(ord(p.allocation,["preallocated","bounded","dynamic"]));
  out.u8(p.freestanding?1:0);
  out.u8(p.deviceAbi===null?0:1);if(p.deviceAbi!==null)out.string(p.deviceAbi);
  out.u32(p.numericFeatures.length);for(const f of p.numericFeatures)out.string(f);
  return out.finish();
}
export function digestExecutionProfileV1(p){
  return createHash("sha256").update(canonicalExecutionProfileV1Bytes(p)).digest("hex");
}
