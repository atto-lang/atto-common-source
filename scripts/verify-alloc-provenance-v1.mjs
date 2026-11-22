// Offline correlation of independently fetched GitHub API tree/run/job objects
// with a real job log. Never an attestation of the authenticity of inputs.
const SHA = /^[a-f0-9]{40}$/;
const positiveInt = x => Number.isSafeInteger(x) && x > 0;
const requireFact = (ok, why) => { if (!ok) throw new Error(why); };

function treeFiles(tree, prefix = '') {
  requireFact(tree && tree.truncated === false && Array.isArray(tree.tree),
    'missing or truncated recursive Git tree');
  const files = new Map();
  for (const e of tree.tree) {
    requireFact(e && typeof e.path === 'string' && !e.path.startsWith('/') &&
      !e.path.split('/').some(s => !s || s === '.' || s === '..'), 'unsafe Git tree path');
    if (e.type === 'tree') continue;
    if (prefix && !e.path.startsWith(prefix)) continue;
    requireFact(e.type === 'blob' || e.type === 'commit', 'unexpected Git tree type');
    requireFact(SHA.test(e.sha) && typeof e.mode === 'string', 'invalid Git tree object');
    const path = e.path.slice(prefix.length);
    requireFact(path && !files.has(path), 'duplicate or missing Git tree path');
    files.set(path, `${e.mode}:${e.type}:${e.sha}`);
  }
  requireFact(files.size > 0, 'empty Git tree scope');
  return files;
}
export function verifyExactMirrorTree(source, mirror, prefix = 'atto-source/') {
  requireFact(/^[a-z0-9][a-z0-9/_-]*\/$/.test(prefix) && !prefix.includes('//'),
    'invalid private mirror prefix');
  const original = treeFiles(source);
  const copied = treeFiles(mirror, prefix);
  requireFact(original.size === copied.size, 'missing or additional mirrored files');
  for (const [path, identity] of original) {
    requireFact(copied.get(path) === identity, `mirror Git object mismatch ${path}`);
  }
  return original.size;
}
export function verifyGitHubJob(run, job, mirrorHead, requiredStep) {
  requireFact(SHA.test(mirrorHead), 'invalid mirror commit SHA');
  requireFact(run && positiveInt(run.id) && positiveInt(run.run_attempt) &&
    run.head_sha === mirrorHead && run.status === 'completed' &&
    run.conclusion === 'success', 'stale or non-successful GitHub run');
  requireFact(job && positiveInt(job.id) && positiveInt(job.runner_id) &&
    job.run_id === run.id && job.run_attempt === run.run_attempt &&
    job.head_sha === mirrorHead && job.status === 'completed' &&
    job.conclusion === 'success', 'unassigned, stale or failed GitHub job');
  requireFact(typeof requiredStep === 'string' && requiredStep.length > 0,
    'missing required execution step');
  requireFact(Array.isArray(job.steps) && job.steps.length > 0,
    'zero-step GitHub job is NOT_EXECUTED');
  requireFact(job.steps.some(s => s && s.name === requiredStep &&
    s.status === 'completed' && s.conclusion === 'success'),
    'required guest execution step did not succeed');
}
export function verifyCaseLog(log, cases, fixtureBlobs) {
  requireFact(typeof log === 'string' && log.length > 0 && log.length < 2_000_000,
    'missing or oversized GitHub job log');
  requireFact(Array.isArray(cases) && cases.length > 0 && cases.length <= 128,
    'invalid semantic obligations');
  requireFact(fixtureBlobs && typeof fixtureBlobs === 'object' &&
    !Array.isArray(fixtureBlobs), 'missing fixture object identities');
  const expected = new Map();
  for (const c of cases) {
    requireFact(c && typeof c.id === 'string' && !expected.has(c.id),
      'duplicate semantic contract case');
    requireFact(['PASS','REJECT'].includes(c.expected) &&
      ['compile','guest','runtime'].includes(c.phase), 'invalid case semantics');
    requireFact(SHA.test(fixtureBlobs[c.id]), `missing exact fixture blob ${c.id}`);
    expected.set(c.id, `${c.phase} ${c.expected} ${fixtureBlobs[c.id]}`);
  }
  requireFact(Object.keys(fixtureBlobs).length === expected.size,
    'extra fixture blobs not in semantic contract');
  const seen = new Set();
  let executions = 0;
  for (const line of log.split(/\r?\n/)) {
    if (line === 'ATTO_ALLOC_GUEST_EXECUTED') executions++;
    if (!line.startsWith('ATTO_ALLOC_CASE ')) continue;
    const fields = line.slice('ATTO_ALLOC_CASE '.length).trim().split(/\s+/);
    requireFact(fields.length === 4, 'malformed guest case receipt');
    const [id, phase, outcome, sha] = fields;
    requireFact(expected.has(id) && !seen.has(id), `unexpected or repeated case ${id}`);
    requireFact(expected.get(id) === `${phase} ${outcome} ${sha}`,
      `case result or exact fixture blob mismatch ${id}`);
    seen.add(id);
  }
  requireFact(executions === 1, 'missing or duplicated guest execution marker in actual job log');
  requireFact(seen.size === expected.size, 'missing executed guest case receipts');
  return seen.size;
}
export function verifyAllocationProvenance({sourceTree, mirrorTree, mirrorPrefix,
  mirrorHead, run, job, requiredStep, jobLog, cases, fixtureBlobs}) {
  const objects = verifyExactMirrorTree(sourceTree, mirrorTree, mirrorPrefix);
  verifyGitHubJob(run, job, mirrorHead, requiredStep);
  const count = verifyCaseLog(jobLog, cases, fixtureBlobs);
  return {status: 'OFFLINE_CROSSCHECK_ONLY', exactGitObjects: objects, caseReceipts: count};
}
