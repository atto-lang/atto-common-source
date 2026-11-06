// Shared HIR/MIR proposal contract: model/structural observations must not
// silently upgrade to compiled guest execution, source ownership or backend parity.
const SHA=/^[0-9a-f]{40}$/;
const REQUIRED=Object.freeze(['java','llvm','wasm','net','forge']);
const OPTIONAL=Object.freeze(['js','cranelift']);
export {REQUIRED as REQUIRED_BACKENDS};
const issue=(code,backend=null)=>({code,...(backend===null?{}:{backend})});
const same=(a,b)=>a===b;
export function evaluateSharedCompilerEvidence({contract,records,includeOptional=[]}={}){
  const problems=[];
  if(!contract||contract.schemaVersion!==1||!SHA.test(contract.hirContractSha??'')||
     !SHA.test(contract.mirContractSha??'')||!SHA.test(contract.sourceFixtureSha??''))
    problems.push(issue('CONTRACT_IDENTITY_UNVERIFIED'));
  if(!Array.isArray(includeOptional)||includeOptional.some(x=>!OPTIONAL.includes(x))||new Set(includeOptional).size!==includeOptional.length)
    problems.push(issue('INVALID_OPTIONAL_BACKENDS'));
  if(!Array.isArray(records)||records.length>32)problems.push(issue('RECORDS_UNVERIFIED'));
  const expected=[...REQUIRED,...(Array.isArray(includeOptional)?includeOptional.filter(x=>OPTIONAL.includes(x)):[])];
  const byBackend=new Map();
  for(const rec of (Array.isArray(records)?records:[])){
    if(!rec||typeof rec!=='object'||Array.isArray(rec)||typeof rec.backend!=='string'||!expected.includes(rec.backend)){
      problems.push(issue('UNEXPECTED_BACKEND',rec?.backend??null));continue;
    }
    if(byBackend.has(rec.backend))problems.push(issue('DUPLICATE_BACKEND',rec.backend));
    else byBackend.set(rec.backend,rec);
  }
  const tiers={};
  for(const backend of expected){
    const rec=byBackend.get(backend);
    if(!rec){problems.push(issue('BACKEND_NOT_EXECUTED',backend));tiers[backend]='NOT_EXECUTED';continue;}
    if(!SHA.test(rec.sourceFixtureSha??'')||!same(rec.sourceFixtureSha,contract?.sourceFixtureSha)||
       !SHA.test(rec.hirContractSha??'')||!same(rec.hirContractSha,contract?.hirContractSha)||
       !SHA.test(rec.mirContractSha??'')||!same(rec.mirContractSha,contract?.mirContractSha)){
      problems.push(issue('CONTRACT_MISMATCH',backend));tiers[backend]='UNVERIFIED';continue;
    }
    if(!Array.isArray(rec.passes)||rec.passes.length!==3||
       rec.passes.some((x,i)=>x!==['parse','typecheck','lower'][i])){
      problems.push(issue('SEMANTIC_STAGE_UNVERIFIED',backend));tiers[backend]='UNVERIFIED';continue;
    }
    // Never infer native compilation, AOT or guest execution from stages alone.
    tiers[backend]='HIR_MIR_STRUCTURAL_ONLY';
  }
  return {status:problems.length?'INCOMPLETE':'STRUCTURAL_CANDIDATE',problems,tiers,
    actualGuestRuns:0,certifiedParity:false,sourceTransferAuthorized:false,releaseAuthorized:false};
}
