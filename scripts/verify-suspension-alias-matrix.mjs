export function verifyDuplicateSuspensionMatrix(manifest) {
  const spellings = ['suspends', 'susp', '⧖', '∂'];
  const cases = manifest.cases;
  if (!Array.isArray(cases) || new Set(cases.map(c => c.id)).size !== cases.length)
    throw new Error('missing cases or duplicate IDs');
  let checked = 0;
  for (const first of spellings) for (const second of spellings) {
    const source = 'pub ' + first + ' ' + second + ' fnc invalid(): void { return; }';
    const matches = cases.filter(c => c.source === source);
    if (matches.length !== 1 || matches[0].expected !== 'reject' ||
        matches[0].category !== 'suspends' || matches[0].lowering_pending !== false)
      throw new Error('missing or non-rejecting duplicate suspension pair: ' + first + ' ' + second);
    checked++;
  }
  return checked;
}
