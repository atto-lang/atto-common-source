// Standalone host-only reporter reference: no stdout, filesystem or process mutations.
// A production Atto reporter must use the same structured event shape and escape strings.
function report_jsonl(run, metadata = {}) {
  if (!run || !Array.isArray(run.events) || !run.summary) throw new TypeError('invalid run');
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('invalid metadata');
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  const seen = new Set();
  const lines = [];
  for (let sequence = 0; sequence < run.events.length; sequence++) {
    const event = run.events[sequence];
    if (!event || !Object.hasOwn(counts, event.status) || typeof event.name !== 'string' || !event.name.trim() || typeof event.detail !== 'string') throw new TypeError('invalid event');
    if (seen.has(event.name)) throw new Error('duplicate terminal event: ' + event.name);
    seen.add(event.name);
    // Keep primary, acquisition, and cleanup diagnostics distinguishable.
    let issues;
    if (Object.hasOwn(event,'issues')) {
      if (event.status!=='FAIL' || !Array.isArray(event.issues) || event.issues.length===0 ||
          event.issues.some(x=>!x || !['acquire','body','release'].includes(x.phase) || typeof x.detail!=='string')) {
        throw new TypeError('invalid structured issues');
      }
      issues=event.issues.map(x=>({phase:x.phase,detail:x.detail}));
      if (event.detail!==issues.map(x=>x.phase+': '+x.detail).join('; ')) throw new Error('structured issues differ from case receipt');
    }
    counts[event.status]++;
    lines.push(JSON.stringify({schema:'atto.test.event.v1',kind:'case',sequence,status:event.status,name:event.name,detail:event.detail,...(issues?{issues}:{})}));
  }
  const {total,passed,failed,skipped,filtered}=run.summary;
  if (![total,passed,failed,skipped,filtered].every(v=>Number.isSafeInteger(v)&&v>=0)) throw new TypeError('invalid summary');
  if (total!==passed+failed+skipped||total!==run.events.length || counts.PASS!==passed || counts.FAIL!==failed || counts.SKIP!==skipped) throw new Error('summary does not match terminal events');
  const safe_metadata=Object.create(null);
  for(const [key,value] of Object.entries(metadata)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !(['string','number','boolean'].includes(typeof value)) || (typeof value ==='number'&&!Number.isFinite(value))) throw new TypeError('unsafe metadata');
    safe_metadata[key]=value;
  }
  lines.push(JSON.stringify({schema:'atto.test.event.v1',kind:'summary',sequence:run.events.length,counts:{total,passed,failed,skipped,filtered},metadata:safe_metadata}));
  return lines.join('\n')+'\n';
}
export {report_jsonl};
