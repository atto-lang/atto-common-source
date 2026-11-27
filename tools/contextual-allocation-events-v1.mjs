// Atto contextual allocation event contract v1 — symbolic reference replay only.
// This verifies a declared event stream, not runtime authority or completeness.
// The authenticated observer must independently bind each event to an actual guest.
export function replay(events) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 1_000_000) throw Error("event count");
  const contexts = new Map(), tasks = new Map(), allocations = new Map();
  const taskHistory = new Set();
  let mainContext = null, liveActors = 0, total = 0n, peak = 0n, retired = 0, released = 0;
  const require = (ok, reason) => { if (!ok) throw Error(reason); };
  const id = x => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x);
  const nat = x => Number.isSafeInteger(x) && x >= 0;
  const positive = x => nat(x) && x > 0;
  const getContext = key => {
    require(id(key), "invalid context id");
    const c = contexts.get(key);
    require(c && c.state === "open", "context not open");
    return c;
  };
  const own = (e, key) => Object.hasOwn(e,key);
  const shape = (e, keys) => require(e && typeof e === "object" && !Array.isArray(e) && Object.keys(e).length === keys.length && keys.every(k=>own(e,k)), "event shape");
  for (const e of events) {
    require(e && typeof e === "object" && own(e,"op"), "event op");
    switch(e.op) {
      case "open": {
        shape(e,["op","context","kind","quota"]);
        require(id(e.context) && !contexts.has(e.context) && positive(e.quota), "context identity/quota");
        require(e.kind === "main" || e.kind === "actor", "context kind");
        if (e.kind === "main") { require(mainContext===null,"duplicate main"); mainContext=e.context; }
        else { require(mainContext!==null && contexts.get(mainContext)?.state==="open", "actor outside main lifetime"); liveActors++; }
        contexts.set(e.context,{kind:e.kind,quota:BigInt(e.quota),bytes:0n,state:"open",tasks:0,pins:new Set(),pinHistory:new Set()});
        break;
      }
      case "enter": {
        shape(e,["op","context","task"]);
        const c=getContext(e.context);
        require(id(e.task) && !taskHistory.has(e.task), "task identity reused");
        taskHistory.add(e.task);
        tasks.set(e.task,{context:e.context,active:true});
        c.tasks++; break;
      }
      case "suspend":
      case "resume":
      case "leave": {
        shape(e,["op","context","task"]);
        const c=getContext(e.context), t=tasks.get(e.task);
        require(t && t.context===e.context,"context changed across task");
        if(e.op==="suspend"){require(t.active,"already suspended");t.active=false;}
        else if(e.op==="resume"){require(!t.active,"already active");t.active=true;}
        else {require(t.active,"leave suspended");tasks.delete(e.task);c.tasks--;}
        break;
      }
      case "alloc":
      case "deny": {
        shape(e,["op","context","task","allocation","bytes","align","placement"]);
        const c=getContext(e.context), t=tasks.get(e.task);
        require(t && t.active && t.context===e.context,"no matching active context");
        require(e.placement==="contextual","implicit host or unknown placement");
        require(id(e.allocation) && !allocations.has(e.allocation),"allocation identity reused");
        require(positive(e.bytes) && positive(e.align) && e.align<=65536 && (BigInt(e.align)&(BigInt(e.align)-1n))===0n,"invalid allocation layout");
        const align=BigInt(e.align), bytes=BigInt(e.bytes), charge=(bytes+align-1n)/align*align;
        if(e.op==="deny"){require(c.bytes+charge>c.quota,"quota denial not justified");break;}
        require(c.bytes+charge<=c.quota,"quota exceeded");
        allocations.set(e.allocation,{context:e.context,charge,live:true});
        c.bytes+=charge;total+=charge;if(total>peak)peak=total;
        break;
      }
      case "release": {
        shape(e,["op","context","task","allocation"]);
        const c=getContext(e.context), t=tasks.get(e.task), a=allocations.get(e.allocation);
        require(t && t.active && t.context===e.context && a && a.live && a.context===e.context,"invalid release");
        a.live=false;c.bytes-=a.charge;total-=a.charge;released++;break;
      }
      case "pin":
      case "unpin": {
        shape(e,["op","context","pin"]);
        const c=getContext(e.context);
        require(id(e.pin),"invalid pin");
        if(e.op==="pin"){require(!c.pinHistory.has(e.pin),"pin incarnation reused");c.pinHistory.add(e.pin);c.pins.add(e.pin);}
        else {require(c.pins.delete(e.pin),"unknown pin");}
        break;
      }
      case "retire": {
        shape(e,["op","context"]);
        const c=getContext(e.context);
        require(c.tasks===0 && c.pins.size===0 && c.bytes===0n,"live retirement");
        if(c.kind==="main") require(liveActors===0,"main retires before actors");
        else liveActors--;
        c.state="retired";retired++;break;
      }
      default: throw Error("unsupported event");
    }
  }
  require(mainContext!==null && liveActors===0 && total===0n && tasks.size===0 && retired===contexts.size,"incomplete lifetime");
  return {peak_bytes:peak.toString(),released,retired,certified:false};
}
function selfTest(){
  const open=(context,kind,quota=16)=>({op:"open",context,kind,quota});
  const task=(op,context,task)=>({op,context,task});
  const alloc=(op,context,task,allocation,bytes=9,align=8)=>({op,context,task,allocation,bytes,align,placement:"contextual"});
  const release=(context,task,allocation)=>({op:"release",context,task,allocation});
  const retire=context=>({op:"retire",context});
  const good=()=>[open("main","main"),open("actor","actor"),task("enter","main","m"),task("enter","actor","a"),alloc("alloc","main","m","m1"),alloc("alloc","actor","a","a1"),alloc("deny","actor","a","a2",1,1),task("suspend","actor","a"),{op:"pin",context:"actor",pin:"io"},task("resume","actor","a"),{op:"unpin",context:"actor",pin:"io"},release("actor","a","a1"),task("leave","actor","a"),retire("actor"),release("main","m","m1"),task("leave","main","m"),retire("main")];
  const out=replay(good());
  if(out.peak_bytes!=="32"||out.released!==2||out.retired!==2||out.certified!==false)throw Error("positive mismatch");
  let n=1;
  const renewed=good();renewed.splice(11,0,{op:"pin",context:"actor",pin:"io2"},{op:"unpin",context:"actor",pin:"io2"});
  if(replay(renewed).certified!==false)throw Error("fresh pin incarnation");n++;
  const bad=[
    x=>x[0].kind="actor", x=>x[1].kind="main", x=>x[1].context="main",
    x=>x[0].quota=0,x=>x[4].bytes=0,x=>x[4].align=3,x=>x[4].align=0,
    x=>x[4].placement="host",x=>x[4].context="actor",x=>x[5].allocation="m1",
    x=>x[5].bytes=17,x=>x[6].op="alloc",x=>x[6].bytes=0,
    x=>x[9].context="main",x=>x[9].task="m",x=>x[10].pin="unknown",
    x=>x.splice(10,1),x=>x.splice(11,1),x=>x[11].allocation="m1",
    x=>x.splice(12,0,{...x[11]}),x=>x.splice(12,1),x=>x.pop(),
    x=>x[4].extra=1,x=>x[4].bytes=Number.MAX_SAFE_INTEGER+1,
    x=>x[4].op="gc",x=>x[4].op="host_alloc",x=>x.splice(9,0,alloc("alloc","actor","a","a3",1,1)),
    x=>x.splice(13,0,open("actor","actor")),x=>x[6].allocation="a1",
    x=>{x.push(open("late","actor"),retire("late"));},
    x=>{const r=x.splice(13,1)[0];x.push(r);},
    x=>{x.splice(13,0,task("enter","actor","a"),task("leave","actor","a"));},
    x=>{x.splice(14,0,task("enter","main","a"),task("leave","main","a"));},
    x=>{x.splice(11,0,{op:"pin",context:"actor",pin:"io"},{op:"unpin",context:"actor",pin:"io"});},
    x=>{x.splice(10,0,{op:"pin",context:"actor",pin:"io"});},
    x=>{x.splice(11,0,{op:"unpin",context:"actor",pin:"io"});}
  ];
  for(const mutate of bad){const x=good();mutate(x);let denied=false;try{replay(x)}catch{denied=true}if(!denied)throw Error("negative accepted "+n);n++;}
  // Valid repeated alloc/release on a long-lived contextual owner, no new contexts.
  const stress=[open("main","main",8),task("enter","main","m")];
  for(let i=0;i<10000;i++){const a="a"+i;stress.push(alloc("alloc","main","m",a,8,8),release("main","m",a));}
  stress.push(task("leave","main","m"),retire("main"));
  const s=replay(stress);if(s.peak_bytes!=="8"||s.released!==10000)throw Error("stress mismatch");
  return n+1;
}
console.log("contextual allocation symbolic replay self-tests:",selfTest());
