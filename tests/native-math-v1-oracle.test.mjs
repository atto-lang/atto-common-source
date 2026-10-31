import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const raw = readFileSync(new URL('../conformance/native-math-v1.toml',import.meta.url),'utf8');
const errors = JSON.parse(readFileSync(
  new URL('../contracts/v1/numeric-error-abi.json',import.meta.url),'utf8'));
const MIN = -(1n<<63n), MAX = (1n<<63n)-1n;
const OVERFLOW = 65537;

function parseCases() {
  const blocks=raw.split(/^\[\[case\]\]\s*$/m).slice(1);
  return blocks.map(block=>{
    const v={};
    for(const line of block.split('\n')){
      const m=/^([a-z_]+)\s*=\s*(?:"([^"]*)"|([0-9]+)|(?:true|false))\s*$/.exec(line.trim());
      if(!m) {if(line.trim()==='' || /^\[/.test(line)) continue; throw Error('unexpected case field: '+line);}
      if(Object.hasOwn(v,m[1])) throw Error('duplicate case key '+m[1]);
      v[m[1]]=m[2]??(m[3]===undefined?(line.trim().endsWith('true')?true:false):Number(m[3]));
    }
    return v;
  });
}
const all=parseCases(), byId=new Map(all.map(c=>[c.id,c]));
function signed(value) {const x=BigInt(value); if(x<MIN || x>MAX) throw Error('integer overflow'); return x;}
function checked(c) {
  switch(c.op) {
    case 'abs':return signed(c.input)<0n?signed(-signed(c.input)):signed(c.input);
    case 'neg':return signed(-signed(c.input));
    case 'add':return signed(signed(c.left)+signed(c.right));
    case 'sub':return signed(signed(c.left)-signed(c.right));
    case 'mul':return signed(signed(c.left)*signed(c.right));
    default:throw Error('unsupported oracle '+c.op);
  }
}
function f64(bits){
  const b=new ArrayBuffer(8), d=new DataView(b);
  d.setBigUint64(0,BigInt(bits),false);
  return d.getFloat64(0,false);
}
function bits(x){
  const b=new ArrayBuffer(8),d=new DataView(b);
  d.setFloat64(0,x,false);
  return '0x'+d.getBigUint64(0,false).toString(16).padStart(16,'0');
}
test('native numeric registry uses stable typed errors and lowercase source spellings',()=>{
  assert.equal(errors.schema,'oreslang.numeric-error-abi.v1');
  assert.equal(errors.errors.find(x=>x.type==='ArithmeticOverflowError').code,OVERFLOW);
  assert.equal(new Set(all.map(c=>c.id)).size,all.length);
  assert.ok(all.length>=20);
  for(const c of all) {
    assert.ok(['i64','u64','f64','bigint','decimal'].includes(c.type),c.id);
    if(c.expect_error==='ArithmeticOverflowError')
      assert.equal(c.expect_error_code,OVERFLOW,c.id);
  }
  assert.equal(byId.get('bigint_div_zero').expect_error,'DivisionByZeroError');
  assert.equal(byId.get('decimal_one_third_no_context').expect_error,'NonterminatingDecimalError');
});
test('all checked signed integer boundary cases agree with a BigInt oracle',()=>{
  let validated=0;
  for(const c of all.filter(c=>c.family==='signed_integer')) {
    if(c.expect_error) {
      assert.equal(c.expect_error,'ArithmeticOverflowError');
      assert.throws(()=>checked(c),/integer overflow/,c.id);
    } else {
      assert.equal(checked(c),BigInt(c.expect),c.id);
    }
    validated++;
  }
  assert.ok(validated>=7);
});
test('unsigned negation cannot silently become signed wraparound',()=>{
  assert.equal(byId.get('u64_abs_max').expect,'18446744073709551615');
  assert.equal(byId.get('u64_neg_rejected').expect_error,'TypeError');
});
test('IEEE binary64 edge cases preserve observable bit patterns',()=>{
  for(const c of all.filter(c=>c.family==='binary_float')){
    if(c.input_bits && c.expect_bits){
      const input=f64(c.input_bits);
      const actual=c.op==='abs'?Math.abs(input):-input;
      assert.equal(bits(actual),c.expect_bits,c.id);
    } else if(c.op==='compare_self'){
      assert.ok(Number.isNaN(f64(c.input_bits)),c.id);
    } else if(c.id==='f64_point_one_plus_point_two'){
      assert.notEqual(Number(c.left)+Number(c.right),Number(c.expect_not_exact_decimal));
    }
  }
});
test('BigInt quotient truncates toward zero and remainder retains dividend sign',()=>{
  for(const c of all.filter(c=>c.family==='bigint'&&c.op==='div_rem')){
    const left=BigInt(c.left),right=BigInt(c.right);
    assert.equal(left/right,BigInt(c.expect_quotient),c.id);
    assert.equal(left%right,BigInt(c.expect_remainder),c.id);
    assert.equal(left,(left/right)*right+(left%right));
  }
});
test('decimal addition uses exact base-ten coefficients, not binary64',()=>{
  const c=byId.get('decimal_point_one_plus_point_two');
  assert.equal(c.type,'decimal');
  const parse=x=>{const [whole,fraction='']=x.split('.');return {n:BigInt(whole+fraction),scale:fraction.length};};
  const a=parse(c.left),b=parse(c.right);
  const scale=Math.max(a.scale,b.scale);
  const sum=a.n*10n**BigInt(scale-a.scale)+b.n*10n**BigInt(scale-b.scale);
  const divisor=10n**BigInt(scale);
  assert.equal((sum/divisor).toString()+'.'+(sum%divisor).toString().padStart(scale,'0'),c.expect);
  assert.notEqual(0.1+0.2,0.3);
});
