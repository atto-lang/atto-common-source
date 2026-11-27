// Classify process outcomes before inspecting output or accepting a diagnostic.
export function classifyNativeCompilerResult(result, artifact) {
  if (result.error || result.signal || !Number.isInteger(result.status))
    return {status: 'INFRASTRUCTURE_FAILURE', artifact: Boolean(artifact)};
  if (result.status === 0)
    return {status: artifact ? 'EMITTED' : 'MISSING_ARTIFACT', artifact: Boolean(artifact)};
  return {status: artifact ? 'FAILED_WITH_ARTIFACT' : 'REJECTED', artifact: Boolean(artifact)};
}
