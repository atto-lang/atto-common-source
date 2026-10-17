#!/usr/bin/env python3
import json
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "v1" / "shared_domain_proxy_source_v1.json"

EXPECTED_PUBLIC = {
    "rt_share": "approved-shared-ownership-not-mutable-proxy",
    "rt_proxy": "consume-owner-to-synchronized-proxy",
}
EXPECTED_ACCESS = {
    "read": "critical-read",
    "write": "critical-write",
    "readonly_method": "critical-read",
    "unknown_or_mutating_method": "critical-write",
}
EXPECTED_SUSPENSION = {
    "admission": "may-suspend-before-lease",
    "critical_body": "must-not-suspend",
    "resume": "scheduler-owned-capability-wake-only",
}
EXPECTED_BACKENDS = {
    "java": "historical-draft-reconcile-required",
    "llvm": "host-runtime-candidate-no-guest-lowering",
    "net": "unsupported",
    "wasm": "unsupported",
    "forge": "unsupported",
}
EXPECTED_CASES = {
    "proxy-consumes-owner": "required",
    "share-is-not-mutable-proxy": "required",
    "actor-ref-not-memory-capability": "deny",
    "domain-id-unnameable": "required",
    "proxy-capability-unforgeable": "required",
    "proxy-read-lowers-critical-read": "required",
    "proxy-write-lowers-critical-write": "required",
    "readonly-method-may-read-lease": "required",
    "unknown-method-conservative-write": "required",
    "admission-may-suspend-before-lease": "required",
    "critical-body-await-denied": "deny",
    "critical-body-select-denied": "deny",
    "critical-body-blocking-suspend-denied": "deny",
    "critical-body-cooperate-denied": "deny",
    "critical-body-yield-denied": "deny",
    "guest-callback-under-lease-denied": "deny",
    "raw-mutable-child-escape-denied": "deny",
    "pointer-child-escape-denied": "deny",
    "borrow-child-escape-denied": "deny",
    "capability-child-escape-denied": "deny",
    "same-domain-child-rewrapped-proxy": "required",
    "cross-domain-nested-proxy-denied": "deny",
    "read-to-write-upgrade-denied": "deny",
    "queued-cancellation-removes-waiter": "required",
    "writer-barrier-prevents-reader-barging": "required",
    "scheduler-derives-current-principal": "required",
    "wake-bound-to-owner-and-ticket": "required",
    "data-turn-cannot-spoof-wake": "deny",
    "physical-release-before-logical-handoff": "required",
    "lifetime-pin-separate-from-byte-authority": "required",
    "retirement-seals-new-proxy-authority": "required",
    "proxy-serialization-denied": "deny",
    "private-untrusted-proxy-transport-denied": "deny",
    "stale-proxy-generation-denied": "deny-stale",
    "rt-share-no-unchecked-proxy-conversion": "deny",
}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def load(path=CONTRACT_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def validate(doc):
    require(type(doc) is dict, "contract root must be object")
    require(set(doc) == {
        "contract", "version", "status", "public_operations", "access_lowering",
        "suspension", "backend_support", "cases"
    }, "root fields differ")
    require(doc["contract"] == "oreslang-shared-domain-proxy-source-v1", "contract name differs")
    require(doc["version"] == 1, "version differs")
    require(doc["status"] == "source-contract-only", "status must remain non-certifying")
    require(doc["public_operations"] == EXPECTED_PUBLIC, "public operation semantics differ")
    require(doc["access_lowering"] == EXPECTED_ACCESS, "critical lowering semantics differ")
    require(doc["suspension"] == EXPECTED_SUSPENSION, "suspension boundary differs")
    require(doc["backend_support"] == EXPECTED_BACKENDS, "backend honesty matrix differs")

    cases = doc["cases"]
    require(type(cases) is list and len(cases) == len(EXPECTED_CASES), "case inventory differs")
    observed = {}
    for case in cases:
        require(type(case) is dict and set(case) == {"id", "expect"}, "case fields differ")
        cid = case["id"]
        require(type(cid) is str and cid and cid not in observed, "case id invalid/duplicate")
        observed[cid] = case["expect"]
    require(observed == EXPECTED_CASES, "case expectations differ")
    return True

def main():
    validate(load())
    print(f"shared-domain proxy source v1 valid: {len(EXPECTED_CASES)} cases")

if __name__ == "__main__":
    main()
