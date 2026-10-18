"""Contract-only integrity tests. They DO NOT prove actual runtime quota enforcement."""
import copy
import json
from pathlib import Path
import unittest

CONTRACT = Path(__file__).resolve().parents[1] / "contracts/untrusted-supervisor-outbound-quota.v1.json"
REQUIRED = {
    "burst-capacity", "sustained-refill", "atomic-hierarchy", "failed-enqueue",
    "bytes-and-credits", "clock-rollback", "restart-fanout", "forged-source",
    "alternate-transport", "runtime-panic", "forged-panic", "retire-race",
}
EXPECTATIONS = {
    "burst-capacity": "rate-limited",
    "sustained-refill": "bounded-refill",
    "atomic-hierarchy": "reject-without-partial-charge",
    "failed-enqueue": "refund-all-scopes",
    "bytes-and-credits": "reject-without-allocation",
    "clock-rollback": "no-refill",
    "restart-fanout": "stable-lineage-quota",
    "forged-source": "capability-denied",
    "alternate-transport": "same-quota-gate",
    "runtime-panic": "bounded-control-delivery",
    "forged-panic": "capability-denied",
    "retire-race": "fail-closed-and-once-only-settlement",
}
BACKENDS = {"java-graalvm", "llvm", "wasm", "forge", ".net"}

def no_duplicate_keys(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError("duplicate JSON key: " + k)
        result[k] = v
    return result

def validate(doc):
    assert type(doc) is dict
    assert set(doc) == {"schema_version", "status", "pending_backends", "cases"}
    assert doc["schema_version"] == "untrusted-supervisor-outbound-quota.v1-proposal"
    assert doc["status"] == "contract-only-no-runtime-enforcement-claim"
    assert type(doc["pending_backends"]) is list
    assert len(doc["pending_backends"]) == len(BACKENDS)
    assert set(doc["pending_backends"]) == BACKENDS
    assert len(set(doc["pending_backends"])) == len(BACKENDS)
    cases = doc["cases"]
    assert type(cases) is list and len(cases) == len(REQUIRED)
    seen = set()
    for case in cases:
        assert type(case) is dict and set(case) == {"id", "scenario", "expect"}
        cid = case["id"]
        assert type(cid) is str and cid in REQUIRED and cid not in seen
        seen.add(cid)
        assert type(case["scenario"]) is str and len(case["scenario"].strip()) > 20
        assert case["expect"] == EXPECTATIONS[cid]
        assert "verified" not in case
    assert seen == REQUIRED

class SupervisorOutboundQuotaContractTest(unittest.TestCase):
    def test_pinned_contract(self):
        validate(json.loads(CONTRACT.read_text(), object_pairs_hook=no_duplicate_keys))

    def test_reject_mutations(self):
        original = json.loads(CONTRACT.read_text(), object_pairs_hook=no_duplicate_keys)
        mutants = []
        d = copy.deepcopy(original)
        d["cases"].pop()
        mutants.append(d)
        d = copy.deepcopy(original)
        d["cases"][1]["id"] = d["cases"][0]["id"]
        mutants.append(d)
        d = copy.deepcopy(original)
        d["cases"][0]["expect"] = "allow"
        mutants.append(d)
        d = copy.deepcopy(original)
        d["pending_backends"].remove("llvm")
        mutants.append(d)
        d = copy.deepcopy(original)
        d["status"] = "verified"
        mutants.append(d)
        d = copy.deepcopy(original)
        d["cases"][0]["verified"] = True
        mutants.append(d)
        for mutant in mutants:
            with self.subTest(mutant=mutant):
                with self.assertRaises(AssertionError):
                    validate(mutant)

    def test_duplicate_json_key_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            json.loads('{"a":1,"a":2}', object_pairs_hook=no_duplicate_keys)

if __name__ == "__main__":
    unittest.main()
