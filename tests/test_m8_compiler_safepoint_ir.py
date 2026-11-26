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
    def test_failed_frame_is_terminal_and_distinct_from_running(self):
        frame = self.ir["frame"]
        self.assertIn("FAILED", frame["status"])
        self.assertIn("RUNNING", frame["status"])
        self.assertNotEqual(frame["status"].index("FAILED"), frame["status"].index("RUNNING"))
        self.assertIn("no result/PC", frame["fault_visibility"])
    def test_fault_codes_and_explicit_safe_cleanup(self):
        codes = self.ir["frame"]["fault_codes"]
        self.assertEqual(codes, {
            "none": 0, "checked_add_overflow": 1, "checked_index_increment_overflow": 2
        })
        obs = self.ir["observable"]
        self.assertIn("before trapping", obs["fault"])
        self.assertIn("explicitly closeable", obs["fault_cleanup"])
        self.assertIn("increases generation", obs["fault_cleanup"])
    def test_panic_export_is_not_supervisor_delivery(self):
        self.assertIs(self.ir["scope"]["supervisor_control_integrated"], False)
    def test_stop_panic_serial_contracts(self):
        obs = self.ir["observable"]
        for key in ("stop","panic","serial","yield","resume"):
            self.assertIn(key,obs)
        self.assertIn("no side-effect replay",obs["resume"])
if __name__ == "__main__": unittest.main()
