// Compiler-only symbolic model. This is not a runtime allocator or verifier.
// Inputs are JSON text to avoid accessors, prototypes and mutable input aliasing.
const MAX=32768;
const deny=(reason)=>{throw new TypeError('E_CONTEXT_CONTRACT: '+reason);};
function record(x,keys){
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.getPrototypeOf(x)!==Object.prototype||
     Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))deny('record shape');
}
const id=x=>typeof x==='string'&&/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0&&!Object.is(x,-0);
export function checkContextValue(json){
  if(typeof json!=='string'||json.length>MAX)deny('input budget');
  let v;try{v=JSON.parse(json);}catch{deny('JSON');}
  record(v,['owner','schema','slots','evaluationOrder','destination']);
  if(!id(v.owner)||!id(v.schema)||!Array.isArray(v.slots)||v.slots.length<1||v.slots.length>32)deny('owner/schema/slots');
  record(v.destination,['actor','regionDepth','operation']);
  const d=v.destination;
  if(!id(d.actor)||!integer(d.regionDepth)||!['bind','copy','move','borrow'].includes(d.operation))deny('destination');
  const names=new Set(),ord=new Set();
  for(const s of v.slots){
    record(s,['name','type','ownership','actor','regionDepth','generation']);
    if(!id(s.name)||names.has(s.name)||!['int','bool','allocator'].includes(s.type)||!['copy','move','borrow'].includes(s.ownership))deny('slot schema');
    names.add(s.name);
    if(s.type==='allocator'){
      if(!id(s.actor)||!integer(s.regionDepth)||!integer(s.generation)||s.generation===0||
         s.ownership==='copy'||d.operation==='copy')deny('allocator proof or duplication');
      if(d.actor!==s.actor)deny('actor-private capability transfer');
      if(d.regionDepth<s.regionDepth)deny('region escape');
      if(s.ownership==='borrow'&&d.operation==='move')deny('borrow cannot move authority');
    }else if(s.ownership!=='copy'||s.actor!==null||s.regionDepth!==null||s.generation!==null)
      deny('scalar slot shape');
  }
  if(!Array.isArray(v.evaluationOrder)||v.evaluationOrder.length!==v.slots.length)deny('evaluation order');
  for(const i of v.evaluationOrder){
    if(!integer(i)||i>=v.slots.length||ord.has(i))deny('evaluation permutation');
    ord.add(i);
  }
  return Object.freeze({owner:v.owner,schema:v.schema,slotCount:v.slots.length,
    copyable:v.slots.every(s=>s.ownership==='copy'),evaluationOrder:Object.freeze([...v.evaluationOrder])});
}
