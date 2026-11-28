import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {baseDimensions,derivedSI} from "./si-derived-units.mjs";
const source=readFileSync(new URL("../../stdlib/core/measure-derived-linear.atto",import.meta.url),"utf8");
test("candidate source matches independently maintained SI vectors",()=>{
 const dims=new Map(baseDimensions.map((n,i)=>[n,baseDimensions.map((_,j)=>Number(i===j))]));
 const units=new Set();
 for(const line of source.split("\n")){
  if(!line||line.startsWith("//"))continue;
  const d=/^define dimension (\w+) = (.+);$/.exec(line);
  if(d){
   assert.ok(!dims.has(d[1]));
   const terms=d[2].split(" ");
   let v=dims.get(terms[0])?.slice();assert.ok(v);
   for(let i=1;i<terms.length;i+=2){
    assert.ok(["*","/"].includes(terms[i]));
    const b=dims.get(terms[i+1]);assert.ok(b);
    v=v.map((n,j)=>n+(terms[i]==="*"?1:-1)*b[j]);
   }
   assert.ok(v.some(Boolean));
   assert.ok(![...dims.values()].some(w=>w.every((n,i)=>n===v[i])),"ambiguous vector");
   dims.set(d[1],v);
   continue;
  }
  const u=/^define unit (\w+): (\w+);$/.exec(line);assert.ok(u,line);
  assert.ok(!units.has(u[1]));units.add(u[1]);
  const ref=derivedSI.find(x=>x.name===u[1]);assert.ok(ref);
  assert.equal(ref.model,"linear");
  assert.deepEqual(dims.get(u[2]),ref.powers);
  assert.deepEqual(ref.scale,[1n,1n]);
 }
 assert.equal(units.size,16);
 assert.deepEqual(derivedSI.filter(x=>!units.has(x.name)).map(x=>x.name).sort(),["Becquerel","DegreeCelsius","Lumen","Radian","Sievert","Steradian"].sort());
});
