import test from 'node:test';
import assert from 'node:assert/strict';
import {checkConstruction} from './contextual-construction-cleanup-v1.mjs';
const e=(op,fields={})=>({op,...fields});
const own=(op,owner='a')=>e(op,{owner});
const field=(op,n,owner='a')=>e(op,{owner,field:n});
function trace(n,k,publish=false){
 const events=[own('reserve')];
 for(let i=0;i<k;i++)events.push(field('init',i));
 if(publish)events.push(own('publish'),own('destroy'));
 else events.push(own('unwind'));
 for(let i=k-1;i>=0;i--)events.push(field('drop',i));
 events.push(own('release'));
 return events;
}
test('every partial initialization prefix and full destruction through 64 fields',()=>{
 let cases=0;
 for(let n=0;n<=64;n++){
   for(let k=0;k<=n;k++){
     assert.deepEqual(checkConstruction(n,trace(n,k)),{outcome:'released',initialized:k,dropped:k,certified:false});cases++;
   }
   assert.equal(checkConstruction(n,trace(n,n,true)).dropped,n);cases++;
 }
 assert.equal(cases,2210);
 console.log('CONSTRUCTION_PREFIX_CASES='+cases);
});
test('denial and move preserve exactly one owner obligation',()=>{
 for(const reason of ['quota','resource'])assert.equal(checkConstruction(3,[e('deny',{reason})]).outcome,'denied');
 const t=[own('reserve'),field('init',0),own('publish'),e('move_deny',{owner:'a',to:'b'}),e('move',{owner:'a',to:'b'}),own('destroy','b'),field('drop',0,'b'),own('release','b')];
 assert.equal(checkConstruction(1,t).dropped,1);
 for(const index of [5,6,7]){
   const bad=t.map(x=>({...x}));bad[index].owner='a';assert.throws(()=>checkConstruction(1,bad));
 }
});
test('reject premature publication, wrong field order, duplicate/drop/release and malformed records',()=>{
 const base=trace(3,2);
 const bad=[
  t=>t[1].field=1,t=>t[2].field=0,t=>t[3].op='publish',t=>t[4].field=0,
  t=>t.splice(4,1),t=>t.splice(5,0,{...t[4]}),t=>t.pop(),t=>t.push(own('release')),
  t=>t[1].owner='b',t=>t[4].owner='b',t=>t[6].owner='b',t=>t[0].extra=1,
  t=>t.splice(1,0,e('move',{owner:'a',to:'b'})),t=>t.splice(1,0,e('deny',{reason:'quota'})),
  t=>t[0].owner='bad id',t=>t[1].field=0.5
 ];
 for(const mutate of bad){const t=base.map(x=>({...x}));mutate(t);assert.throws(()=>checkConstruction(3,t));}
 for(const n of [-1,65,1.5])assert.throws(()=>checkConstruction(n,base));
 assert.throws(()=>checkConstruction(0,[e('deny',{reason:'fallback'})]));
 assert.throws(()=>checkConstruction(0,[e('deny',{reason:'quota'}),own('reserve')]));
});
