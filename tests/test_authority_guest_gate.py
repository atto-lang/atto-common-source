"""Source-free metadata tests only. Synthetic reports are NOT execution evidence."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from authority_guest_gate import GateError, git_blob_sha, verify_manifest, verify_admission_report


class AuthorityGuestGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = verify_manifest()

    def dummy_report(self):
        return {
            "schema": "oreslang.authority-guest-admission-report.v1",
            "backend": "java",
            "compiler_sha": "a" * 40,
            "status": "executed",
            "workflow": {"run_id": 101, "step_count": 4},
            "cases": [{
                "id": c["id"], "source_blob_sha": c["source_blob_sha"],
                "result": c["expected"], "stage": c["stage"],
                "command": "synthetic test-only command",
                "tool_exit": 0 if c["expected"] == "accept" else 1,
                "diagnostic": None if c["expected"] == "accept" else "synthetic expected denial",
            } for c in self.cases.values()],
        }

    def test_manifest_has_exact_source_sha_and_multiple_security_boundaries(self):
        self.assertEqual(len(self.cases), 14)
        self.assertEqual({"types", "ownership", "effects", "capability"},
                         {c["boundary"] for c in self.cases.values()})

    def test_git_blob_sha_matches_known_vector(self):
        self.assertEqual(git_blob_sha(b"hello\n"),
                         "ce013625030ba8dba906f756967f9e9ca394464a")

    def test_valid_synthetic_report_checks_shape_only(self):
        self.assertEqual(verify_admission_report(self.dummy_report()), 14)

    def test_zero_step_or_missing_workflow_does_not_pass(self):
        for step_count in (0, -1, True, None):
            r = self.dummy_report()
            r["workflow"]["step_count"] = step_count
            with self.subTest(step_count=step_count), self.assertRaises(GateError):
                verify_admission_report(r)

    def test_stale_or_duplicated_or_missing_source_rejected(self):
        mutators = [
            lambda r: r["cases"][0].update(source_blob_sha="b" * 40),
            lambda r: r["cases"].pop(),
            lambda r: r["cases"][0].update(id=r["cases"][1]["id"]),
        ]
        for mutate in mutators:
            r = self.dummy_report()
            mutate(r)
            with self.assertRaises(GateError):
                verify_admission_report(r)

    def test_wrong_stage_missing_diagnostic_and_nontyped_exit_rejected(self):
        for change in (
            {"stage": "parser"}, {"tool_exit": True},
            {"result": "reject"}, {"command": ""}
        ):
            r = self.dummy_report()
            r["cases"][0].update(change)
            with self.assertRaises(GateError):
                verify_admission_report(r)
        r = self.dummy_report()
        rejected = next(c for c in r["cases"] if c["result"] == "reject")
        rejected["diagnostic"] = ""
        with self.assertRaises(GateError):
            verify_admission_report(r)

    def test_noncompiler_exit_codes_cannot_count_as_rejection(self):
        for code in (2, 124, 126, 127, -9):
            report = self.dummy_report()
            rejected = next(c for c in report["cases"] if c["result"] == "reject")
            rejected["tool_exit"] = code
            with self.subTest(exit_code=code), self.assertRaises(GateError):
                verify_admission_report(report)

    def test_infrastructure_messages_are_not_semantic_denials(self):
        diagnostics = (
            "Traceback (most recent call last): test exception",
            "FileNotFoundError: missing compiler",
            "command not found",
            "No such file or directory",
            "compiler unavailable",
            "process timed out",
        )
        for diagnostic in diagnostics:
            report = self.dummy_report()
            rejected = next(c for c in report["cases"] if c["result"] == "reject")
            rejected["diagnostic"] = diagnostic
            with self.subTest(diagnostic=diagnostic), self.assertRaises(GateError):
                verify_admission_report(report)

    def test_unverified_status_rejected(self):
        for status in ("skipped", "pending", "failed", None):
            r = self.dummy_report()
            r["status"] = status
            with self.assertRaises(GateError):
                verify_admission_report(r)


if __name__ == "__main__":
    unittest.main()
