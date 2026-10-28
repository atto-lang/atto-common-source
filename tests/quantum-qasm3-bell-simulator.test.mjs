import test from "node:test";
import assert from "node:assert/strict";
import {QuantumCircuit} from "../contracts/v1/heterogeneous-science/reference.mjs";
import {parseOpenQasm3Subset,simulateOpenQasm3Shots}
  from "../contracts/v1/heterogeneous-science/qasm3-simulator.mjs";

const error=(fn,code)=>assert.throws(fn,e=>e?.code===code,code);
function bellQasm() {
  const circuit=new QuantumCircuit(2);
  circuit.h(0);
  circuit.cx(0,1);
  circuit.measure(0);
  circuit.measure(1);
  return circuit.toOpenQasm3();
}
test("independent QASM interpreter accepts the existing Bell circuit emitter",()=>{
  const program=parseOpenQasm3Subset(bellQasm());
  assert.equal(program.qubits,2);
  assert.deepEqual(program.operations.map(x=>x.kind),["h","cx","measure","measure"]);
});
test("Bell circuit produces only correlated results with approximately equal weight",()=>{
  const shots=2048;
  const result=simulateOpenQasm3Shots(bellQasm(),{shots,seed:20261028});
  assert.equal(result.shots,shots);
  assert.deepEqual(Object.keys(result.histogram).sort(),["00","11"]);
  assert.equal(result.histogram["00"]+result.histogram["11"],shots);
  assert(Math.abs(result.histogram["00"]/shots-0.5)<0.07);
});
test("single Hadamard has two outcomes, deterministic fixed-seed replay",()=>{
  const program='OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nh q[0];\nc[0] = measure q[0];\n';
  const a=simulateOpenQasm3Shots(program,{shots:512,seed:18});
  const b=simulateOpenQasm3Shots(program,{shots:512,seed:18});
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(a.histogram).sort(),["0","1"]);
});
test("gate applied after measurement is rejected during admission",()=>{
  error(()=>parseOpenQasm3Subset('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\nh q[0];'),
    "QASM_USE_AFTER_MEASURE");
});
test("malformed headers and unsupported operations reject, never execute",()=>{
  error(()=>parseOpenQasm3Subset('OPENQASM 2.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;'),"QASM_INVALID_HEADER");
  error(()=>parseOpenQasm3Subset('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nz q[0];'),"QASM_UNSUPPORTED_STATEMENT");
  error(()=>parseOpenQasm3Subset('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nh q[0];;'),
    "QASM_UNSUPPORTED_STATEMENT");
  error(()=>parseOpenQasm3Subset('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nmeasure q[0];'),"QASM_UNSUPPORTED_STATEMENT");
});
test("qubit and classical index provenance are bounded",()=>{
  const head='OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n';
  error(()=>parseOpenQasm3Subset(head+'cx q[0], q[0];'),"QASM_INVALID_GATE");
  error(()=>parseOpenQasm3Subset(head+'h q[2];'),"QASM_INVALID_INDEX");
  error(()=>parseOpenQasm3Subset(head+'c[0] = measure q[0];\nc[0] = measure q[1];'),
    "QASM_DUPLICATE_CLASSICAL_WRITE");
  error(()=>parseOpenQasm3Subset(head+'c[0] = measure q[0];\nc[1] = measure q[0];'),
    "QASM_USE_AFTER_MEASURE");
});
test("circuit and shot resource admission is bounded",()=>{
  const header='OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[13] q;\nbit[13] c;\n';
  error(()=>parseOpenQasm3Subset(header),"QASM_RESOURCE_LIMIT");
  error(()=>simulateOpenQasm3Shots(bellQasm(),{shots:10001,seed:1}),"QASM_RESOURCE_LIMIT");
  error(()=>simulateOpenQasm3Shots(bellQasm(),{shots:10,seed:0}),"INVALID_SIMULATOR_SEED");
  const head='OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n';
  error(()=>parseOpenQasm3Subset(head+'h q[0];\n'.repeat(257)),"QASM_RESOURCE_LIMIT");
});
test("QASM syntax is not a gateway to arbitrary host computation",()=>{
  const program=bellQasm().replace('h q[0];','h q[0];\nprocess.exit(0);');
  error(()=>simulateOpenQasm3Shots(program,{shots:1,seed:1}),"QASM_UNSUPPORTED_STATEMENT");
});
