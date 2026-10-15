"""Reference contract tests for the optional *real frontend* parity runner.

Mocks/stubs here verify harness failure semantics. They are NOT evidence that
either production frontend was executed; that requires the separate CLI.
"""
import copy
import json
from pathlib import Path
import sys
import unittest

from experiments.ir_v1 import IRValidationError
from scripts.experimental_hir_v1_source_parity import compare_hir, run_exact

ROOT = Path(__file__).resolve().parents[1]


class ActualFrontendParityHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hir = json.loads((ROOT / "fixtures/ir-v1/arithmetic.hir.json").read_text())
        cls.blob = json.dumps(cls.hir).encode("utf-8")

    def test_canonical_semantic_equality_independent_of_key_order(self):
        reordered = json.dumps(self.hir, sort_keys=True).encode("utf-8")
        result = compare_hir(self.blob, reordered, entry="main", expected=7)
        self.assertTrue(result["frontends_equal"])
        self.assertFalse(result["executed_backends"])
        self.assertEqual(result["reference_interpreter_result"], 7)

    def test_hir_mismatch_fails_closed(self):
        changed = copy.deepcopy(self.hir)
        f = next(x for x in changed["functions"] if x["name"] == "double")
        f["body"]["rhs"]["value"] = "7"
        with self.assertRaisesRegex(IRValidationError, "differ"):
            compare_hir(self.blob, json.dumps(changed).encode())

    def test_malformed_input_cannot_be_counted_as_parity(self):
        for blob in (b"", b'{"bad":1}', b'{"foo":1,"foo":2}', b'{"ir_family":NaN}'):
            with self.subTest(blob=blob):
                with self.assertRaises(IRValidationError):
                    compare_hir(self.blob, blob)

    def test_reference_expectation_is_an_assertion_not_a_backend_proof(self):
        with self.assertRaisesRegex(IRValidationError, "unexpected"):
            compare_hir(self.blob, self.blob, entry="main", expected=8)

    def test_nonzero_runner_and_missing_binary_fail_closed(self):
        with self.assertRaises(IRValidationError):
            run_exact([sys.executable, "-c", "import sys; sys.exit(5)"], timeout=5)
        with self.assertRaises(IRValidationError):
            run_exact(["/this/compiler/is/not/installed"], timeout=5)

    def test_stdout_must_be_nonempty(self):
        with self.assertRaises(IRValidationError):
            run_exact([sys.executable, "-c", "pass"], timeout=5)


if __name__ == "__main__":
    unittest.main()
