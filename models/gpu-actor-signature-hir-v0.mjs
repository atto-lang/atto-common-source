/**
 * Cross-backend source descriptor admission. This is NOT device IR or
 * a GPU runtime capability. It never returns a dispatch-authorizing token.
 */
const kind = new Set(['VOID','BOOL','I32','I64','U32','U64','F32','F64','F32_DEVICE_BUFFER']);
const ownKeys = x => x !== null && typeof x === 'object'
  && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keysEqual = (x, names) => ownKeys(x)
  && Object.keys(x).length === names.length
  && names.every(k => Object.hasOwn(x,k));
const nameOk = x => typeof x === 'string'
  && x.length > 0 && x.length <= 1024 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(x);
const methodOk = x => typeof x === 'string'
  && x.length <= 1024 && /^[a-z][a-z0-9_]*$/.test(x);
const sourceFields = ['name','visibility','state','methods','admissionStage',
  'bodyEffectsVerified','ownedDeviceBuffersVerified','executable','physicalGpuVerified'];

export function validateGpuActorSignatureV0(d) {
  const errors = [];
  const bad = x => errors.push(x);
  if (!keysEqual(d,sourceFields)) {
    return {ok:false,errors:['GPU_ACTOR_DESCRIPTOR_SCHEMA']};
  }
  if (!nameOk(d.name)) bad('GPU_ACTOR_NAME_INVALID');
  if (!['PUBLIC','PRIVATE'].includes(d.visibility)) bad('GPU_ACTOR_VISIBILITY_INVALID');
  if (d.admissionStage !== 'TYPED_SIGNATURE_ONLY') bad('GPU_ACTOR_FORGED_STAGE');
  for (const field of ['bodyEffectsVerified','ownedDeviceBuffersVerified',
                        'executable','physicalGpuVerified']) {
    if (d[field] !== false) bad('GPU_ACTOR_UNPROVEN_PROMOTION:' + field);
  }
  if (!Array.isArray(d.state) || d.state.length > 128) bad('GPU_ACTOR_STATE_BUDGET');
  else {
    const names = new Set();
    for (const f of d.state) {
      if (!keysEqual(f,['name','kind']) || !nameOk(f.name)
          || !kind.has(f.kind) || f.kind === 'VOID') {
        bad('GPU_ACTOR_STATE_FIELD_INVALID'); continue;
      }
      if (names.has(f.name)) bad('GPU_ACTOR_DUPLICATE_STATE');
      names.add(f.name);
    }
  }
  if (!Array.isArray(d.methods) || d.methods.length > 64) bad('GPU_ACTOR_METHOD_BUDGET');
  else {
    const signatures = new Set();
    for (const m of d.methods) {
      if (!keysEqual(m,['name','arguments','result','sourceTokenCount'])
          || !methodOk(m.name) || !kind.has(m.result)
          || !Number.isSafeInteger(m.sourceTokenCount)
          || m.sourceTokenCount < 1 || m.sourceTokenCount > 1024
          || !Array.isArray(m.arguments) || m.arguments.length > 32) {
        bad('GPU_ACTOR_METHOD_INVALID'); continue;
      }
      const signature = m.name + '/' + m.arguments.length;
      if (signatures.has(signature)) bad('GPU_ACTOR_DUPLICATE_METHOD_ARITY');
      signatures.add(signature);
      const params = new Set();
      for (const a of m.arguments) {
        if (!keysEqual(a,['name','kind']) || !nameOk(a.name)
            || !kind.has(a.kind) || a.kind === 'VOID') {
          bad('GPU_ACTOR_ARGUMENT_INVALID'); continue;
        }
        if (params.has(a.name)) bad('GPU_ACTOR_DUPLICATE_PARAMETER');
        params.add(a.name);
      }
    }
  }
  return {ok:errors.length===0, errors};
}
