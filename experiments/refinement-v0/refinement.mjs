// Experimental standalone refinement contract normalizer.
// NOT a compiler frontend: do not use as evidence of Oreslang admission.
// Safe subset: string/int, known comparisons, bounded pure where, checked construction.
export const { spec, validate, tryFrom, entails, codePoints, ContractError } = (function refinementCore() {
  const MAX_SOURCE=32768;
  class ContractError extends Error { constructor(code,message){ super(message); this.name="ContractError"; this.code=code; } }
  const fail=(code,message)=>{throw new ContractError(code,message)};
  const OPS=new Map([["eq","eq"],["==","eq"],["ne","ne"],["!=","ne"],["gt","gt"],[">","gt"],["ge","ge"],["gte","ge"],[">=","ge"],["lt","lt"],["<","lt"],["le","le"],["lte","le"],["<=","le"]]);
  function tokens(input) {
    if(typeof input!=="string" || input.length>MAX_SOURCE) fail("R001","invalid/oversized declaration");
    const out=[]; let i=0;
    const rx=/^(?:[A-Za-z_][A-Za-z_0-9]*|-?[0-9]+|>=|<=|==|!=|&&|\|\||[@=();,.<>[\]])/;
    while(i<input.length){
      if(/\s/.test(input[i])){i++;continue;}
      const m=input.slice(i).match(rx);
      if(!m) fail("R002",`unexpected character at offset ${i}`);
      out.push(m[0]); i+=m[0].length;
      if(out.length>256)fail("R001","too many tokens");
    }
    return out;
  }
  function spec(source){
    const t=tokens(source), idx={i:0}, p=()=>t[idx.i], take=()=>t[idx.i++], takeIf=x=>{if(p()===x){take();return true}return false};
    const need=x=>{if(!takeIf(x)) fail("R003",`expected '${x}', got '${p()??"<end>"}'`)};
    const integer=()=>{
      const v=take();
      if(!/^-?[0-9]+$/.test(v||""))fail("R004","integer constant required");
      const n=Number(v);
      if(!Number.isSafeInteger(n))fail("R004","integer constant exceeds safe proof range");
      return n;
    };
    const ident=()=>{const v=take();if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(v||""))fail("R003","identifier required");return v};
    const annotations=[];
    while(takeIf("@")){
      const ann=ident(), args={};
      if(takeIf("(")){
        if(!takeIf(")")){
          do {const key=ident();need("=");if(Object.hasOwn(args,key)) fail("R005","duplicate annotation argument");args[key]=integer();}while(takeIf(","));
          need(")");
        }
      }
      annotations.push({ann,args});
    }
    const nominal=takeIf("define");
    if(nominal)need("newtype"); else need("type");
    const name=ident();
    let base;
    if(nominal){need("(");base=ident();need(")");}else{need("=");base=ident();}
    const kind=base==="string"||base==="String"?"string":base==="int"?"int":null;
    if(!kind)fail("R006","prototype currently supports only string and int base types");
    const expectedProperty=kind==="string"?"length":"value";
    const compare=()=>{
      const prop=ident();
      if(prop!==expectedProperty)fail("R007",`unsupported property '${prop}' on ${base}`);
      const token=take(),op=OPS.get(token);
      if(!op)fail("R008",`unknown comparison '${token}'`);
      const n=integer();
      if(prop==="length" && n<0 && (op==="eq"||op==="ge"||op==="gt"))
        fail("R009","negative string length is impossible");
      return {property:prop,op,n};
    };
    const conditions=[];
    let where=null;
    if(takeIf("with")) {
      conditions.push(compare());
      while(takeIf("and"))conditions.push(compare());
    } else if(takeIf("where")) {
      // Deliberately bounded pure subset; no method invocation, host access or free variables.
      const parseAtom=()=>{
        need("it");
        let prop="value";
        if(takeIf("."))prop=ident();
        if(prop!==expectedProperty)fail("R007",`unsupported 'where' projection '${prop}'`);
        const operator=take(),op=OPS.get(operator);
        if(!op)fail("R008",`unsupported 'where' comparison '${operator}'`);
        return {property:prop,op,n:integer()};
      };
      const parseAnd=()=>{
        const nodes=[parseAtom()];
        while(takeIf("and")||takeIf("&&"))nodes.push(parseAtom());
        return nodes.length===1?nodes[0]:{and:nodes};
      };
      const parseOr=()=>{
        const nodes=[parseAnd()];
        while(takeIf("or")||takeIf("||"))nodes.push(parseAnd());
        return nodes.length===1?nodes[0]:{or:nodes};
      };
      where=parseOr();
    }
    need(";");
    if(idx.i!==t.length)fail("R003","tokens after declaration terminator");
    const clauses=annotations.map(({ann,args})=>{
      if(ann==="NotEmpty"){if(Object.keys(args).length)fail("R010","@NotEmpty takes no arguments");return [{property:expectedProperty,op:"gt",n:0}];}
      if(ann==="Size"){
        if(kind!=="string")fail("R007","@Size on unsupported type");
        const keys=Object.keys(args);if(!keys.length||keys.some(x=>x!=="min"&&x!=="max"))fail("R010","@Size supports min,max");
        return keys.map(key=>({property:expectedProperty,op:key==="min"?"ge":"le",n:args[key]}));
      }
      if(ann==="Length"){
        if(kind!=="string")fail("R007","@Length requires string");
        const keys=Object.keys(args);if(!keys.length||keys.some(x=>!["eq","min","max"].includes(x)))fail("R010","@Length supports eq,min,max");
        return keys.map(key=>({property:"length",op:key==="eq"?"eq":key==="min"?"ge":"le",n:args[key]}));
      }
      fail("R010",`unknown constraint annotation @${ann}`);
    }).flat();
    conditions.unshift(...clauses);
    if(!where&&!conditions.length)fail("R011","declaration has no refinement");
    const lo=kind==="string"?0:Number.MIN_SAFE_INTEGER,hi=Number.MAX_SAFE_INTEGER;
    let min=lo,max=hi,excluded=[];
    for(const c of conditions){
      const n=c.n;
      switch(c.op){
        case "eq": min=Math.max(min,n);max=Math.min(max,n);break;
        case "ge": min=Math.max(min,n);break;
        case "gt": min=Math.max(min,n+1);break;
        case "le": max=Math.min(max,n);break;
        case "lt": max=Math.min(max,n-1);break;
        case "ne": excluded.push(n);break;
      }
    }
    excluded=[...new Set(excluded)].sort((a,b)=>a-b);
    if(min>max||min===max&&excluded.includes(min))fail("R012","unsatisfiable constraint");
    // For bounded small domains prove emptiness even with exclusions.
    if(max-min>=0&&max-min<excluded.length&&max-min<10000){
      let any=false;for(let x=min;x<=max;x++){if(!excluded.includes(x)){any=true;break;}}
      if(!any)fail("R012","unsatisfiable constraint exclusions");
    }
    return Object.freeze({name,base:kind,nominal,property:expectedProperty,min,max,excluded:Object.freeze(excluded),where,normalized:conditions});
  }
  function codePoints(value){
    if(typeof value!=="string")fail("R013","expected string");
    let count=0;
    for(const ch of value){const x=ch.charCodeAt(0);if(x>=0xD800&&x<=0xDFFF&&ch.length===1)fail("R014","invalid Unicode scalar");count++;}
    return count;
  }
  const testOp=(x,{op,n})=>({eq:x===n,ne:x!==n,gt:x>n,ge:x>=n,lt:x<n,le:x<=n})[op];
  function checkWhere(value,tree){if(!tree)return true;if(tree.and)return tree.and.every(x=>checkWhere(value,x));if(tree.or)return tree.or.some(x=>checkWhere(value,x));return testOp(value,tree);}
  function validate(contract,value){
    const v=contract.base==="string"?codePoints(value):(Number.isSafeInteger(value)?value:fail("R013","expected safe int"));
    return v>=contract.min&&v<=contract.max&&!contract.excluded.includes(v)&&checkWhere(v,contract.where);
  }
  function tryFrom(contract,raw){
    try{
      if(!validate(contract,raw))return {ok:false,error:{code:"R015",type:contract.name,reason:"constraint failure"}};
      return {ok:true,value:contract.nominal?Object.freeze({type:contract.name,underlying:raw}):raw};
    }catch(e){if(e instanceof ContractError)return {ok:false,error:{code:e.code,type:contract.name,reason:e.message}};throw e;}
  }
  function entails(a,b){
    if(a.base!==b.base)return false;
    if(b.nominal)return a.nominal&&a.name===b.name;
    if(a.nominal)return false; // no implicit unwrap of a nominal newtype
    if(a.where||b.where)return JSON.stringify(a.where)===JSON.stringify(b.where)&&a.min>=b.min&&a.max<=b.max;
    if(a.min<b.min||a.max>b.max)return false;
    for(const hole of b.excluded){if(hole>=a.min&&hole<=a.max&&!a.excluded.includes(hole))return false;}
    return true;
  }
  return {spec,validate,tryFrom,entails,codePoints,ContractError};
})();
