// A bounded, closed compilation manifest; source-policy proof only.
// A compiler must independently certify AST identity, trait resolution and IR.
const reject = message => { throw new Error('SPECIALIZATION_REJECT: ' + message); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, wanted, name) => {
  if (!object(x)) reject(name + ' is not a record');
  const actual = Object.keys(x).sort();
  const expected = [...wanted].sort();
  if (actual.length !== expected.length || actual.some((v,i) => v !== expected[i]))
    reject(name + ' has missing or unknown fields');
};
const sym = x => typeof x === 'string' && x.length > 0 && x.length <= 512 &&
  /^[A-Za-z_$][A-Za-z0-9_.$:<>-]*$/.test(x);
const symbol = (x, what) => { if (!sym(x)) reject('invalid ' + what); };
const uint = (x, min, max, what) => {
  if (!Number.isSafeInteger(x) || x < min || x > max) reject('invalid ' + what);
};

/**
 * Validates a compiler-supplied finite specialization closure and byte budget.
 * A recursive call to the SAME concrete instantiation is legal; a call to an
 * instantiation outside the frozen closure is not. No runtime generic lookup.
 */
export function validateSpecializationManifest(manifest) {
  keys(manifest, ['schema','closureComplete','runtimeSpecialization','maxCodeBytes',
    'nodes','roots'], 'manifest');
  if (manifest.schema !== 'atto.specialization-closure.v1') reject('schema');
  if (manifest.closureComplete !== true || manifest.runtimeSpecialization !== false)
    reject('closure was not frozen before code generation');
  uint(manifest.maxCodeBytes, 1, 268435456, 'max code bytes');
  if (!Array.isArray(manifest.nodes) || manifest.nodes.length < 1 ||
      manifest.nodes.length > 4096) reject('generic instantiation count');
  const ids = new Map(), symbols = new Set();
  let bytes = 0;
  for (const n of manifest.nodes) {
    keys(n, ['id','callee','witness','types','emittedSymbol','estimatedBytes',
      'calls','abiVerified','semanticChecksPassed'], 'specialization node');
    for (const field of ['id','callee','witness','emittedSymbol']) symbol(n[field], field);
    if (ids.has(n.id)) reject('duplicate specialization id');
    if (symbols.has(n.emittedSymbol)) reject('different instantiations alias same emitted symbol');
    ids.set(n.id, n); symbols.add(n.emittedSymbol);
    if (!Array.isArray(n.types) || n.types.length < 1 || n.types.length > 32)
      reject('missing or oversized concrete type tuple');
    n.types.forEach(t => symbol(t, 'concrete type'));
    if (n.abiVerified !== true || n.semanticChecksPassed !== true)
      reject('ABI, type, ownership, effect or capability proof absent');
    uint(n.estimatedBytes, 1, 268435456, 'instantiation estimate');
    bytes += n.estimatedBytes;
    if (!Number.isSafeInteger(bytes) || bytes > manifest.maxCodeBytes)
      reject('compiled specialization byte budget exceeded');
    if (!Array.isArray(n.calls) || n.calls.length > 4096)
      reject('invalid specialization dependencies');
    const unique = new Set();
    for (const edge of n.calls) {
      symbol(edge, 'specialization edge');
      if (unique.has(edge)) reject('duplicate specialization dependency');
      unique.add(edge);
    }
  }
  if (!Array.isArray(manifest.roots) || manifest.roots.length < 1 ||
      manifest.roots.length > 4096 || new Set(manifest.roots).size !== manifest.roots.length)
    reject('invalid frozen roots');
  const seen = new Set(), todo = [...manifest.roots];
  while (todo.length) {
    const id = todo.pop();
    symbol(id, 'root/edge');
    const node = ids.get(id);
    if (!node) reject('missing compiled specialization for ' + id);
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of node.calls) todo.push(child);
  }
  if (seen.size !== ids.size) reject('unreachable or unauthorized emitted specialization');
  return Object.freeze({instantiations: ids.size, estimatedCodeBytes: bytes});
}
