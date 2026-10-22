import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "portable-compute-kernel.json"

def load():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))

def test_g2_source_syntax_remains_fail_closed():
    c = load()
    assert c["gate"] == "G2"
    assert c["sourceNeutralKernelIR"] is True
    assert c["sourceSyntaxEnabled"] is False
    assert c["sourceSyntaxGate"] == "fail-closed-until-typed-effects-and-lowering"

def test_kernel_effects_are_closed_and_numeric():
    rules = load()["kernelRules"]
    assert rules["finiteCoefficientsRequired"] is True
    assert rules["pureNumericOnly"] is True
    for key in (
        "hostIo", "allocation", "locks", "actorState", "mailboxEffects",
        "exceptions", "panicUnwind", "deviceSideLaunch", "reflection",
    ):
        assert rules[key] == "forbidden"

def test_cpu_reference_is_not_implicit_gpu_fallback():
    cpu = load()["cpuReferenceProvider"]
    assert cpu["explicitSelectionRequired"] is True
    assert cpu["implicitGpuFallback"] is False
    assert cpu["testingAndConformanceOnly"] is True
    assert cpu["hardRealtimeClaim"] is False
    assert cpu["inputOutputAlias"] == "forbidden"
    assert cpu["floatingPointContraction"] == "forbidden-for-scale-bias-reference"
    assert cpu["wholeKernelHostBufferLeaseRequired"] is True
    assert cpu["concurrentHostMutation"] == "serialized-during-execution"

def test_gpu_emission_is_not_execution_evidence():
    gpu = load()["gpuLowering"]
    assert gpu["firstPortableArtifact"] == "opencl-c-1.2"
    assert gpu["emissionIsExecutionEvidence"] is False
    assert gpu["providerAuthenticationRequired"] is True
    assert gpu["physicalBufferProvenanceRequired"] is True
    assert gpu["deviceEventEvidenceRequired"] is True
    assert gpu["javaEmitterImplemented"] is True
    assert gpu["nativeEmitterImplemented"] is True
    assert gpu["exactArtifactParityRequired"] is True
    abi = gpu["artifactAbi"]
    assert abi["version"] == 1
    assert abi["requiredAddressBits"] == 64
    assert abi["requiredFloat32"] is True
    assert abi["requiredLittleEndian"] is True
    assert set(abi["providerMustValidate"]) == {
        "requiredBytes", "globalRows", "globalFields",
        "requiredAddressBits", "requiredFloat32", "requiredLittleEndian",
    }
    assert load()["promotion"]["requiresJavaNativeOpenClArtifactParity"] is True
