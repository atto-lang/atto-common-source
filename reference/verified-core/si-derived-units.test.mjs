import test from "node:test";
import assert from "node:assert/strict";
import {derivedSI,baseDimensions,sameDimension,sameLinearKind} from "./si-derived-units.mjs";
const byName=new Map(derivedSI.map(x=>[x.name,x]));
const get=name=>byName.get(name);
const powers=name=>get(name).powers;
const add=(a,b)=>a.map((n,i)=>n+b[i]);
const sub=(a,b)=>a.map((n,i)=>n-b[i]);
const L=[1,0,0,0,0,0,0],M=[0,1,0,0,0,0,0],T=[0,0,1,0,0,0,0],I=[0,0,0,1,0,0,0],N=[0,0,0,0,0,1,0],J=[0,0,0,0,0,0,1];
test("complete named SI derived inventory, case-sensitive symbols and exact scale",()=>{
 assert.equal(baseDimensions.length,7);
 assert.equal(derivedSI.length,22);
 assert.equal(new Set(derivedSI.map(x=>x.symbol)).size,22);
 assert.equal(byName.size,22);
 assert.deepEqual(derivedSI.map(x=>x.symbol),["rad","sr","Hz","N","Pa","J","W","C","V","F","Ω","S","Wb","T","H","°C","lm","lx","Bq","Gy","Sv","kat"]);
 for(const u of derivedSI){
   assert.equal(u.powers.length,7);
   assert.ok(u.powers.every(Number.isSafeInteger));
   assert.deepEqual(u.scale,[1n,1n]);
 }
 assert.equal(derivedSI.filter(x=>x.model==="affine").length,1);
});
test("independent dimensional equations for named derived units",()=>{
 assert.deepEqual(powers("Radian"),[0,0,0,0,0,0,0]);
 assert.deepEqual(powers("Steradian"),powers("Radian"));
 assert.deepEqual(powers("Hertz"),T.map(n=>-n));
 assert.deepEqual(powers("Newton"),sub(add(M,L),add(T,T)));
 assert.deepEqual(powers("Pascal"),sub(powers("Newton"),add(L,L)));
 assert.deepEqual(powers("Joule"),add(powers("Newton"),L));
 assert.deepEqual(powers("Watt"),sub(powers("Joule"),T));
 assert.deepEqual(powers("Coulomb"),add(I,T));
 assert.deepEqual(powers("Volt"),sub(powers("Watt"),I));
 assert.deepEqual(powers("Farad"),sub(powers("Coulomb"),powers("Volt")));
 assert.deepEqual(powers("Ohm"),sub(powers("Volt"),I));
 assert.deepEqual(powers("Siemens"),powers("Ohm").map(n=>-n));
 assert.deepEqual(powers("Weber"),add(powers("Volt"),T));
 assert.deepEqual(powers("Tesla"),sub(powers("Weber"),add(L,L)));
 assert.deepEqual(powers("Henry"),sub(powers("Weber"),I));
 assert.deepEqual(powers("Lumen"),J);
 assert.deepEqual(powers("Lux"),sub(J,add(L,L)));
 assert.deepEqual(powers("Becquerel"),powers("Hertz"));
 assert.deepEqual(powers("Gray"),sub(powers("Joule"),M));
 assert.deepEqual(powers("Sievert"),powers("Gray"));
 assert.deepEqual(powers("Katal"),sub(N,T));
});
test("dimension collisions do not imply nominal interchangeability",()=>{
 for(const [a,b] of [["Hertz","Becquerel"],["Radian","Steradian"],["Gray","Sievert"]]){
   assert.ok(sameDimension(get(a),get(b)));
   assert.equal(sameLinearKind(get(a),get(b)),false);
 }
 assert.ok(sameLinearKind(get("Newton"),get("Newton")));
 const c=get("DegreeCelsius");
 assert.deepEqual(c.powers,[0,0,0,0,1,0,0]);
 assert.equal(c.model,"affine");
 assert.deepEqual(c.offsetToKelvin,[27315n,100n]);
 assert.equal(sameLinearKind(c,c),false);
 // Exact origin and boiling point, not binary floating arithmetic.
 assert.equal(0n*100n+c.offsetToKelvin[0],27315n);
 assert.equal(100n*100n+c.offsetToKelvin[0],37315n);
});
