// Source-free reference for proposed ModelRunStamp identity/version fencing.
// NOT a compiler/runtime implementation and NOT cryptographic proof.
export class ModelFenceError extends Error {
  constructor(code) { super(code); this.name = "ModelFenceError"; this.code = code; }
}
const fail = code => { throw new ModelFenceError(code); };
const record = x => x !== null && typeof x === "object" && !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
const exact = (x, fields, code) => {
  if (!record(x)) fail(code);
  const keys = Reflect.ownKeys(x);
  if (keys.some(k => typeof k !== "string" || !fields.includes(k))) fail(code);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail(code);
  }
};
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const id = (x, code) => { if (typeof x !== "string" || !ID.test(x)) fail(code); return x; };
const digest = (x, code) => { if (typeof x !== "string" || !DIGEST.test(x)) fail(code); return x; };
const version = (x, code) => {
  if (!Number.isSafeInteger(x) || x < 0) fail(code);
  return x;
};
function graph(g) {
  exact(g, ["modelTypeId","graphDigest","graphGeneration"], "MODEL_INVALID_GRAPH_IDENTITY");
  return Object.freeze({
    modelTypeId: id(g.modelTypeId, "MODEL_INVALID_MODEL_TYPE_ID"),
    graphDigest: digest(g.graphDigest, "MODEL_INVALID_GRAPH_DIGEST"),
    graphGeneration: version(g.graphGeneration, "MODEL_INVALID_GRAPH_GENERATION")
  });
}
function instance(i) {
  exact(i, ["instanceId","modelTypeId","graphDigest","graphGeneration","parameterVersion"], "MODEL_INVALID_INSTANCE_IDENTITY");
  const pv = i.parameterVersion === null ? null : version(i.parameterVersion, "MODEL_INVALID_PARAMETER_VERSION");
  return Object.freeze({
    instanceId: id(i.instanceId, "MODEL_INVALID_INSTANCE_ID"),
    modelTypeId: id(i.modelTypeId, "MODEL_INVALID_MODEL_TYPE_ID"),
    graphDigest: digest(i.graphDigest, "MODEL_INVALID_GRAPH_DIGEST"),
    graphGeneration: version(i.graphGeneration, "MODEL_INVALID_GRAPH_GENERATION"),
    parameterVersion: pv
  });
}
function compatible(g, i) {
  if (i.modelTypeId !== g.modelTypeId) fail("MODEL_INSTANCE_TYPE_MISMATCH");
  if (i.graphDigest !== g.graphDigest) fail("MODEL_INSTANCE_GRAPH_MISMATCH");
  if (i.graphGeneration !== g.graphGeneration) fail("MODEL_GRAPH_GENERATION_MISMATCH");
}
export function beginModelRun(graphIdentity, instanceIdentity, request) {
  const g = graph(graphIdentity), i = instance(instanceIdentity);
  compatible(g, i);
  exact(request, ["runId","executionProfileDigest"], "MODEL_INVALID_RUN_REQUEST");
  const runId = id(request.runId, "MODEL_INVALID_RUN_ID");
  const executionProfileDigest = digest(request.executionProfileDigest, "MODEL_INVALID_EXECUTION_PROFILE");
  return Object.freeze({
    runId,
    modelTypeId: g.modelTypeId,
    graphDigest: g.graphDigest,
    graphGeneration: g.graphGeneration,
    instanceId: i.instanceId,
    parameterVersion: i.parameterVersion,
    executionProfileDigest
  });
}
export function validateModelRunStamp(stamp, graphIdentity, instanceIdentity, request) {
  const expected = beginModelRun(graphIdentity, instanceIdentity, request);
  exact(stamp, ["runId","modelTypeId","graphDigest","graphGeneration","instanceId","parameterVersion","executionProfileDigest"], "MODEL_INVALID_RUN_STAMP");
  if (stamp.runId !== expected.runId) fail("MODEL_RUN_MISMATCH");
  if (stamp.modelTypeId !== expected.modelTypeId) fail("MODEL_INSTANCE_TYPE_MISMATCH");
  if (stamp.graphDigest !== expected.graphDigest) fail("MODEL_INSTANCE_GRAPH_MISMATCH");
  if (stamp.graphGeneration !== expected.graphGeneration) fail("MODEL_GRAPH_GENERATION_MISMATCH");
  if (stamp.instanceId !== expected.instanceId) fail("MODEL_INSTANCE_ID_MISMATCH");
  if (stamp.parameterVersion !== expected.parameterVersion) fail("MODEL_PARAMETER_VERSION_MISMATCH");
  if (stamp.executionProfileDigest !== expected.executionProfileDigest) fail("MODEL_EXECUTION_PROFILE_MISMATCH");
  return true;
}
export function nextParameterVersion(stamp, graphIdentity, instanceIdentity, request) {
  validateModelRunStamp(stamp, graphIdentity, instanceIdentity, request);
  if (stamp.parameterVersion === null) fail("MODEL_STATELESS_INSTANCE");
  if (stamp.parameterVersion === Number.MAX_SAFE_INTEGER) fail("MODEL_PARAMETER_VERSION_OVERFLOW");
  return stamp.parameterVersion + 1;
}

export function nextGraphGeneration(graphIdentity) {
  const g = graph(graphIdentity);
  if (g.graphGeneration === Number.MAX_SAFE_INTEGER) fail("MODEL_GRAPH_GENERATION_OVERFLOW");
  return g.graphGeneration + 1;
}
export function commitModelRun(stamp, graphIdentity, instanceIdentity, request, committedRunIds = []) {
  validateModelRunStamp(stamp, graphIdentity, instanceIdentity, request);
  if (!Array.isArray(committedRunIds) ||
      Object.keys(committedRunIds).length !== committedRunIds.length ||
      committedRunIds.some(x => typeof x !== "string")) fail("MODEL_INVALID_RUN_REQUEST");
  if (committedRunIds.includes(stamp.runId)) fail("MODEL_RUN_REPLAY");
  return Object.freeze([...committedRunIds, stamp.runId]);
}

export function compiledPlanCacheKey(graphDigest, executionProfileDigest) {
  const g = digest(graphDigest, "MODEL_INVALID_GRAPH_DIGEST");
  const p = digest(executionProfileDigest, "MODEL_INVALID_EXECUTION_PROFILE");
  return "ores-model-plan-v1:" + g + ":" + p;
}
