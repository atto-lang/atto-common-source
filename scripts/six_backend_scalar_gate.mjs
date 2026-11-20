/**
 * Offline admission for six independent Oreslang compiler lanes.
 * These receipts and the caller-provided provider observations are UNTRUSTED.
 * A passing result is only a consistent candidate; it MUST be authenticated
 * against live GitHub run/job APIs by an independent reviewer before any
 * compiler conformance, release or executable parity claim.
 */
export const SCALAR_BACKENDS = Object.freeze(['java','llvm','wasm','cranelift','net','forge']);
export const SCALAR_CASES = Object.freeze([
  'precedence', 'negative-multiplication', 'signed-i64-min',
  'checked-i64-overflow', 'unknown-symbol-rejection', 'bad-syntax-rejection'
]);
const OID=/^[a-f0-9]{40}$/;
const TEST_STATUS=new Set(['passed','failed','unsupported','not_executed']);
const exact=(value,fields)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.slice().sort().join(',');
const fail=(why)=>{throw Error('SCALAR_PARITY_NOT_ATTESTED: '+why);};
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);

export function admitSixBackendScalarCandidate(record,provider) {
  if(!exact(record,['version','fixtureBlobSha','backends']) || record.version!==1 ||
     typeof record.fixtureBlobSha!=='string'||!OID.test(record.fixtureBlobSha) ||
     !exact(record.backends,SCALAR_BACKENDS) ||
     !exact(provider,SCALAR_BACKENDS)) fail('incomplete six-backend receipt');
  const result=Object.create(null);
  const totals={passed:0,failed:0,unsupported:0,not_executed:0};
  for(const name of SCALAR_BACKENDS){
    const r=record.backends[name],p=provider[name];
    if(!exact(r,['sourceSha','sourceTreeSha','fixtureBlobSha','runId','jobId','cases']) ||
       typeof r.sourceSha!=='string'||!OID.test(r.sourceSha) ||
       typeof r.sourceTreeSha!=='string'||!OID.test(r.sourceTreeSha) ||
       r.fixtureBlobSha!==record.fixtureBlobSha ||
       !Number.isSafeInteger(r.runId)||r.runId<=0 ||
       !Number.isSafeInteger(r.jobId)||r.jobId<=0 ||
       !exact(r.cases,SCALAR_CASES)) fail(name+' malformed evidence');
    if(!exact(p,['sourceSha','runId','jobId','runnerId','steps','conclusion','event']) ||
       p.sourceSha!==r.sourceSha || p.runId!==r.runId || p.jobId!==r.jobId ||
       !Number.isSafeInteger(p.runnerId)||p.runnerId<=0 ||
       !Number.isSafeInteger(p.steps)||p.steps<3 ||
       p.conclusion!=='success' ||
       !['pull_request','push','workflow_dispatch'].includes(p.event))
      fail(name+' missing independently observed stepful exact-head run');
    const cases=Object.create(null);
    for(const id of SCALAR_CASES){
      const status=r.cases[id];
      if(typeof status!=='string'||!TEST_STATUS.has(status))
        fail(name+' invalid '+id+' status');
      cases[id]=status;totals[status]++;
    }
    result[name]={cases};
  }
  if(Object.values(totals).reduce((a,b)=>a+b,0)!==SCALAR_BACKENDS.length*SCALAR_CASES.length)
    fail('incomplete case matrix');
  // A successful CI job does not make a failed, missing, or unsupported
  // guest test into a passing test. This is intentionally NOT green parity.
  return Object.freeze({classification:'UNTRUSTED_CANDIDATE_ONLY',
    fixtureBlobSha:record.fixtureBlobSha,backends:result,totals,
    requiresIndependentLiveGithubVerification:true,
    compilerParityCertified:false});
}

export function assertExecutedSixBackendScalarParity(record,provider){
  const candidate=admitSixBackendScalarCandidate(record,provider);
  if(candidate.totals.passed!==SCALAR_BACKENDS.length*SCALAR_CASES.length ||
      candidate.totals.failed||candidate.totals.unsupported||candidate.totals.not_executed)
    fail('unsupported, missing, failed, or unexecuted guest results');
  // Even an all-pass, self-declared receipt cannot be promoted without
  // authenticated live evidence. This library deliberately NEVER attests.
  fail('requires independent authenticated provider verification');
}
