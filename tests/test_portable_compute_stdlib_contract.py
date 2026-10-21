import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "portable-compute-stdlib.json"


def load_contract():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_portable_compute_layering_and_authority():
    c = load_contract()
    assert c["version"] == 1
    assert c["namespace"] == "std/compute"
    assert c["layer"] == "std"
    assert c["dependencies"] == ["core"]
    assert "Device" in c["sealedRuntimeHandles"]
    assert "Buffer<T>" in c["sealedRuntimeHandles"]
    assert "Fence" in c["sealedRuntimeHandles"]
    assert "KernelContext" in c["sealedRuntimeHandles"]
    assert "DeviceCapabilities" in c["descriptorTypes"]


def test_portable_compute_is_explicit_and_aot_safe():
    c = load_contract()
    assert c["providerDiscovery"] == "explicit-registration"
    assert c["implicitTransfers"] is False
    assert c["implicitCpuFallback"] is False
    assert c["runtimeReflectionRequired"] is False
    assert c["strictAotRuntimeJit"] is False
    assert c["vendorBackends"] == "optional-userland"


def test_cancellation_never_fakes_device_completion():
    c = load_contract()
    assert c["cancellationImpliesQuiescence"] is False
    assert c["actorIsolationPreserved"] is True


def test_descriptor_integer_domain_and_authority_boundary_are_fail_closed():
    c = load_contract()
    assert c["descriptorIntegerDomain"] == "signed-i64"
    assert c["descriptorValidationScope"] == "portable-structural"
    assert c["providerValidationMayBeStricter"] is True
    assert c["checkedByteArithmeticBeforeAllocationOrTransfer"] is True
