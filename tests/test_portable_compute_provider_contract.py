import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "portable-compute-provider.json"

def load():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))

def test_g3_is_trusted_runtime_only():
    c = load()
    assert c["gate"] == "G3"
    assert c["trustedRuntimeOnly"] is True
    assert c["sourceSyntaxEnabled"] is False
    assert c["implicitCpuFallback"] is False
    p = c["physicalProvider"]
    assert p["backend"] == "opencl-1.2"
    assert p["guestCanLoadProvider"] is False
    assert p["opaquePhysicalAllocationCapabilities"] is True
    assert p["opaqueQueueCapabilities"] is True
    assert p["opaqueDeviceEvents"] is True

def test_submission_and_quiescence_rules_fail_closed():
    s = load()["submissionRules"]
    assert s["markSubmittedOnlyAfterDurableEnqueue"] is True
    assert s["preEnqueueFailureUsesExactAbort"] is True
    assert s["submittedWorkCannotUseAbort"] is True
    assert s["completionRequiresExactProviderEvent"] is True
    assert s["cancellationImpliesQuiescence"] is False
    assert s["releaseRequiresQuiescence"] is True
    assert s["timeoutDoesNotFreeDeviceMemory"] is True
    assert s["deviceLossPoisonsOutstandingAllocations"] is True

def test_provider_quotas_are_physical_not_fence_metadata():
    q = load()["quotas"]
    assert q["perTenantDevice"] is True
    assert q["residentBytes"] == "required"
    assert q["pinnedHostBytes"] == "required"
    assert q["outstandingEvents"] == "required"
    assert q["queueSlots"] == "required"
    assert q["checkedSignedI64Arithmetic"] is True
    assert q["reserveBeforeFenceClaim"] is True
    assert q["residentReleaseAfterPhysicalRelease"] is True

def test_fake_success_is_not_gpu_execution_evidence():
    t = load()["testing"]
    assert t["injectableOpenClAbiRequired"] is True
    assert t["realDeviceProbeConditional"] is True
    assert t["mockProviderSuccessIsNotGpuExecutionEvidence"] is True
    assert t["artifactEmissionIsNotGpuExecutionEvidence"] is True
    assert t["realGpuExecutionEvidenceRequiresDeviceEvent"] is True

def test_provider_recovery_and_queue_authority_are_fail_closed():
    c = load()
    p = c["physicalProvider"]
    assert p["queueCapabilityBoundToDeviceAuthority"] is True
    assert p["queueCapabilityGenerationRequired"] is True
    assert p["artifactAbiValidationRequired"] is True
    assert p["providerReleaseRetryable"] is True

    s = c["submissionRules"]
    assert s["preEnqueueCleanupFailureRetainsRecoveryAuthority"] is True
    assert s["preEnqueueCleanupRetryRequired"] is True
    assert s["programReleaseFailureRetainsPreparedAuthority"] is True

    t = c["testing"]
    assert t["preEnqueueReleaseFailureRecoveryRequired"] is True
    assert t["programReleaseRetryRequired"] is True
    assert t["queueAuthorityForgeryRequired"] is True

    promotion = c["promotion"]
    assert promotion["requiresArtifactAbiProviderValidation"] is True
    assert promotion["requiresRecoverablePreEnqueueCleanup"] is True
    assert promotion["requiresOpaqueJavaQueueAuthority"] is True
