// Narrow, executable source-to-SMT prototype. NOT the Oreslang compiler's
// typed HIR; unsupported syntax is rejected, never silently approximated.
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const OPS = {"<":"bvslt","<=":"bvsle",">":"bvsgt",">=":"bvsge"};
const WORD = /^[A-Za-z_][A-Za-z_0-9]*$/;
const NAME = /^(min_int|max_int)$/;

function assert(ok, message) { if (!ok) throw Error(message); }
function lex(source) {
  const tokens=[];
  const re=/\s*(<=|>=|==|!=|[A-Za-z_][A-Za-z_0-9]*|[<>{}(),:;])/gy;
  let pos=0;
  while(pos<source.length) {
    re.lastIndex=pos;
    const m=re.exec(source);
    if (!m) {
      assert(/^\s*$/.test(source.slice(pos)), "unsupported source token at byte "+pos);
      break;
    }
    tokens.push(m[1]); pos=re.lastIndex;
    assert(tokens.length<500, "function exceeds verified subset token limit");
  }
  return tokens;
}
function parse(tokens, name) {
  let i=0;
  const pop=()=>{assert(i<tokens.length,"unexpected end of function");return tokens[i++];};
  const need=x=>assert(pop()===x,"expected token: "+x);
  need("pub");need("fnc");need(name);need("(");need("int");
  const a=pop();need(",");need("int");const b=pop();
  assert(WORD.test(a)&&WORD.test(b)&&a!==b,"invalid parameter names");
  need(")");need(":");need("int");need("{");
  need("if");const lhs=pop(),op=pop(),rhs=pop();
  assert([a,b].includes(lhs)&&[a,b].includes(rhs)&&lhs!==rhs,
    "condition must compare distinct parameters");
  assert(Object.hasOwn(OPS,op),"unsupported comparison");
  need(";");need("do");need("return");const yes=pop();need(";");
  need("else");need("return");const no=pop();need(";");
  assert([a,b].includes(yes)&&[a,b].includes(no),"return must be a parameter");
  need("fi");need("}");
  assert(i===tokens.length,"trailing or unsupported statements");
  return {a,b,lhs,op,rhs,yes,no};
}
export function extractScalar(source,name) {
  assert(NAME.test(name),"unsupported verified function");
  assert(typeof source==="string" && Buffer.byteLength(source)<=2_000_000,
    "source exceeds size bound");
  // No strings, nested blocks or side effects are admitted in this first
  // grammar. The extraction is structural, not a general Oreslang parser.
  const noComments=source.replace(/\/\/[^\n]*/g,"");
  const re=new RegExp("\\bpub\\s+fnc\\s+"+name+"\\s*\\(","g");
  const found=[...noComments.matchAll(re)];
  assert(found.length===1,"expected exactly one public function "+name);
  const start=found[0].index;
  const brace=noComments.indexOf("{",start);
  assert(brace!==-1,"missing function body");
  let depth=0,end=-1;
  for(let i=brace;i<noComments.length;i++) {
    if(noComments[i]==="{") depth++;
    if(noComments[i]==="}" && --depth===0) {end=i+1;break;}
    assert(depth>=0,"invalid brace nesting");
  }
  assert(end!==-1,"unclosed function");
  return parse(lex(noComments.slice(start,end)),name);
}
const bvName=x=>{ assert(["arg0","arg1"].includes(x),"unbound symbol");return x; };
export function renderSmt(parsed,name) {
  assert(NAME.test(name),"unsupported verified function");
  const map=x=>bvName(x===parsed.a?"arg0":x===parsed.b?"arg1":"invalid");
  assert(Object.hasOwn(OPS,parsed.op),"unsupported operator");
  const body="(ite ("+OPS[parsed.op]+" "+map(parsed.lhs)+" "+map(parsed.rhs)+
    ") "+map(parsed.yes)+" "+map(parsed.no)+")";
  const expected=name==="min_int"?
    "(ite (bvsle arg0 arg1) arg0 arg1)":
    "(ite (bvsge arg0 arg1) arg0 arg1)";
  const mutant=name==="min_int"?
    "(ite (bvsgt arg0 arg1) arg0 arg1)":
    "(ite (bvslt arg0 arg1) arg0 arg1)";
  return [
    "(set-logic QF_BV)",
    "(define-fun implementation ((arg0 (_ BitVec 64)) (arg1 (_ BitVec 64))) (_ BitVec 64) "+body+")",
    "(define-fun contract ((arg0 (_ BitVec 64)) (arg1 (_ BitVec 64))) (_ BitVec 64) "+expected+")",
    "(declare-const x (_ BitVec 64))",
    "(declare-const y (_ BitVec 64))",
    "(push 1)","(assert (distinct (implementation x y) (contract x y)))",
    "(check-sat)","(pop 1)",
    "(push 1)",
    "(assert (distinct "+mutant.replaceAll("arg0","x").replaceAll("arg1","y")+" (contract x y)))",
    "(check-sat)","(pop 1)",""
  ].join("\n");
}
export function checkWithZ3(smt,spawn=spawnSync) {
  const result=spawn("z3",["-smt2","-in"],{
    input:smt,encoding:"utf8",timeout:30000,maxBuffer:2_000_000
  });
  assert(!result.error && result.status===0 && result.signal===null,
    "solver unavailable, timed out, or exited unsuccessfully");
  assert(result.stderr==="","unexpected Z3 stderr");
  assert(result.stdout.trim()==="unsat\nsat",
    "proof/mutant expected unsat then sat, got "+JSON.stringify(result.stdout));
  return true;
}
function main(args) {
  const checking=args[0]==="--check";
  if(checking) args=args.slice(1);
  assert(args.length===2&&NAME.test(args[0]),"usage: [--check] min_int|max_int source.ores");
  const [name,path]=args;
  const input=readFileSync(path,"utf8");
  const smt=renderSmt(extractScalar(input,name),name);
  if(checking) {checkWithZ3(smt); process.stdout.write("SOURCE-SLICE-REFINEMENT-OK "+name+"\n");}
  else process.stdout.write(smt);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {main(process.argv.slice(2));} catch(e) {console.error("UNVERIFIED:",e.message);process.exitCode=1;}
}
