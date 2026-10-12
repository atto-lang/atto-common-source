"""Static and synthetic negative tests; these are not real guest executions."""
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from dispatch_return_gate import DispatchParityError, oracle, compare, blob_sha

MANIFEST = ROOT / "fixtures" / "dispatch-return-forms.v1.json"


def test_record(backend, common):
    return {
        "backend": backend,
        "source_tree": "1" * 40,
        "compiler_sha": "2" * 40,
        "run_id": 1234,
        "job_id": 3456,
        "runner_id": 5678,
        "executed_tests": len(common),
        "skipped_tests": 0,
        "failed_tests": 0,
        "errored_tests": 0,
        "conclusion": "success",
        "observed": {
            c["id"]: {
                "result": c["expected_result"],
                "source_blob": blob_sha(c["source"]),
                "return_trace": (
                    ["ARM_RESULT", "FUNCTION_RETURN"]
                    if c["return_destination"] == "ARM_RESULT" else ["FUNCTION_RETURN"]
                ),
            } for c in common
        },
    }


class FourFormsDispatchContractTest(unittest.TestCase):
    def setUp(self):
        self.manifest = oracle(MANIFEST)
        common = [c for c in self.manifest["cases"]
                  if c["support"]["graal"] == c["support"]["llvm"] == "candidate"]
        self.graal = test_record("graal", common)
        self.llvm = test_record("llvm", common)

    def assert_rejected(self, mutate, backend="llvm"):
        l, r = copy.deepcopy(self.graal), copy.deepcopy(self.llvm)
        mutate(r if backend == "llvm" else l)
        with self.assertRaises(DispatchParityError):
            compare(l, r, self.manifest)

    def test_all_four_forms_have_distinct_required_destinations(self):
        self.assertEqual(
            {"match": "ARM_RESULT", "do match": "FUNCTION_RETURN",
             "switch": "ARM_RESULT", "do switch": "FUNCTION_RETURN"},
            {c["form"]: c["return_destination"] for c in self.manifest["cases"]}
        )

    def test_rejects_premature_full_parity_claim(self):
        with self.assertRaisesRegex(DispatchParityError, "not supported"):
            compare(self.graal, self.llvm, self.manifest, require_full=True)

    def test_synthetic_selftest_records_only(self):
        self.assertEqual(3, compare(self.graal, self.llvm, self.manifest))

    def test_result_value_cannot_mask_wrong_return_destination(self):
        self.assert_rejected(lambda r: r["observed"]["value-match-arm-result"]
                             .update(return_trace=["FUNCTION_RETURN"]))

    def test_do_arm_cannot_return_only_from_arm(self):
        self.assert_rejected(lambda r: r["observed"]["do-match-function-return"]
                             .update(return_trace=["ARM_RESULT", "FUNCTION_RETURN"]))

    def test_wrong_value(self):
        self.assert_rejected(lambda r: r["observed"]["value-match-arm-result"]
                             .update(result=42))

    def test_fabricated_runner(self):
        self.assert_rejected(lambda r: r.update(runner_id=0))

    def test_boolean_runner_id_is_not_evidence(self):
        self.assert_rejected(lambda r: r.update(runner_id=True))

    def test_missing_compiler_identity(self):
        self.assert_rejected(lambda r: r.pop("compiler_sha"))

    def test_missing_executed_fixture(self):
        self.assert_rejected(lambda r: r["observed"].pop("do-switch-function-return"))

    def test_wrong_fixture_blob(self):
        self.assert_rejected(lambda r: r["observed"]["value-match-arm-result"]
                             .update(source_blob="0" * 40))

    def test_skipped_is_not_green(self):
        self.assert_rejected(lambda r: r.update(skipped_tests=1))


if __name__ == "__main__":
    unittest.main()
