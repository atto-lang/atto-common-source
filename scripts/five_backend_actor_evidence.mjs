/**
 * Offline consistency parser for captured GitHub Actions actor-contract logs.
 * Caller MUST independently authenticate the run, job, runner and exact source
 * commit: a raw log is untrusted text and is not itself execution attestation.
 *
 * "unsupported" is intentionally not counted as a test pass.
 */
export const ACTOR_BACKENDS=Object.freeze(["java","llvm","net","wasm","forge"]);
export const ACTOR_CASES=Object.freeze([
  "actor-ref-on-wire","boolean-singleton","callable","messagepack-v2",
  "nested-borrow","primitive","runtime-envelope","same-id-cross-mailbox",
  "shared-lock-on-wire","stale-generation","unknown-nominal",
  "unregistered-json","unregistered-protobuf"
]);

const VALID=new Set(["passed","failed","unsupported"]);
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const timestamp=/^\d{4}-\d\d-\d\dT[^\s]+Z\s+/;

/** @returns {{cases:string[], backends:object, total:object}} */
export function parseFiveBackendActorEvidence(log){
  if(typeof log!=="string"||log.length===0||log.length>2000000)
    throw Error("missing or oversized raw Actions job log");
  const records=Object.create(null),summaries=Object.create(null);
  for(const raw of log.split(/\r?\n/)){
    const line=raw.replace(/\x1b\[[0-9;]*m/g,"").replace(timestamp,"");
    const match=/^(java|llvm|net|wasm|forge)\s+(\{.*\})$/.exec(line);
    if(!match)continue;
    const [,backend,rawObject]=match;
    if(rawObject.startsWith('{"')){
      if(own(records,backend))throw Error("duplicate backend case record: "+backend);
      let result;
      try{result=JSON.parse(rawObject)}catch{throw Error("malformed backend JSON: "+backend)}
      if(!result||Array.isArray(result)||typeof result!=="object"||
         Object.keys(result).length!==ACTOR_CASES.length||
         ACTOR_CASES.some(c=>!own(result,c)))
        throw Error("missing or unrecognized case in "+backend);
      for(const [name,state] of Object.entries(result)){
        if(!ACTOR_CASES.includes(name)||typeof state!=="string"||!VALID.has(state))
          throw Error("unsupported evidence state or case in "+backend);
      }
      records[backend]=result;
    }else if(rawObject.startsWith("{'")){
      if(own(summaries,backend))throw Error("duplicate backend summary: "+backend);
      const counts=/^\{'passed':\s*(\d+),\s*'failed':\s*(\d+),\s*'unsupported':\s*(\d+)\}$/.exec(rawObject);
      if(!counts)throw Error("malformed backend summary: "+backend);
      summaries[backend]={passed:Number(counts[1]),failed:Number(counts[2]),unsupported:Number(counts[3])};
    }
  }
  const backends=Object.create(null);
  const total={passed:0,failed:0,unsupported:0};
  for(const backend of ACTOR_BACKENDS){
    if(!own(records,backend)||!own(summaries,backend))
      throw Error("missing case record or summary for "+backend);
    const states=records[backend],derived={passed:0,failed:0,unsupported:0};
    for(const state of Object.values(states))derived[state]++;
    for(const status of Object.keys(total)){
      if(derived[status]!==summaries[backend][status])
        throw Error("case counts disagree with summary: "+backend+"."+status);
      total[status]+=derived[status];
    }
    backends[backend]={...derived,cases:{...states}};
  }
  if(total.passed+total.failed+total.unsupported!==65)
    throw Error("incomplete five-backend case matrix");
  return {cases:[...ACTOR_CASES],backends,total};
}
