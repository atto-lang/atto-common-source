#!/usr/bin/env python3
"""Static capability-contract checks. NOT executable Oreslang compiler evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "contracts/v1/thread-task-borrow-capabilities.v1.json"
DOC = ROOT / "docs/THREAD_TASK_BORROW_CAPABILITIES_V1.md"

class CapabilityContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(DATA.read_text(encoding="utf-8"))
        cls.doc = DOC.read_text(encoding="utf-8")

    def test_contract_does_not_advertise_guest_support(self):
        c = self.contract
        self.assertEqual(c["schema_version"], 1)
        self.assertEqual(c["status"], "contract-only")
        self.assertIs(c["is_guest_implementation"], False)
        self.assertEqual(c["backend_readiness"], {"java": "pending", "llvm": "pending"})
        self.assertIn("does not invoke source compilers", c["validation"])
        self.assertIn("NOT current executable syntax", self.doc)

    def test_access_exclusion_matrix_is_symmetric(self):
        modes = {"READ", "WRITE"}
        c = self.contract
        self.assertEqual(set(c["access_modes"]), modes)
        matrix = c["compatibility"]
        self.assertEqual(set(matrix), modes)
        for a in modes:
            self.assertEqual(set(matrix[a]), modes)
            for b in modes:
                self.assertIs(type(matrix[a][b]), bool)
                self.assertEqual(matrix[a][b], matrix[b][a])
        self.assertIs(matrix["READ"]["READ"], True)
        self.assertIs(matrix["READ"]["WRITE"], False)
        self.assertIs(matrix["WRITE"]["WRITE"], False)

    def test_scenario_taxonomy_has_no_false_passes(self):
        cases = self.contract["cases"]
        names = [item["id"] for item in cases]
        self.assertEqual(len(names), 19)
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue({"accept", "reject"} <= {c["expected"] for c in cases})
        for c in cases:
            self.assertEqual(set(c), {"id", "expected", "kind", "reason", "java", "llvm"})
            self.assertTrue(c["id"] and c["reason"] and c["kind"])
            self.assertIn(c["expected"], {"accept", "reject"})
            self.assertEqual(c["java"], "pending")
            self.assertEqual(c["llvm"], "pending")

    def test_all_critical_negative_edges_exist(self):
        negatives = {c["id"] for c in self.contract["cases"] if c["expected"] == "reject"}
        required = {
            "overlapping-writers", "reader-overlaps-writer", "copy-exclusive-token",
            "detached-task-borrow-escape", "cancel-token-is-not-quiescence",
            "unknown-ffi-alias", "ecs-layout-generation-invalidated",
            "cross-actor-private-loan", "await-with-unproven-borrow",
        }
        self.assertTrue(required <= negatives)
        for phrase in ["physical carrier thread", "ThreadToken", "TaskScope",
                       "freestanding", "structural", "quiescen", "CodeVersionLease", "JIT eviction"]:
            self.assertIn(phrase.lower(), self.doc.lower())

if __name__ == "__main__":
    unittest.main()
