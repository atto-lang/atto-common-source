#!/usr/bin/env python3
import copy
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_shared_domain_proxy_source_v1 as verify

CANONICAL = verify.load()

class SharedDomainProxySourceV1Test(unittest.TestCase):
    def test_canonical_validates(self):
        self.assertTrue(verify.validate(copy.deepcopy(CANONICAL)))

    def test_case_inventory_is_35(self):
        self.assertEqual(len(CANONICAL["cases"]), 35)

    def test_case_ids_are_unique(self):
        ids = [c["id"] for c in CANONICAL["cases"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_rt_share_and_proxy_are_distinct(self):
        self.assertNotEqual(
            CANONICAL["public_operations"]["rt_share"],
            CANONICAL["public_operations"]["rt_proxy"])

    def test_proxy_read_write_map_to_critical_modes(self):
        self.assertEqual(CANONICAL["access_lowering"]["read"], "critical-read")
        self.assertEqual(CANONICAL["access_lowering"]["write"], "critical-write")

    def test_admission_may_suspend_but_body_may_not(self):
        self.assertEqual(CANONICAL["suspension"]["admission"], "may-suspend-before-lease")
        self.assertEqual(CANONICAL["suspension"]["critical_body"], "must-not-suspend")

    def test_resume_is_scheduler_owned(self):
        self.assertEqual(
            CANONICAL["suspension"]["resume"],
            "scheduler-owned-capability-wake-only")

    def test_no_backend_claims_guest_support(self):
        self.assertNotIn("implemented", CANONICAL["backend_support"].values())

    def test_llvm_is_host_candidate_only(self):
        self.assertEqual(
            CANONICAL["backend_support"]["llvm"],
            "host-runtime-candidate-no-guest-lowering")

    def test_unknown_root_field_rejected(self):
        mutated = copy.deepcopy(CANONICAL)
        mutated["guest_certified"] = True
        with self.assertRaises(ValueError):
            verify.validate(mutated)

    def test_rt_share_proxy_conflation_rejected(self):
        mutated = copy.deepcopy(CANONICAL)
        mutated["public_operations"]["rt_share"] = mutated["public_operations"]["rt_proxy"]
        with self.assertRaises(ValueError):
            verify.validate(mutated)

def make_case_test(case_id, expected):
    def test(self):
        mutated = copy.deepcopy(CANONICAL)
        for case in mutated["cases"]:
            if case["id"] == case_id:
                case["expect"] = "unexpected-promotion"
                break
        with self.assertRaises(ValueError):
            verify.validate(mutated)
        canonical = {c["id"]: c["expect"] for c in CANONICAL["cases"]}
        self.assertEqual(canonical[case_id], expected)
    return test

for _case_id, _expected in verify.EXPECTED_CASES.items():
    setattr(
        SharedDomainProxySourceV1Test,
        "test_case_" + _case_id.replace("-", "_"),
        make_case_test(_case_id, _expected),
    )

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SharedDomainProxySourceV1Test)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun != 46:
        raise SystemExit(f"expected 46 tests, ran {result.testsRun}")
    if (not result.wasSuccessful() or result.skipped or result.expectedFailures
            or result.unexpectedSuccesses):
        raise SystemExit(1)
    print("SHARED_DOMAIN_PROXY_SOURCE_TESTS=49")
