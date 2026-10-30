import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract=JSON.parse(readFileSync(
  new URL("../contracts/library/v1/decimal-precision.json", import.meta.url),"utf8"));

const pow10=n=>10n**BigInt(n);

function parseDecimal(text){
  const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if(!m) throw new Error("unsupported reference decimal "+text);
  const frac=m[3]??"";
  let coeff=BigInt(m[2]+frac);
  if(m[1]) coeff=-coeff;
  return {coeff,scale:frac.length};
}
function formatDecimal({coeff,scale}){
  const neg=coeff<0n;
  let digits=(neg?-coeff:coeff).toString();
  if(scale===0) return (neg?"-":"")+digits;
  if(digits.length<=scale) digits="0".repeat(scale+1-digits.length)+digits;
  const at=digits.length-scale;
  return (neg?"-":"")+digits.slice(0,at)+"."+digits.slice(at);
}
function align(a,b){
  const scale=Math.max(a.scale,b.scale);
  return [
    a.coeff*pow10(scale-a.scale),
    b.coeff*pow10(scale-b.scale),
    scale
  ];
}
function add(a,b){const [x,y,scale]=align(a,b);return {coeff:x+y,scale};}
function sub(a,b){const [x,y,scale]=align(a,b);return {coeff:x-y,scale};}
function mul(a,b){return {coeff:a.coeff*b.coeff,scale:a.scale+b.scale};}

function divExact(a,b){
  if(b.coeff===0n) return {error:"DIVISOR_ZERO"};
  let num=a.coeff*pow10(b.scale), den=b.coeff*pow10(a.scale);
  const neg=(num<0n)!==(den<0n);
  if(num<0n) num=-num;if(den<0n) den=-den;
  let scale=0;
  while(num%den!==0n && scale<256){num*=10n;scale++;}
  if(num%den!==0n) return {error:"NONTERMINATING_REQUIRES_CONTEXT"};
  let coeff=num/den;if(neg)coeff=-coeff;
  return {coeff,scale};
}
function roundHalfEven(value,precision){
  let coeff=value.coeff;
  const sign=coeff<0n?-1n:1n;
  let mag=coeff<0n?-coeff:coeff;
  const digits=mag.toString().length;
  if(digits<=precision)return value;
  const drop=digits-precision, divisor=pow10(drop);
  let q=mag/divisor, r=mag%divisor;
  const twice=r*2n;
  if(twice>divisor || (twice===divisor && q%2n===1n)) q++;
  return {coeff:q*sign,scale:Math.max(0,value.scale-drop)};
}
function divideWithPrecision(a,b,precision){
  if(b.coeff===0n)return {error:"DIVISOR_ZERO"};
  let num=a.coeff*pow10(b.scale),den=b.coeff*pow10(a.scale);
  const neg=(num<0n)!==(den<0n);if(num<0n)num=-num;if(den<0n)den=-den;
  // This contract vector is < 1; generate precision significant fractional digits.
  const scaled=num*pow10(precision);
  let q=scaled/den,r=scaled%den;
  if(r*2n>den || (r*2n===den && q%2n===1n))q++;
  if(neg)q=-q;
  return {coeff:q,scale:precision};
}

test("decimal contract identity and resource policy are closed",()=>{
  assert.equal(contract.contract,"oreslang.decimal-precision.v1");
  assert.equal(contract.status,"normative-reference-not-backend-proof");
  assert.match(contract.semantics.resource_policy,/bounded/);
  const ids=[...contract.exact_cases,...contract.context_cases,...contract.conversion_cases].map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
});

test("decimal exact arithmetic never routes through binary floating point",()=>{
  for(const item of contract.exact_cases){
    const a=parseDecimal(item.left),b=parseDecimal(item.right);
    let actual;
    if(item.operation==="add")actual=add(a,b);
    else if(item.operation==="sub")actual=sub(a,b);
    else if(item.operation==="mul")actual=mul(a,b);
    else if(item.operation==="div_exact")actual=divExact(a,b);
    else throw new Error("unknown op "+item.operation);
    if(item.error) assert.equal(actual.error,item.error,item.id);
    else assert.equal(formatDecimal(actual),item.expect,item.id);
  }
});

test("decimal HALF_EVEN context vectors are deterministic",()=>{
  for(const item of contract.context_cases){
    assert.equal(item.rounding,"HALF_EVEN",item.id);
    let actual;
    if(item.operation==="round") actual=roundHalfEven(parseDecimal(item.operand),item.precision);
    else if(item.operation==="div") actual=divideWithPrecision(parseDecimal(item.left),parseDecimal(item.right),item.precision);
    else throw new Error("unknown context op "+item.operation);
    assert.equal(formatDecimal(actual),item.expect,item.id);
  }
});

function f64Rational(value){
  const b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,value,false);
  const raw=v.getBigUint64(0,false);
  const sign=(raw>>63n)===0n?1n:-1n;
  const exp=Number((raw>>52n)&0x7ffn), frac=raw&((1n<<52n)-1n);
  if(exp===0x7ff) throw new Error("non-finite f64");
  if(exp===0){
    if(frac===0n)return {num:0n,den:1n};
    return {num:sign*frac,den:1n<<1074n};
  }
  const sig=(1n<<52n)|frac, e2=exp-1023-52;
  return e2>=0
    ? {num:sign*sig*(1n<<BigInt(e2)),den:1n}
    : {num:sign*sig,den:1n<<BigInt(-e2)};
}
test("decimal to-f64 contract distinguishes exact from nearest",()=>{
  const bits=value=>{const b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,value,false);return v.getBigUint64(0,false).toString(16).padStart(16,"0");};
  for(const item of contract.conversion_cases){
    const d=parseDecimal(item.operand);
    const n=Number(item.operand);
    if(item.operation==="to_f64_nearest"){
      assert.equal(bits(n),item.expect_bits,item.id);
      continue;
    }
    const binary=f64Rational(n);
    const exact=d.coeff*binary.den===binary.num*pow10(d.scale);
    if(item.error) assert.equal(exact,false,item.id);
    else {
      assert.equal(exact,true,item.id);
      assert.equal(bits(n),item.expect_bits,item.id);
    }
  }
});
