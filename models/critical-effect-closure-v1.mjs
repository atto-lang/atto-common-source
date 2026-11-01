// Review-only closed-world effect oracle for the critical-body contract.
// NOT the Java/LLVM/.NET/Wasm/Cranelift production effect checker.
// Every dispatch alternative must be statically enumerated. A Future-returning
// call is not inherently suspending; effect bits, not return names, govern.
const EFFECTS = new Set(["pure", "read", "write", "alloc", "ffi-safe", "suspend", "block"]);

/**
 * Nodes: [{name, effects:[], calls:[{targets:[...], sealed:true}], trusted:true}]
 * Dynamic/virtual/typeclass edges are safe only if the targets list is
 * exhaustive (sealed). All unknown or incomplete metadata fails closed.
 */
export function checkCriticalEffectClosure(nodes, entry, {
  maxNodes = 256, maxEdges = 2048
} = {}) {
  const unknown = {diagnostic:"E_EFFECT_UNKNOWN", reachable:[]};
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 65536 ||
      !Number.isSafeInteger(maxEdges) || maxEdges < 0 || maxEdges > 1048576 ||
      !Array.isArray(nodes) || nodes.length > maxNodes ||
      typeof entry !== "string" || entry.length === 0) return unknown;
  const defs = new Map();
  for (const node of nodes) {
    if (node === null || typeof node !== "object" || Array.isArray(node) ||
        typeof node.name !== "string" || node.name.length === 0 ||
        node.name.length > 256 || defs.has(node.name) || node.trusted !== true ||
        !Array.isArray(node.effects) || node.effects.length > 32 ||
        node.effects.some(e => typeof e !== "string" || !EFFECTS.has(e)) ||
        !Array.isArray(node.calls) || node.calls.length > maxEdges) return unknown;
    defs.set(node.name, node);
  }
  let edgeCount = 0;
  const visited = new Set(), todo = [entry], effects = new Set();
  while (todo.length > 0) {
    const name = todo.pop();
    if (visited.has(name)) continue;
    const node = defs.get(name);
    if (!node || visited.size === maxNodes) return unknown;
    visited.add(name);
    for (const effect of node.effects) effects.add(effect);
    for (const call of node.calls) {
      if (call === null || typeof call !== "object" || Array.isArray(call) ||
          call.sealed !== true || !Array.isArray(call.targets) ||
          call.targets.length === 0 || call.targets.length > maxNodes ||
          call.targets.some(t => typeof t !== "string" || t.length === 0)) return unknown;
      edgeCount += call.targets.length;
      if (edgeCount > maxEdges) return unknown;
      for (const target of call.targets) {
        if (!defs.has(target)) return unknown;
        todo.push(target);
      }
    }
  }
  const reachable = [...visited].sort();
  if (effects.has("suspend"))
    return {diagnostic:"E_CRITICAL_SUSPENSION", reachable};
  if (effects.has("block"))
    return {diagnostic:"E_CRITICAL_BLOCKING", reachable};
  return {diagnostic:"accept", reachable};
}
