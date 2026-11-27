import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
function compare(left,right){
  const read=(entries)=>{const m=new Map();for(const [k,v] of entries){if(typeof k!=="string"||!(v===null||Number.isSafeInteger(v))||m.has(k))throw new Error("invalid fixture");m.set(k,v)}return m};
  const a=read(left),b=read(right);
  let overlap=0,conflict=false;
  for(const [k,v] of a){if(b.has(k)){overlap++;if(v!==b.get(k))conflict=true}}
  const same_keys=a.size===b.size&&overlap===a.size;
  return {same_keys,has_overlap:overlap>0,overlapping_values_equal:!conflict&&(overlap>0||(a.size===0&&b.size===0)),conflict_free:!conflict,contains_keys:overlap===b.size,contains_entries:overlap===b.size&&!conflict,value_equal:same_keys&&!conflict};
}
function symmetricDifference(a,b){const left=new Set(a),right=new Set(b);return [...left].filter(k=>!right.has(k)).concat([...right].filter(k=>!left.has(k))).sort()}
function verify(){
  let checks=0;
  const assert=(x,msg)=>{if(!x)throw new Error(msg);checks++};
  const keys=["x","__proto__","constructor"],values=[undefined,0,1,null];
  const maps=Array.from({length:64},(_,n)=>keys.map((k,i)=>[k,values[(n>>(i*2))&3]]).filter(e=>e[1]!==undefined));
  for(let i=0;i<64;i++)for(let j=0;j<64;j++){
    const a=maps[i],b=maps[j],before=JSON.stringify([a,b]),got=compare(a,b);
    const l=keys.map((_,k)=>(i>>(2*k))&3),r=keys.map((_,k)=>(j>>(2*k))&3);
    const overlap=l.some((v,k)=>v!==0&&r[k]!==0);
    const conflict=l.some((v,k)=>v!==0&&r[k]!==0&&v!==r[k]);
    const same=l.every((v,k)=>(v===0)===(r[k]===0));
    const subset=r.every((v,k)=>v===0||l[k]!==0);
    const expected={same_keys:same,has_overlap:overlap,overlapping_values_equal:!conflict&&(overlap||(i===0&&j===0)),conflict_free:!conflict,contains_keys:subset,contains_entries:subset&&!conflict,value_equal:l.every((v,k)=>v===r[k])};
    assert(JSON.stringify(got)===JSON.stringify(expected),"exhaustive "+i+","+j);
    assert(JSON.stringify(compare([...a].reverse(),[...b].reverse()))===JSON.stringify(got),"order");
    assert(JSON.stringify([a,b])===before,"mutation");
    assert(got.overlapping_values_equal===compare(b,a).overlapping_values_equal,"symmetry");
  }
  assert(compare([["x",0]],[["x",0],["y",1]]).overlapping_values_equal,"A~B");
  assert(compare([["x",0],["y",1]],[["y",1]]).overlapping_values_equal,"B~C");
  assert(!compare([["x",0]],[["y",1]]).overlapping_values_equal,"not transitive");
  assert(!compare([["x",null]],[]).value_equal,"None is present");
  assert(JSON.stringify(symmetricDifference([1,2,3],[3,4,5]))==="[1,2,4,5]","symmetric difference");
  assert(JSON.stringify(symmetricDifference([1,1,2],[2,2]))==="[1]","set duplicates");
  for(const invalid of [[["x",0],["x",1]],[[1,0]],[["x",false]],[["x",1.5]]]){let failed=false;try{compare(invalid,[])}catch{failed=true}assert(failed,"invalid input")}
  return {mapPairs:4096,assertions:checks,status:"HOST_REFERENCE_ONLY"};
}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/keyed-comparison-v1/manifest.json',import.meta.url),'utf8'));
test('explicit candidate vectors',()=>{assert.equal(fixture.status,'PROPOSED_SOURCE_EXPECTATIONS_ONLY');assert.ok(Object.values(fixture.backend_status).every(x=>x==='NOT_EXECUTED'));for(const c of fixture.cases)assert.deepEqual(compare(c.left,c.right),c.expected,c.id)});
test('exhaustive independent bit-state oracle and negative cases',()=>{assert.deepEqual(verify(),{"mapPairs":4096,"assertions":16394,"status":"HOST_REFERENCE_ONLY"})});
