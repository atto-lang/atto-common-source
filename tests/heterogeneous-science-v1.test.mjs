import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  ContractError, tensorView, broadcastShape, admitEffects, deadlineAdmission,
  admitDispatch, ResourceLedger, QuantumCircuit, Dual, fixedOrderSum, PartitionLedger
} from "../contracts/v1/heterogeneous-science/reference.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/v1/heterogeneous-science/contract.json", import.meta.url), "utf8"));
const err = (fn, code) => assert.throws(fn,
  e => e instanceof ContractError && e.code === code, code);

test("no guest/device/realtime completion is claimed by the reference contract", () => {
  assert.equal(contract.status, "REFERENCE_MODEL_ONLY");
  assert.equal(contract.guest_execution, "NOT_EXECUTED");
  assert.equal(contract.promotion.reference_model, "host_only_no_guest_claims");
  assert.deepEqual(Object.keys(contract.targets).sort(),
    ["data_science","gpu","hpc","machine_learning","quantum","realtime","robotics"].sort());
});
test("profile effects reject host I/O, allocation and await in device/circuit contexts", () => {
  assert.equal(admitEffects(contract, "gpu_kernel", ["numeric","barrier"]), true);
  assert.equal(admitEffects(contract, "quantum_circuit", ["quantum_gate","quantum_measure"]), true);
  err(() => admitEffects(contract, "gpu_kernel", ["await"]), "EFFECT_NOT_ADMITTED");
  err(() => admitEffects(contract, "quantum_circuit", ["io"]), "EFFECT_NOT_ADMITTED");
  err(() => admitEffects(contract, "hard_realtime", ["allocate"]), "EFFECT_NOT_ADMITTED");
  err(() => admitEffects(contract, "undefined", ["numeric"]), "UNKNOWN_EXECUTION_PROFILE");
});
test("checked dense shape and stride calculations enforce byte capacity", () => {
  assert.deepEqual(tensorView({shape:[2,3],strides:[3,1],elementBytes:8,capacityBytes:48}),
    {elements:6n,endBytes:48n});
  assert.deepEqual(tensorView({shape:[0,12],strides:[12,1],elementBytes:8,capacityBytes:0}),
    {elements:0n,endBytes:0n});
  err(() => tensorView({shape:[2,3],strides:[3,1],elementBytes:8,capacityBytes:47}),
    "TENSOR_OUT_OF_BOUNDS");
  err(() => tensorView({shape:[2,3],strides:[0,1],elementBytes:8,capacityBytes:24,mutable:true}),
    "ALIASING_MUTABLE_VIEW");
  err(() => tensorView({shape:[2147483647,2147483647],
    strides:[2147483647,2147483647],elementBytes:8,capacityBytes:Number.MAX_SAFE_INTEGER}),
    "INTEGER_OVERFLOW");
});
test("broadcast shape refuses incompatible dimensions", () => {
  assert.deepEqual(broadcastShape([4,1,3],[1,5,3]), [4,5,3]);
  assert.deepEqual(broadcastShape([0,3],[1,3]), [0,3]);
  err(() => broadcastShape([4,3],[5,3]), "TENSOR_SHAPE_MISMATCH");
});
test("RT admission requires named evidence and a bounded total", () => {
  const config={deadlineUs:100,wcetUs:48,blockingUs:20,interferenceUs:10,jitterUs:9,
    aot:true,preallocated:true,timingEvidence:true,rtosAdmitted:true};
  assert.equal(deadlineAdmission(config).totalUs,87n);
  err(() => deadlineAdmission({...config,timingEvidence:false}), "UNBOUNDED_DEADLINE");
  err(() => deadlineAdmission({...config,wcetUs:90}), "DEADLINE_EXCEEDED");
  err(() => deadlineAdmission({...config,blockingUs:(1n<<63n)-1n,
    interferenceUs:1,jitterUs:0}), "INTEGER_OVERFLOW");
});
test("GPU dispatch requires exact requested GPU and bounded invocation", () => {
  const config={requestedDevice:"gpu0",availableDevices:[
    {id:"cpu0",kind:"cpu",maxInvocations:2048},
    {id:"gpu0",kind:"gpu",maxInvocations:1024}],workgroup:[8,8,2],maxInvocations:256};
  assert.equal(admitDispatch(config).invocations,128n);
  err(() => admitDispatch({...config,requestedDevice:"missing",explicitCpuFallback:true}),
    "UNSUPPORTED_DEVICE");
  err(() => admitDispatch({...config,workgroup:[64,64]}), "INVALID_DISPATCH");
});
test("read loans reject writes and moves; release restores ability to move", () => {
  const ledger = new ResourceLedger();
  const h=ledger.allocate(1,"host",64);
  const loan=ledger.borrow(h,1,"read");
  err(() => ledger.borrow(h,1,"write"), "BUFFER_LOAN_ACTIVE");
  err(() => ledger.move(h,1,2,"host"), "BUFFER_LOAN_ACTIVE");
  ledger.releaseLoan(loan);
  const moved=ledger.move(h,1,2,"host");
  err(() => ledger.borrow(h,1,"read"), "STALE_HANDLE");
  err(() => ledger.borrow(moved,1,"read"), "FOREIGN_OWNER");
  const loan2=ledger.borrow(moved,2,"write");
  ledger.releaseLoan(loan2);
  ledger.retire(moved,2);
  err(() => ledger.borrow(moved,2,"read"), "STALE_HANDLE");
  err(() => ledger.releaseLoan(loan2), "UNKNOWN_LOAN");
});
test("cross-device transfers are explicit and cancellation is not quiescence", () => {
  const ledger=new ResourceLedger();
  const h=ledger.allocate(1,"host",256);
  err(() => ledger.move(h,1,1,"gpu"), "IMPLICIT_DEVICE_TRANSFER");
  const gpu=ledger.move(h,1,1,"gpu",{explicitTransfer:true});
  const {fence}=ledger.submitGpu(gpu,1);
  ledger.requestCancel(gpu,1,fence);
  err(() => ledger.retire(gpu,1), "FENCE_IN_FLIGHT");
  err(() => ledger.copy(gpu,1,{explicitTransfer:true}), "FENCE_IN_FLIGHT");
  ledger.completeFence(gpu,1,fence);
  const copied=ledger.copy(gpu,1,{explicitTransfer:true});
  const loan=ledger.borrow(copied,1,"read");
  ledger.releaseLoan(loan);
  ledger.retire(gpu,1);
});
test("quantum resource is noncopyable and not transferrable to host", () => {
  const ledger=new ResourceLedger();
  const q=ledger.allocate(8,"qpu",1);
  err(() => ledger.copy(q,8,{explicitTransfer:true}), "QUBIT_NOT_COPYABLE");
  err(() => ledger.move(q,8,9,"host",{explicitTransfer:true}), "QUBIT_NOT_COPYABLE");
});
test("quantum Bell fixture emits OpenQASM 3 and forbids invalid gate reuse", () => {
  const qc=new QuantumCircuit(2);
  qc.h(0); qc.cx(0,1); qc.measure(0); qc.measure(1);
  const qasm=qc.toOpenQasm3();
  assert.match(qasm,/^OPENQASM 3\.0;/);
  assert.match(qasm,/h q\[0\];\ncx q\[0\], q\[1\];/);
  assert.match(qasm,/c\[1\] = measure q\[1\];/);
  err(() => qc.h(0), "QUBIT_ALREADY_MEASURED");
  err(() => qc.measure(1), "QUBIT_ALREADY_MEASURED");
  const separate=new QuantumCircuit(2);
  err(() => separate.cx(1,1), "INVALID_QUANTUM_GATE");
  err(() => separate.h(2), "INVALID_QUBIT");
});
test("dual-number forward gradient for quadratic is 2x+2", () => {
  const x=new Dual(3,1);
  const result=x.mul(x).add(new Dual(2,0).mul(x));
  assert.equal(result.value,15);
  assert.equal(result.tangent,8);
});
test("fixed reduction tree is deterministic for the same ordered finite inputs", () => {
  assert.equal(fixedOrderSum([1e16,1,-1e16,1]), 0);
  assert.equal(fixedOrderSum([]),0);
  err(() => fixedOrderSum([1,Infinity]),"INVALID_NUMERIC");
});
test("partition epochs, ACKs and backpressure fail closed", () => {
  const p=new PartitionLedger(10,1);
  assert.equal(p.admit(10,0,"shaA"),"admitted");
  err(() => p.admit(10,1,"shaB"),"PARTITION_BACKPRESSURE");
  p.ack(10,0,"shaA");
  assert.equal(p.admit(10,0,"shaA"),"duplicate-acked");
  err(() => p.admit(10,0,"shaChanged"),"DUPLICATE_PARTITION_SEQUENCE");
  p.restart(11);
  err(() => p.admit(10,1,"shaB"),"STALE_PARTITION_EPOCH");
  assert.equal(p.admit(11,1,"shaB"),"admitted");
  err(() => p.ack(11,1,"shaWrong"),"INVALID_PARTITION_ACK");
  err(() => p.restart(11),"STALE_PARTITION_EPOCH");
});
