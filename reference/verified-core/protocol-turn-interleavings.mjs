// Abstract two-credit, two-message, two-incarnation model. Not runtime code,
// not a liveness proof, and not a substitute for compiled scheduler traces.
const initial = () => ({ generation: 1, live: true, phase: 0, next: 0,
  pending: [], active: null, settled: [], credits: 2, last: null });
const clone = s => JSON.parse(JSON.stringify(s));
const key = s => JSON.stringify(s);

function settle(s, id, mutate) {
  s.settled.push(id);
  s.credits += mutate === "double-credit" ? 2 : 1;
}
function successors(s, mutate) {
  const out = [];
  const transition = (name, apply) => {
    const n = clone(s); n.last = null; apply(n); out.push({ name, state: n });
  };
  if (s.live && s.credits > 0 && s.next < 2) {
    for (const tag of [0, 1]) transition("admit:" + tag, n => {
      n.pending.push({ id: n.next++, generation: n.generation, tag });
      n.credits--;
    });
  }
  if (s.live && !s.active && s.pending.length) transition("begin", n => {
    const item = n.pending.shift();
    n.active = { ...item, source: n.phase, eligible: item.tag === n.phase };
  });
  if (s.active) {
    transition("complete", n => {
      const a = n.active;
      const authority = n.live && a.generation === n.generation && a.source === n.phase;
      if (a.eligible && (authority || mutate === "omit-stop-fence")) {
        n.phase = 1 - a.source;
        n.last = { generation: a.generation, live: n.live, source: a.source, target: n.phase, tag: a.tag };
      }
      n.active = null;
      settle(n, a.id, mutate);
    });
    transition("cancel", n => { const id = n.active.id; n.active = null; settle(n, id, mutate); });
  }
  if (s.live) transition("stop", n => {
    n.live = false;
    for (const item of n.pending) settle(n, item.id, mutate);
    n.pending = [];
  });
  if (!s.live && !s.active && !s.pending.length && s.generation < 2) transition("restart", n => {
    n.live = true; n.generation++; n.phase = 0;
  });
  return out;
}

function violation(s) {
  const outstanding = [...s.pending.map(x => x.id), ...(s.active ? [s.active.id] : [])];
  const all = [...outstanding, ...s.settled];
  if (new Set(all).size !== all.length || all.length !== s.next ||
      all.some(id => id < 0 || id >= s.next)) return "settlement-partition";
  if (s.credits < 0 || s.credits > 2 || s.credits + outstanding.length !== 2) return "credit-conservation";
  if (s.pending.some(m => m.generation !== s.generation) ||
      (s.active && s.active.generation !== s.generation)) return "generation";
  if (!s.live && s.pending.length) return "stopped-queue";
  const p = s.last;
  if (p && (!p.live || p.generation !== s.generation || p.tag !== p.source || p.target !== 1-p.source))
    return "publication-authority";
  return null;
}

export function exploreProtocolTurns(maxDepth = 12, mutate = null) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16 ||
      ![null, "omit-stop-fence", "double-credit"].includes(mutate)) throw new RangeError("invalid model budget or mutant");
  const first = initial();
  const queue = [{ state: first, trace: [] }];
  const seen = new Set([key(first)]);
  let transitions = 0;
  for (let at = 0; at < queue.length; at++) {
    const {state, trace} = queue[at];
    const bad = violation(state);
    if (bad) return { safe: false, violation: bad, trace, states: seen.size, transitions };
    if (trace.length === maxDepth) continue;
    for (const next of successors(state, mutate)) {
      transitions++;
      const k = key(next.state);
      if (!seen.has(k)) { seen.add(k); queue.push({ state: next.state, trace: [...trace,next.name] }); }
    }
  }
  return { safe: true, states: seen.size, transitions, maxDepth };
}
