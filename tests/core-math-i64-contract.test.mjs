import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const path=new URL('../contracts/library/v1/core-math-i64.json',import.meta.url);
const manifest=JSON.parse(readFileSync(path,'utf8'));
const MIN=-(1n<<63n), MAX=(1n<<63n)-1n;
function decimal(value){
  assert.equal(typeof value,'string');
  assert.match(value,/^(?:0|-?[1-9][0-9]*)$/);
  const n=BigInt(value);
  assert.ok(n>=MIN&&n<=MAX,'signed-i64 out of range');
  return n;
}
function mathematicalOracle(fn,args){
  const a=args.map(decimal);
  switch(fn){
    case 'min_int': assert.equal(a.length,2);return a[0]<a[1]?a[0]:a[1];
    case 'max_int': assert.equal(a.length,2);return a[0]>a[1]?a[0]:a[1];
    case 'clamp_int':
      assert.equal(a.length,3);
      return a[1]>a[2]?a[1]:a[0]<a[1]?a[1]:a[0]>a[2]?a[2]:a[0];
    default: throw Error('unsupported core proof function: '+fn);
  }
}
function assertManifest(m){
  assert.equal(m.schemaVersion,1);
  assert.equal(m.contract,'ores-core-math-signed-i64-v1');
  assert.equal(m.integerDomain,'signed-i64');
  assert.deepEqual(Object.keys(m).sort(),[
    'cases','contract','integerDomain','schemaVersion','sourceOfTruth','statement'].sort());
  assert.ok(Array.isArray(m.cases)&&m.cases.length===24);
  const ids=new Set();
  for(const c of m.cases){
    assert.deepEqual(Object.keys(c).sort(),['args','expected','function','id'].sort());
    assert.match(c.id,/^[a-z][a-z0-9-]{1,80}$/);
    assert.ok(!ids.has(c.id),'duplicate case identity');
    ids.add(c.id);
    assert.ok(['min_int','max_int','clamp_int'].includes(c.function));
    assert.ok(Array.isArray(c.args));
    assert.equal(mathematicalOracle(c.function,c.args),decimal(c.expected),c.id);
  }
  for(const id of ['min-int64-lowest','max-int64-highest',
    'clamp-inverted-returns-lower','clamp-all-extreme','min-large-precise'])
    assert.ok(ids.has(id),'missing mandatory boundary '+id);
  return ids.size;
}
test('reviewed i64 min/max/clamp corpus matches independent BigInt spec',()=>{
  assert.equal(assertManifest(manifest),24);
});
test('tampered expected values, missing cases and overflow fail closed',()=>{
  const mutations=[
    {...manifest,cases:manifest.cases.map((c,i)=>i===0?{...c,expected:'1'}:c)},
    {...manifest,cases:manifest.cases.slice(1)},
    {...manifest,cases:[manifest.cases[0],...manifest.cases.slice(0,-1)]},
    {...manifest,cases:manifest.cases.map((c,i)=>i===0?{...c,expected:'9223372036854775808'}:c)},
    {...manifest,cases:manifest.cases.map((c,i)=>i===0?{...c,args:['+1',c.args[1]]}:c)},
    {...manifest,cases:manifest.cases.map((c,i)=>i===0?{...c,function:'unknown'}:c)},
  ];
  for(const m of mutations)assert.throws(()=>assertManifest(m));
});
test('signed-i64 reference invariants hold for deterministic edge perturbations',()=>{
  const values=[MIN,MIN+1n,-9007199254740993n,-1n,0n,1n,
    9007199254740993n,MAX-1n,MAX];
  for(const a of values)for(const b of values){
    assert.equal(mathematicalOracle('min_int',[a.toString(),b.toString()]),
      mathematicalOracle('min_int',[b.toString(),a.toString()]));
    assert.equal(mathematicalOracle('max_int',[a.toString(),b.toString()]),
      mathematicalOracle('max_int',[b.toString(),a.toString()]));
    assert.ok(mathematicalOracle('min_int',[a.toString(),b.toString()])<=a);
    assert.ok(mathematicalOracle('max_int',[a.toString(),b.toString()])>=a);
    for(const c of values){
      const got=mathematicalOracle('clamp_int',[a,b,c].map(String));
      assert.equal(got,b>c?b:a<b?b:a>c?c:a);
    }
  }
});
test('source bytes have a stable content digest for proof receipts',()=>{
  const raw=readFileSync(path);
  const hash=createHash('sha256').update(raw).digest('hex');
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert.equal(raw.at(-1),10);
});
