// Narrow, executable source-to-SMT prototype. NOT the Oreslang compiler's
// typed HIR; unsupported syntax is rejected, never silently approximated.
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const OPS = {"<":"bvslt","<=":"bvsle",">":"bvsgt",">=":"bvsge"};
const WORD = /^[A-Za-z_][A-Za-z_0-9]*$/;
const NAME = /^(min_int|max_int|clamp_int)$/;
const ARITY = {min_int: 2, max_int: 2, clamp_int: 3};

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
  let i=0, depth=0;
  const params=[];
  const peek=()=>tokens[i];
  const read=()=>{assert(i<tokens.length,"unexpected end");return tokens[i++];};
  const need=x=>assert(read()===x,"expected "+x);
  need("pub");need("fnc");need(name);need("(");
  for(let k=0;k<ARITY[name];k++){
    if(k)need(",");
    need("int");
    const arg=read();
    assert(WORD.test(arg)&&!params.includes(arg),"invalid or duplicate parameter");
    params.push(arg);
  }
  need(")");need(":");need("int");need("{");
  const sequence=stop=>{
    depth++;
    assert(depth<=16,"excessive branch depth");
    const stmts=[];
    while(!stop.includes(peek())){
      assert(i<tokens.length,"unterminated body");
      if(peek()==="return"){
        read();
        const arg=read();
        assert(params.includes(arg),"return expression must be a parameter");
        need(";");
        stmts.push({tag:"return",arg});
        assert(stop.includes(peek()),"unreachable statement after return");
      } else if(peek()==="if"){
        read();
        const l=read(),op=read(),r=read();
        assert(params.includes(l)&&params.includes(r)&&Object.hasOwn(OPS,op),
          "unsupported comparison");
        need(";");need("do");
        const yes=sequence(["else","fi"]);
        let no=[];
        if(peek()==="else"){read();no=sequence(["fi"]);}
        need("fi");
        stmts.push({tag:"if",l,op,r,yes,no});
      } else {
        throw Error("unsupported statement: "+peek());
      }
    }
    depth--;
    return stmts;
  };
  const statements=sequence(["}"]);
  need("}");
  assert(i===tokens.length,"trailing tokens");
  assert(statements.length>0,"empty function");
  return {name,params,statements};
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
function lower(parsed) {
  const arg=x=>{
    const i=parsed.params.indexOf(x);
    assert(i>=0,"unknown typed parameter");
    return "arg"+i;
  };
  const seq=(steps,continuation)=>{
    let next=continuation;
    for(let i=steps.length-1;i>=0;i--){
      const s=steps[i];
      if(s.tag==="return"){
        next=arg(s.arg);
      } else {
        assert(s.tag==="if"&&Object.hasOwn(OPS,s.op),"unsupported branch node");
        const cond="("+OPS[s.op]+" "+arg(s.l)+" "+arg(s.r)+")";
        const yes=seq(s.yes,next),no=seq(s.no,next);
        assert(yes!==null&&no!==null,"not all control-flow paths return");
        next="(ite "+cond+" "+yes+" "+no+")";
      }
    }
    return next;
  };
  const result=seq(parsed.statements,null);
  assert(result!==null,"not all paths return");
  return result;
}
const CONTRACT={
  min_int:"(ite (bvsle arg0 arg1) arg0 arg1)",
  max_int:"(ite (bvsge arg0 arg1) arg0 arg1)",
  clamp_int:"(ite (bvsgt arg1 arg2) arg1 (ite (bvslt arg0 arg1) arg1 (ite (bvsgt arg0 arg2) arg2 arg0)))"
};
const MUTANT={
  min_int:"(ite (bvsgt x y) x y)",
  max_int:"(ite (bvslt x y) x y)",
  clamp_int:"(ite (bvsgt y z) y (ite (bvslt x y) y x))"
};
export function renderSmt(parsed,name) {
  assert(parsed.name===name&&Object.hasOwn(ARITY,name),"invalid function identity");
  assert(parsed.params.length===ARITY[name],"invalid parameter arity");
  const signature=parsed.params.map((_,i)=>"(arg"+i+" (_ BitVec 64))").join(" ");
  const symbols=["x","y","z"].slice(0,parsed.params.length);
  const call=fn=>"("+fn+" "+symbols.join(" ")+")";
  return [
    "(set-logic QF_BV)",
    "(define-fun implementation ("+signature+") (_ BitVec 64) "+lower(parsed)+")",
    "(define-fun contract ("+signature+") (_ BitVec 64) "+CONTRACT[name]+")",
    ...symbols.map(x=>"(declare-const "+x+" (_ BitVec 64))"),
    "(push 1)","(assert (distinct "+call("implementation")+" "+call("contract")+"))",
    "(check-sat)","(pop 1)",
    "(push 1)","(assert (distinct "+MUTANT[name]+" "+call("contract")+"))",
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
  assert(args.length===2&&NAME.test(args[0]),"usage: [--check] min_int|max_int|clamp_int source.ores");
  const [name,path]=args;
  const input=readFileSync(path,"utf8");
  const smt=renderSmt(extractScalar(input,name),name);
  if(checking) {checkWithZ3(smt); process.stdout.write("SOURCE-SLICE-REFINEMENT-OK "+name+"\n");}
  else process.stdout.write(smt);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {main(process.argv.slice(2));} catch(e) {console.error("UNVERIFIED:",e.message);process.exitCode=1;}
}
