// Independent, bounded OpenQASM3 subset simulator for proof fixtures.
// Host execution ONLY: no Oreslang compiler, physical QPU or provider authority.
// Deliberately rejects arbitrary OpenQASM statements instead of eval/ignoring.
const MAX_QUBITS = 12;
const MAX_GATES = 256;
const MAX_SHOTS = 10000;
const fail = code => { const e = new Error(code); e.code = code; throw e; };
const integer = (n,min,max) => Number.isSafeInteger(n) && n >= min && n <= max;
function readIndex(text, bound) {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) fail("QASM_INVALID_INDEX");
  const n=Number(text);
  if (!integer(n,0,bound-1)) fail("QASM_INVALID_INDEX");
  return n;
}

export function parseOpenQasm3Subset(source) {
  if(typeof source !== "string" || source.length > 20000 || source.includes("\0"))
    fail("QASM_INVALID_SOURCE");
  const lines=source.split("\n").map(x=>x.trim()).filter(Boolean);
  if(lines[0]!=="OPENQASM 3.0;" || lines[1]!=='include "stdgates.inc";')
    fail("QASM_INVALID_HEADER");
  const q=/^qubit\[([0-9]+)\] q;$/.exec(lines[2]??"");
  const c=/^bit\[([0-9]+)\] c;$/.exec(lines[3]??"");
  if(!q||!c)fail("QASM_INVALID_DECLARATION");
  const count=Number(q[1]),bits=Number(c[1]);
  if(!integer(count,1,MAX_QUBITS)||bits!==count)
    fail("QASM_RESOURCE_LIMIT");
  if(lines.length-4>MAX_GATES)fail("QASM_RESOURCE_LIMIT");

  const operations=[],measured=new Set(),written=new Set();
  for(const line of lines.slice(4)) {
    let m;
    if((m=/^h q\[([0-9]+)\];$/.exec(line))) {
      const index=readIndex(m[1],count);
      if(measured.has(index))fail("QASM_USE_AFTER_MEASURE");
      operations.push(Object.freeze({kind:"h",index}));
    } else if((m=/^cx q\[([0-9]+)\], q\[([0-9]+)\];$/.exec(line))) {
      const control=readIndex(m[1],count),target=readIndex(m[2],count);
      if(control===target)fail("QASM_INVALID_GATE");
      if(measured.has(control)||measured.has(target))
        fail("QASM_USE_AFTER_MEASURE");
      operations.push(Object.freeze({kind:"cx",control,target}));
    } else if((m=/^c\[([0-9]+)\] = measure q\[([0-9]+)\];$/.exec(line))) {
      const classical=readIndex(m[1],count),index=readIndex(m[2],count);
      if(measured.has(index))fail("QASM_USE_AFTER_MEASURE");
      if(written.has(classical))fail("QASM_DUPLICATE_CLASSICAL_WRITE");
      measured.add(index);written.add(classical);
      operations.push(Object.freeze({kind:"measure",index,classical}));
    } else fail("QASM_UNSUPPORTED_STATEMENT");
  }
  return Object.freeze({qubits:count,operations:Object.freeze(operations)});
}

function rng(seed) {
  if(!integer(seed,1,0xffffffff))fail("INVALID_SIMULATOR_SEED");
  let state=seed>>>0;
  return ()=> {
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)/4294967296;
  };
}
function executeOne(program,next) {
  const length=1<<program.qubits;
  // Pure real amplitudes suffice for {h,cx,measure}; complex-phase gates
  // are NOT accepted by the parser. Never pretend this is general QASM.
  const vector=new Float64Array(length);
  vector[0]=1;
  const classical=new Uint8Array(program.qubits);
  const invSqrt2=Math.SQRT1_2;
  for(const op of program.operations) {
    if(op.kind==="h") {
      const mask=1<<op.index;
      for(let base=0;base<length;base++) {
        if(base&mask)continue;
        const other=base|mask, a=vector[base],b=vector[other];
        vector[base]=(a+b)*invSqrt2;
        vector[other]=(a-b)*invSqrt2;
      }
    } else if(op.kind==="cx") {
      const control=1<<op.control,target=1<<op.target;
      for(let base=0;base<length;base++) {
        if((base&control)===0||(base&target)!==0)continue;
        const other=base|target, a=vector[base];
        vector[base]=vector[other]; vector[other]=a;
      }
    } else {
      const mask=1<<op.index;
      let probabilityOne=0;
      for(let i=0;i<length;i++)if(i&mask)
        probabilityOne+=vector[i]*vector[i];
      if(!Number.isFinite(probabilityOne)||probabilityOne<0||probabilityOne>1+1e-12)
        fail("QASM_NUMERIC_FAILURE");
      probabilityOne=Math.min(1,probabilityOne);
      const one=next()<probabilityOne;
      const selectedProbability=one?probabilityOne:1-probabilityOne;
      if(selectedProbability<=0)fail("QASM_NUMERIC_FAILURE");
      const scale=1/Math.sqrt(selectedProbability);
      for(let i=0;i<length;i++)
        vector[i]=(((i&mask)!==0)===one)?vector[i]*scale:0;
      classical[op.classical]=one?1:0;
    }
  }
  return Array.from(classical).reverse().join("");
}

export function simulateOpenQasm3Shots(source,{shots,seed}={}) {
  if(!integer(shots,1,MAX_SHOTS))fail("QASM_RESOURCE_LIMIT");
  const program=parseOpenQasm3Subset(source);
  // The product bounds worst-case simulation work, not merely memory size.
  if(BigInt(shots)*BigInt(1<<program.qubits)*BigInt(Math.max(1,program.operations.length))>10000000n)
    fail("QASM_RESOURCE_LIMIT");
  const next=rng(seed);
  const counts=Object.create(null);
  for(let i=0;i<shots;i++) {
    const outcome=executeOne(program,next);
    counts[outcome]=(counts[outcome]??0)+1;
  }
  // Sort by numeric bits for canonical evidence. Results contain no private IDs.
  const histogram={};
  for(const outcome of Object.keys(counts).sort())histogram[outcome]=counts[outcome];
  return Object.freeze({qubits:program.qubits,shots,seed,histogram:Object.freeze(histogram)});
}
