import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "portable-compute-authority.json"

def load():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))

def test_handles_are_sealed_and_not_source_constructible():
    c = load()
    assert c["gate"] == "G1"
    assert c["sourceConstructibleHandles"] is False
    assert all(c["handles"][name]["sealed"] for name in ("Device","Buffer<T>","Fence","KernelContext"))

def test_transfers_fail_closed():
    t = load()["transfers"]
    assert t["operations"] == ["upload", "download"]
    assert t["explicitOnly"] is True
    assert t["implicitTransfer"] is False
    assert t["implicitCpuFallback"] is False
    assert t["crossDeviceForbidden"] is True
    assert t["crossOwnerDomainForbidden"] is True
    assert t["staleGenerationForbidden"] is True
    assert t["cancellationImpliesQuiescence"] is False
    assert t["reclaimRequiresVerifiedQuiescence"] is True
    assert t["preEnqueueAbortRequiresExactFence"] is True
    assert t["preEnqueueAbortRestoresIdle"] is True
    assert t["preEnqueueAbortForbiddenAfterSubmission"] is True

def test_numeric_metadata_never_recreates_authority():
    a = load()["authorityRules"]
    assert a["numericIdsAreNotCapabilities"] is True
    assert a["metadataDescriptorsAreNotCapabilities"] is True
    assert a["runtimeHandleAliasingMustNotDuplicateInFlightAuthority"] is True
