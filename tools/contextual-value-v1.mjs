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
const region=x=>Array.isArray(x)&&x.length>=1&&x.length<=32&&x.every(id)&&new Set(x).size===x.length;
const inside=(child,parent)=>parent.length<=child.length&&parent.every((p,i)=>p===child[i]);
function parseUnique(json){
  if(typeof json!=='string'||json.length>MAX)deny('input budget');
  let v;try{v=JSON.parse(json);}catch{deny('JSON');}
  // JSON.parse alone silently overwrites duplicate (including escaped) keys.
  // The validated JSON grammar makes string/structural token scanning sufficient.
  const stack=[];
  for(const m of json.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/g)){
    const t=m[0];
    if(t==='{'||t==='['){
      if(stack.length>=64)deny('JSON nesting budget');
      stack.push(t==='{'?new Set():null);
    }else if(t==='}'||t===']')stack.pop();
    else if(t[0]==='"'&&json.slice(m.index+t.length).trimStart().startsWith(':')){
      const keys=stack.at(-1),key=JSON.parse(t);
      if(!keys||keys.has(key))deny('duplicate JSON key');
      keys.add(key);
    }
  }
  return v;
}
export function checkContextValue(json){
  const v=parseUnique(json);
  record(v,['owner','schema','slots','evaluationOrder','destination']);
  if(!id(v.owner)||!id(v.schema)||!Array.isArray(v.slots)||v.slots.length<1||v.slots.length>32)deny('owner/schema/slots');
  record(v.destination,['actor','regionPath','operation']);
  const d=v.destination;
  if(!id(d.actor)||!region(d.regionPath)||!['bind','copy','move','borrow'].includes(d.operation))deny('destination');
  const names=new Set(),ord=new Set();
  for(const s of v.slots){
    record(s,['name','type','ownership','actor','regionPath','generation']);
    if(!id(s.name)||names.has(s.name)||!['int','bool','allocator'].includes(s.type)||!['copy','move','borrow'].includes(s.ownership))deny('slot schema');
    names.add(s.name);
    if(s.type==='allocator'){
      if(!id(s.actor)||!region(s.regionPath)||!integer(s.generation)||s.generation===0||
         s.ownership==='copy'||d.operation==='copy')deny('allocator proof or duplication');
      if(d.actor!==s.actor)deny('actor-private capability transfer');
      if(!inside(d.regionPath,s.regionPath))deny('region escape');
      if(s.ownership==='borrow'&&d.operation==='move')deny('borrow cannot move authority');
    }else if(s.ownership!=='copy'||s.actor!==null||s.regionPath!==null||s.generation!==null)
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

// A host-only ordered invocation plan. The schema and operand identities are
// symbolic inputs, not authenticated compiler objects. A backend must resolve
// and type-check them before consuming this plan.
export function planContextInvocation(json){
  const p=parseUnique(json);
  record(p,['schema','binding','mode','contextOperands','ordinaryOperands','storedSlots']);
  const schema=p.schema,b=p.binding;
  record(schema,['owner','id','context','ordinary','result']);
  if(!id(schema.owner)||!id(schema.id)||!['int','bool','void'].includes(schema.result)||
     !Array.isArray(schema.context)||!Array.isArray(schema.ordinary)||
     schema.context.length<1||schema.context.length+schema.ordinary.length>32)deny('resolved schema shape');
  const names=new Set();
  for(const [kind,params] of [['context',schema.context],['ordinary',schema.ordinary]]){
    for(const param of params){
      record(param,['name','type']);
      if(!id(param.name)||names.has(param.name)||
         !(kind==='context'?['int','bool','allocator']:['int','bool']).includes(param.type))deny('resolved parameter schema');
      names.add(param.name);
    }
  }
  const binding=checkContextValue(JSON.stringify(b));
  if(binding.owner!==schema.owner||binding.schema!==schema.id||binding.slotCount!==schema.context.length)
    deny('nominal schema mismatch');
  for(let i=0;i<schema.context.length;i++){
    if(b.slots[i].name!==schema.context[i].name||b.slots[i].type!==schema.context[i].type)deny('slot schema mismatch');
  }
  if(!['direct','stored'].includes(p.mode)||!Array.isArray(p.contextOperands)||
     !Array.isArray(p.ordinaryOperands)||!Array.isArray(p.storedSlots))deny('invocation mode');
  if(p.ordinaryOperands.length!==schema.ordinary.length)deny('ordinary operand arity');
  const refs=new Set(),sequence=[],contextRefs=[];
  function operand(o,expected,phase,slot,evaluate){
    record(o,['id','type']);
    if(!id(o.id)||refs.has(o.id)||o.type!==expected)deny('operand identity or type mismatch');
    refs.add(o.id);
    if(evaluate)sequence.push(Object.freeze({phase,slot,operand:o.id,type:o.type}));
    return o.id;
  }
  if(p.mode==='direct'){
    if(b.destination.operation!=='bind'||p.storedSlots.length!==0||
       p.contextOperands.length!==schema.context.length)deny('direct context operand shape');
    binding.evaluationOrder.forEach((slot,k)=>{
      contextRefs[slot]=operand(p.contextOperands[k],schema.context[slot].type,'context',slot,true);
    });
  }else{
    if(p.contextOperands.length!==0||p.storedSlots.length!==schema.context.length)
      deny('stored context must not recapture');
    p.storedSlots.forEach((o,slot)=>{contextRefs[slot]=operand(o,schema.context[slot].type,'context',slot,false);});
  }
  const ordinaryRefs=p.ordinaryOperands.map((o,slot)=>operand(o,schema.ordinary[slot].type,'ordinary',slot,true));
  return Object.freeze({owner:schema.owner,schema:schema.id,mode:p.mode,result:schema.result,
    evaluation:Object.freeze(sequence),parameterOperands:Object.freeze([...contextRefs,...ordinaryRefs]),
    copyable:binding.copyable});
}
