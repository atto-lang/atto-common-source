import test from "node:test";
import assert from "node:assert/strict";
import {checkCriticalEffectClosure as inspect}
  from "../models/critical-effect-closure-v1.mjs";
const fn=(name,effects=[],calls=[],trusted=true)=>({name,effects,calls,trusted});
const call=(...targets)=>({targets,sealed:true});

test("uncontended pure helper chain remains an approved critical body",()=>{
 const r=inspect([fn("critical",["write"],[call("read")]),
   fn("read",["read"],[call("pure")]),fn("pure",["pure"])],"critical");
 assert.equal(r.diagnostic,"accept");
 assert.deepEqual(r.reachable,["critical","pure","read"]);
});
test("direct suspension requires a suspends entry outside the guard",()=>{
 assert.equal(inspect([fn("root",["suspend"])],"root").diagnostic,
   "E_CRITICAL_SUSPENSION");
});
test("transitive ordinary-call suspension is detected across two hops",()=>{
 assert.equal(inspect([fn("a",[],[call("b")]),fn("b",[],[call("c")]),
   fn("c",["suspend"])],"a").diagnostic,"E_CRITICAL_SUSPENSION");
});
test("sealed virtual dispatch checks all possible implementations",()=>{
 const nodes=[fn("run",[],[call("plain","blocking")]),
   fn("plain",["pure"]),fn("blocking",["block"])];
 assert.equal(inspect(nodes,"run").diagnostic,"E_CRITICAL_BLOCKING");
});
test("sealed typeclass overload with a suspending candidate fails",()=>{
 const nodes=[fn("method",[],[call("a","b")]),fn("a",["write"]),
   fn("b",["suspend"])];
 assert.equal(inspect(nodes,"method").diagnostic,"E_CRITICAL_SUSPENSION");
});
test("unknown FFI metadata and incomplete dynamic dispatch fail closed",()=>{
 assert.equal(inspect([fn("a",[],[{targets:["b"],sealed:false}]),
   fn("b",["ffi-safe"])],"a").diagnostic,"E_EFFECT_UNKNOWN");
 assert.equal(inspect([fn("a",[],[{targets:[],sealed:true}])],"a").diagnostic,
   "E_EFFECT_UNKNOWN");
 assert.equal(inspect([fn("a",[],[call("missing")])],"a").diagnostic,
   "E_EFFECT_UNKNOWN");
 assert.equal(inspect([fn("a",[],[],false)],"a").diagnostic,"E_EFFECT_UNKNOWN");
});
test("known explicit nonblocking host FFI is permitted only with trusted proof",()=>{
 assert.equal(inspect([fn("a",[],[call("ffi")]),
   fn("ffi",["ffi-safe"])],"a").diagnostic,"accept");
 assert.equal(inspect([fn("a",[],[call("ffi")]),
   fn("ffi",["ffi-safe"],[],false)],"a").diagnostic,"E_EFFECT_UNKNOWN");
});
test("missing effect metadata and unrecognized effect fail closed",()=>{
 assert.equal(inspect([{name:"a",calls:[],trusted:true}],"a").diagnostic,
   "E_EFFECT_UNKNOWN");
 assert.equal(inspect([fn("a",["sleep"])],"a").diagnostic,"E_EFFECT_UNKNOWN");
});
test("a Future value is not silently interpreted as a suspend",()=>{
 const nodes=[fn("producer",["alloc"]),fn("caller",["pure"],[call("producer")])];
 assert.equal(inspect(nodes,"caller").diagnostic,"accept");
});
test("recursive helper graphs do not loop and retain effect closure",()=>{
 const nodes=[fn("a",["read"],[call("b")]),
   fn("b",["write"],[call("a")])];
 assert.deepEqual(inspect(nodes,"a"),
   {diagnostic:"accept",reachable:["a","b"]});
});
test("recursive dispatch graph cannot hide an indirect suspension",()=>{
 const nodes=[fn("a",[],[call("b")]),
   fn("b",["suspend"],[call("a")])];
 assert.equal(inspect(nodes,"a").diagnostic,"E_CRITICAL_SUSPENSION");
});
test("duplicate definitions, unknown entry, and malformed graph fail closed",()=>{
 assert.equal(inspect([fn("a"),fn("a")],"a").diagnostic,"E_EFFECT_UNKNOWN");
 assert.equal(inspect([fn("a")],"missing").diagnostic,"E_EFFECT_UNKNOWN");
 assert.equal(inspect(null,"a").diagnostic,"E_EFFECT_UNKNOWN");
});
test("node/edge budgets fail closed instead of accepting partial proof",()=>{
 const nodes=[fn("a",[],[call("b","c")]),fn("b"),fn("c")];
 assert.equal(inspect(nodes,"a",{maxNodes:2}).diagnostic,"E_EFFECT_UNKNOWN");
 assert.equal(inspect(nodes,"a",{maxEdges:1}).diagnostic,"E_EFFECT_UNKNOWN");
});
test("untrusted dynamic target cannot be suppressed by a benign sibling",()=>{
 const nodes=[fn("a",[],[call("benign","untrusted")]),
   fn("benign",["pure"]),fn("untrusted",[],[],false)];
 assert.equal(inspect(nodes,"a").diagnostic,"E_EFFECT_UNKNOWN");
});
test("unreachable suspending functions do not contaminate a closed critical body",()=>{
 const nodes=[fn("root",["write"]),fn("unreachable",["suspend"])];
 assert.equal(inspect(nodes,"root").diagnostic,"accept");
 assert.deepEqual(inspect(nodes,"root").reachable,["root"]);
});
