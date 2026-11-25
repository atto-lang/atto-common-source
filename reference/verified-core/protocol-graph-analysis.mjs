// Advisory finite-graph analysis. No scheduler, guard, delivery or liveness proof.
export function analyzeProtocolGraph(protocol) {
  const { states, edges } = protocol.mailbox;
  const names = states.map(s => s.name);
  const forward = new Map(names.map(n => [n, []]));
  const reverse = new Map(names.map(n => [n, []]));
  for (const { source, target } of edges) {
    forward.get(source).push(target);
    reverse.get(target).push(source);
  }
  function visit(initial, adjacency) {
    const seen = new Set(initial);
    const todo = [...seen];
    for (let i = 0; i < todo.length; i++) {
      for (const next of adjacency.get(todo[i])) {
        if (!seen.has(next)) { seen.add(next); todo.push(next); }
      }
    }
    return seen;
  }
  const reachable = visit([protocol.initial], forward);
  const terminals = states.filter(s => s.terminal).map(s => s.name);
  const terminalPath = visit(terminals, reverse);
  return Object.freeze({
    unreachable: Object.freeze(names.filter(n => !reachable.has(n)).sort()),
    reachableNonterminalSinks: Object.freeze(names.filter(n => reachable.has(n) &&
      !terminals.includes(n) && forward.get(n).length === 0).sort()),
    reachableWithoutTerminalPath: Object.freeze(names.filter(n => reachable.has(n) && !terminalPath.has(n)).sort()),
  });
}
