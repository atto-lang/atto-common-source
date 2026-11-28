// Bounded symbolic construction/drop ledger. No guest or runtime authority.
export function checkConstruction(fieldCount, events) {
  const require=(ok,message)=>{if(!ok)throw new Error(message);};
  const id=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
  require(Number.isInteger(fieldCount)&&fieldCount>=0&&fieldCount<=64,"field count");
  require(Array.isArray(events)&&events.length>0&&events.length<=512,"event count");
  let phase="fresh", owner=null, initialized=0, dropped=0;
  for(const e of events){
    require(e&&typeof e==="object"&&!Array.isArray(e)&&Object.hasOwn(e,"op"),"event");
    const shape=(...keys)=>require(Object.keys(e).length===keys.length+1&&keys.every(k=>Object.hasOwn(e,k)),"event shape");
    switch(e.op){
      case "reserve":
        shape("owner");require(phase==="fresh"&&id(e.owner),"reserve");owner=e.owner;phase="constructing";break;
      case "deny":
        shape("reason");require(phase==="fresh"&&["quota","resource"].includes(e.reason),"denial");phase="denied";break;
      case "init":
        shape("owner","field");require(phase==="constructing"&&e.owner===owner&&initialized<fieldCount&&e.field===initialized,"initialization");initialized++;break;
      case "publish":
        shape("owner");require(phase==="constructing"&&e.owner===owner&&initialized===fieldCount,"publish");phase="published";break;
      case "move":
        shape("owner","to");require(phase==="published"&&e.owner===owner&&id(e.to)&&e.to!==owner,"move");owner=e.to;break;
      case "move_deny":
        shape("owner","to");require(phase==="published"&&e.owner===owner&&id(e.to)&&e.to!==owner,"move denial");break;
      case "unwind":
        shape("owner");require(phase==="constructing"&&e.owner===owner,"unwind");phase="destroying";break;
      case "destroy":
        shape("owner");require(phase==="published"&&e.owner===owner,"destroy");phase="destroying";break;
      case "drop":
        shape("owner","field");require(phase==="destroying"&&e.owner===owner&&initialized>dropped&&e.field===initialized-dropped-1,"drop order");dropped++;break;
      case "release":
        shape("owner");require(phase==="destroying"&&e.owner===owner&&initialized===dropped,"release");phase="released";break;
      default:throw Error("unknown operation");
    }
  }
  require(phase==="denied"||phase==="released","unfinished obligation");
  return {outcome:phase,initialized,dropped,certified:false};
}
