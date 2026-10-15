"""Overflow identity regressions against the verified MIR interpreter.

Backend execution is tested separately; these tests ensure the shared oracle
classifies arithmetic failures with the exact public code instead of a
backend-specific prose exception.
"""
import copy
from pathlib import Path
import unittest

from experiments.ir_v1 import IRRuntimeError, execute, load_json, lower

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/ir-v1/arithmetic.hir.json"
MIN_I64 = -(1 << 63)
MAX_I64 = (1 << 63) - 1


class CheckedOverflowIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = load_json(FIXTURE.read_bytes())

    def with_double_expression(self, expression):
        hir = copy.deepcopy(self.fixture)
        function = next(f for f in hir["functions"] if f["name"] == "double")
        function["body"] = expression
        return lower(hir)

    @staticmethod
    def expr(op, rhs):
        return {
            "kind": "bin", "op": op,
            "lhs": {"kind": "var", "name": "x"},
            "rhs": {"kind": "int", "value": str(rhs)},
        }

    def test_boundary_overflows_have_stable_error_code(self):
        cases = (
            ("add", MAX_I64, 1),
            ("sub", MIN_I64, 1),
            ("mul", MAX_I64, 2),
            ("mul", MIN_I64, -1),
        )
        for op, operand, rhs in cases:
            with self.subTest(op=op, operand=operand, rhs=rhs):
                mir = self.with_double_expression(self.expr(op, rhs))
                with self.assertRaisesRegex(IRRuntimeError, r"^ORES_I64_OVERFLOW:"):
                    execute(mir, "double", [operand])

    def test_intermediate_overflow_is_not_elided_by_multiply_zero(self):
        expression = {
            "kind": "bin", "op": "mul",
            "lhs": {
                "kind": "bin", "op": "add",
                "lhs": {"kind": "int", "value": str(MAX_I64)},
                "rhs": {"kind": "int", "value": "1"},
            },
            "rhs": {"kind": "int", "value": "0"},
        }
        with self.assertRaisesRegex(IRRuntimeError, r"^ORES_I64_OVERFLOW:"):
            execute(self.with_double_expression(expression), "double", [1])

    def test_overflow_identity_survives_a_direct_call(self):
        mir = self.with_double_expression(self.expr("mul", 2))
        # choose(x) calls double(x) on the nonnegative path.
        with self.assertRaisesRegex(IRRuntimeError, r"^ORES_I64_OVERFLOW:"):
            execute(mir, "choose", [MAX_I64])

    def test_successful_boundary_results_are_unchanged(self):
        mir = self.with_double_expression(self.expr("mul", 0))
        self.assertEqual(execute(mir, "double", [MAX_I64]), 0)
        self.assertEqual(execute(mir, "double", [MIN_I64]), 0)


if __name__ == "__main__":
    unittest.main()
