"""Static M8 IR topology and safe-point fail-closed contract tests (not runtime evidence)."""
import json
import pathlib
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
class M8IRContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ir = json.loads((ROOT / "contracts/m8-compiler-safepoint-ir-v1.json").read_text())
    def test_stable_safe_point_pc(self):
        steps = self.ir["instructions"]
        self.assertEqual([step["pc"] for step in steps], [0,1,2,3,4])
        self.assertEqual(steps[3]["op"], "COOPERATE")
        self.assertEqual(steps[3]["resume_pc"], 1)
    def test_budget_is_bounded(self):
        self.assertEqual(self.ir["reduction_budget"], {"min": 1, "max": 65536})
        self.assertLessEqual(len(self.ir["instructions"]), self.ir["instruction_limit"])
    def test_borrows_and_critical_loans_fail_closed(self):
        frame = self.ir["frame"]
        self.assertIs(frame["borrow_across_suspend"], False)
        self.assertIs(frame["critical_loan_across_suspend"], False)
    def test_epoch_and_explicit_nonclaims(self):
        self.assertIn("increasing", self.ir["frame"]["generation"])
        for flag in ("full_language", "await_select", "production_borrow_checker", "hard_real_time"):
            self.assertIs(self.ir["scope"][flag], False)
    def test_stop_panic_serial_contracts(self):
        obs = self.ir["observable"]
        for key in ("stop","panic","serial","yield","resume"):
            self.assertIn(key,obs)
        self.assertIn("no side-effect replay",obs["resume"])
if __name__ == "__main__": unittest.main()
