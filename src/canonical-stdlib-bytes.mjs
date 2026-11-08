import { createHash } from 'node:crypto';

/**
 * Canonical .atto source byte comparator. This checks caller-supplied bytes,
 * not independently retrieved backend compiler source or guest executions.
 */
const targets = ['java','llvm','net','wasm','forge'];
const sha256 = b => createHash('sha256').update(b).digest('hex');
const utf8 = new TextDecoder('utf-8',{fatal:true});
function error(s) {throw new TypeError('E_STDLIB_' + s);}
function own(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.getPrototypeOf(obj) !== Object.prototype ||
      Reflect.ownKeys(obj).length !== keys.length) error('SHAPE');
  for(const k of keys) {
    const descriptor=Object.getOwnPropertyDescriptor(obj,k);
    if(!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor,'value'))
      error('SHAPE');
  }
  if(Reflect.ownKeys(obj).some(k=>!keys.includes(k)))error('SHAPE');
}
const sourcePath = p => typeof p === 'string' &&
  /^stdlib\/[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*\.atto$/.test(p) &&
  !p.includes('..') && p.length <= 160;
function inspectSourceBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length<1 || bytes.length>65536)error('BYTES');
  let text;
  try {text=utf8.decode(bytes);} catch {error('UTF8');}
  if (text.startsWith('\uFEFF') || text.includes('\u0000') || text.includes('\r') ||
      !text.endsWith('\n')) error('SOURCE_ENCODING');
}
function manifestValid(m) {
  own(m,['schema','status','sourcePolicy','sources','targets']);
  if(m.schema!=='atto.stdlib.canonical.v1' ||
     m.status!=='CANDIDATE_NOT_COMPILED' ||
     m.sourcePolicy!=='CANONICAL_ATTO_BYTES_ONLY')error('MANIFEST');
  if(!Array.isArray(m.sources) || m.sources.length<1 || m.sources.length>1024)error('SOURCES');
  let prior='';
  for(const s of m.sources) {
    own(s,['path','sha256','bytes']);
    if(!sourcePath(s.path) || s.path<=prior || !/^[0-9a-f]{64}$/.test(s.sha256) ||
       !Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>65536)error('SOURCE_ENTRY');
    prior=s.path;
  }
  if(!Array.isArray(m.targets) || m.targets.length!==targets.length)error('TARGETS');
  for(let i=0;i<targets.length;i++) {
    own(m.targets[i],['backend','execution']);
    if(m.targets[i].backend!==targets[i] || m.targets[i].execution!=='NOT_EXECUTED')
      error('UNVERIFIED_TARGET');
  }
  return true;
}
function bytesFor(table,path) {
  if(!Object.hasOwn(table,path))error('MISSING_SOURCE');
  return table[path];
}
export function compareCanonicalStdlibBytes(manifest, canonical, copies) {
  manifestValid(manifest);
  own(canonical,manifest.sources.map(s=>s.path));
  own(copies,targets);
  const shaBySource = {};
  const backendBytes = {};
  for(const target of targets) {
    own(copies[target],manifest.sources.map(s=>s.path));
    backendBytes[target] = {};
  }
  for(const src of manifest.sources) {
    const input=bytesFor(canonical,src.path);
    inspectSourceBytes(input);
    if(input.byteLength!==src.bytes || sha256(input)!==src.sha256)error('CANONICAL_CHANGED');
    shaBySource[src.path]=sha256(input);
    for(const target of targets) {
      const copy=bytesFor(copies[target],src.path);
      inspectSourceBytes(copy);
      if(copy.byteLength!==src.bytes || sha256(copy)!==src.sha256 ||
         !Buffer.from(copy).equals(Buffer.from(input)))error('BYTE_DRIFT_' + target.toUpperCase());
      backendBytes[target][src.path]=sha256(copy);
    }
  }
  return Object.freeze({sourceByteIdentical:true, canonicalSha256:shaBySource,
     backendSha256:backendBytes, evidence:'SUPPLIED_BYTES_ONLY',
     compilationExecuted:false, guestParityCertified:false,
     releaseAuthorized:false});
}
