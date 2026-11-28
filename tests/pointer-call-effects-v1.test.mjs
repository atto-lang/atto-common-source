import { readFileSync } from 'node:fs';
// Source-only effect model. No Atto compiler or guest is executed.
function verify(d){
 const req=(x,m)=>{if(!x)throw Error(m)};
 const groups={StaticOwned:["alloc","alloc_value"],BorrowRead:["len","size_bytes","is_empty","read","read_at","borrow_at","slice","same_location"],BorrowWrite:["write","write_at","borrow_mut_at","slice_mut","fill","copy_from","swap_at"],OwnerElement:["take_at","replace_at"],ConsumeReceiver:["close"]};
 req(d.schema==="atto.pointer-call-effects.v1.target"&&d.status==="TARGET_ONLY_NOT_EXECUTED","target only");
 req(d.default_argument==="BorrowRead"&&d.primitive_argument==="Value"&&d.mutable_argument==="BorrowWrite"&&d.consuming_argument==="Take","argument modes");
 req(Object.keys(d.operations).length===20,"operation count");
 for(const [effect,names] of Object.entries(groups))for(const n of names)req(d.operations[n]===effect,n+" effect");
 const backends=["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","wasm"].map(x=>"atto-source."+x).sort();
 req(d.backends.map(x=>x.id).sort().join()===backends.join()&&d.backends.every(x=>x.status==="NOT_EXECUTED"),"backend inventory");
}
function admit(d,method,receiver,flags={}){
 if(!Object.hasOwn(d.operations,method))return false;
 const e=d.operations[method];
 if(e==="StaticOwned")return receiver==="static";
 if(flags.stale||flags.unknownEffect||flags.escape)return false;
 if(!["owner","read_loan","write_loan","view_read","view_write"].includes(receiver))return false;
 if(e==="BorrowRead")return !flags.writerConflict;
 if(e==="BorrowWrite")return ["owner","write_loan","view_write"].includes(receiver)&&!flags.readConflict&&!flags.writerConflict;
 if(e==="OwnerElement"||e==="ConsumeReceiver")return receiver==="owner"&&!flags.readConflict&&!flags.writerConflict;
 return false;
}
function test(d){
 verify(d);let total=1;
 const groups=[["alloc",["static"]],["alloc_value",["static"]],["read_at",["owner","read_loan","write_loan","view_read","view_write"]],["read",["owner","read_loan","write_loan","view_read","view_write"]],["len",["owner","read_loan","write_loan","view_read","view_write"]],["size_bytes",["owner","read_loan","write_loan","view_read","view_write"]],["is_empty",["owner","read_loan","write_loan","view_read","view_write"]],["borrow_at",["owner","read_loan","write_loan","view_read","view_write"]],["slice",["owner","read_loan","write_loan","view_read","view_write"]],["same_location",["owner","read_loan","write_loan","view_read","view_write"]],...["write","write_at","borrow_mut_at","slice_mut","fill","copy_from","swap_at"].map(x=>[x,["owner","write_loan","view_write"]]),...["take_at","replace_at","close"].map(x=>[x,["owner"]])];
 for(const [m,allowed] of groups)for(const r of ["static","owner","read_loan","write_loan","view_read","view_write","local_handle","unknown"]){if(admit(d,m,r)!==allowed.includes(r))throw Error(m+"/"+r);total++;}
 for(const [m,r,flags] of [["read","owner",{stale:true}],["read_at","read_loan",{writerConflict:true}],["write_at","owner",{readConflict:true}],["write_at","view_write",{writerConflict:true}],["close","owner",{readConflict:true}],["take_at","owner",{writerConflict:true}],["slice","owner",{escape:true}],["read","owner",{unknownEffect:true}],["not_a_method","owner",{}]]){if(admit(d,m,r,flags))throw Error("unexpected admission "+m);total++;}
 for(const mutate of [x=>x.default_argument="Take",x=>x.operations.close="BorrowRead",x=>x.operations.take_at="BorrowWrite",x=>x.operations.write_at="BorrowRead",x=>delete x.operations.read_at,x=>x.backends[0].status="PASS",x=>x.backends.pop(),x=>x.status="PASS"]){const v=JSON.parse(JSON.stringify(d));mutate(v);let rejected=false;try{verify(v)}catch{rejected=true}if(!rejected)throw Error("bad registry accepted");total++;}
 return total;
}
const d=JSON.parse(readFileSync(new URL('../contracts/pointer-call-effects-v1.json',import.meta.url),'utf8'));
console.log('Pointer receiver effect model checks: '+test(d)+' passed; NOT compiler parity');
