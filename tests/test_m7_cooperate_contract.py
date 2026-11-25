"""Dependency-free contract checks. This is a static ABI shape check, NOT guest runtime evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
class TestM7CooperateAbi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads((ROOT / "contracts/actor-cooperate-safepoint-v1.json").read_text())
        cls.doc = (ROOT / "docs/m7-cooperate-abi-v1.md").read_text()
    def test_bounded_reduction_budget(self):
        p = self.contract["properties"]["budget_reductions"]
        self.assertEqual((p["minimum"], p["maximum"]), (1, 65536))
    def test_generation_and_pc_are_required(self):
        self.assertTrue({"actor_generation", "message_id", "resume_pc", "result", "lifecycle"} <= set(self.contract["required"]))
        self.assertGreaterEqual(self.contract["properties"]["actor_generation"]["minimum"], 1)
    def test_yield_is_suspended_not_settled(self):
        yield_rule = next(rule for rule in self.contract["allOf"] if rule["if"]["properties"]["result"]["const"] == "YIELD")
        self.assertEqual(yield_rule["then"]["properties"]["lifecycle"]["const"], "SUSPENDED")
        self.assertGreaterEqual(yield_rule["then"]["properties"]["charged_reductions"]["minimum"], 1)
    def test_panic_is_priority_control(self):
        panic = next(rule for rule in self.contract["allOf"] if rule["if"]["properties"]["result"]["const"] == "PANIC")
        self.assertEqual(panic["then"]["properties"]["control"]["const"], "PANIC")
    def test_borrow_and_critical_loans_fail_closed(self):
        self.assertEqual(self.contract["properties"]["critical_loan_live"]["const"], False)
        self.assertEqual(self.contract["properties"]["borrow_across_suspend"]["const"], False)
        for key in ("PANIC", "STOP", "YIELD", "LLVM", "Rust/Wasm", "continuation"):
            self.assertIn(key, self.doc)
if __name__ == "__main__":
    unittest.main()
