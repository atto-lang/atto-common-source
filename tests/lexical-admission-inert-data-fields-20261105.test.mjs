import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateAdmission} from "../scripts/validate-backend-lexical-admission.mjs";

const fixture=new URL("../contracts/editor-syntax/v1/backend-lexical-admission-v1.json",import.meta.url);
const corpus=new URL("../contracts/editor-syntax/v1/compiler-lexical-differential-v1.tsv",import.meta.url);
const load=()=>JSON.parse(readFileSync(fixture,"utf8"));
const bytes=()=>readFileSync(corpus);

test("canonical six-backend NOT_EXECUTED plan stays valid",()=>{
 const valid=validateAdmission(load(),bytes());
 assert.deepEqual(valid,{
  checkedBackends:6,expectedCases:34,
  actualCorpusBlob:"eeed64b7d33c262b35120662386435575982a9bc"
 });
 const unsupported=load();unsupported.backends[3].lexer="UNSUPPORTED";
 unsupported.backends[3].unsupportedReason="Missing independently checked guest lexer";
 assert.equal(validateAdmission(unsupported,bytes()).checkedBackends,6);
});

test("root and nested backend accessors are rejected without invocation",()=>{
 let reads=0;
 for(const field of ["schema","corpusBlobSha","expectedCases","backends"]){
  const plan=load();
  Object.defineProperty(plan,field,{enumerable:true,get(){
   reads++;throw Error("unexpected getter execution");
  }});
  assert.throws(()=>validateAdmission(plan,bytes()),
   /LEXICAL_ADMISSION_REJECTED: report requires own enumerable data fields/);
 }
 for(const field of ["id","lexer","testedHead","unsupportedReason"]){
  const plan=load();
  Object.defineProperty(plan.backends[0],field,{enumerable:true,get(){
   reads++;return field==="lexer"?"NOT_EXECUTED":"java";
  }});
  assert.throws(()=>validateAdmission(plan,bytes()),
   /LEXICAL_ADMISSION_REJECTED: backend 0 requires own enumerable data fields/);
 }
 assert.equal(reads,0);
});

test("backend and dimension array slots cannot be getters, sparse, or iterators",()=>{
 let reads=0;
 for(const field of ["backends","dimensions"]){
  const plan=load(),list=plan[field],original=list[0];
  Object.defineProperty(list,0,{enumerable:true,get(){
   reads++;return original;
  }});
  assert.throws(()=>validateAdmission(plan,bytes()),
   /requires exact own data slots/);
 }
 assert.equal(reads,0);
 for(const field of ["backends","dimensions"]){
  const sparse=load();delete sparse[field][0];
  assert.throws(()=>validateAdmission(sparse,bytes()),
   /requires exact own data slots/);
  const custom=load();
  Object.defineProperty(custom[field],Symbol.iterator,{get(){
   reads++;throw Error("iterator executed");
  }});
  assert.throws(()=>validateAdmission(custom,bytes()),
   /requires exact own data slots/);
 }
 assert.equal(reads,0);
});

test("prototype and symbol metadata cannot masquerade as backend execution evidence",()=>{
 const customProto=Object.assign(Object.create({id:"java"}),load().backends[0]);
 const plan=load();plan.backends[0]=customProto;
 assert.throws(()=>validateAdmission(plan,bytes()),
  /must be a plain data record/);
 const hidden=load();hidden.backends[0][Symbol("attested")]=true;
 assert.throws(()=>validateAdmission(hidden,bytes()),
  /requires own enumerable data fields/);
 const customRoot=Object.assign(Object.create({status:"green"}),load());
 assert.throws(()=>validateAdmission(customRoot,bytes()),
  /must be a plain data record/);
});
