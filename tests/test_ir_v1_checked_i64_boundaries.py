"""Checked signed-i64 boundary and intermediate-overflow regression oracle.

Exercises the independently verified HIR->MIR interpreter. These are finite
properties, not a proof about production Java/LLVM code generators.
"""
from __future__ import annotations

import copy
import random
import unittest
from pathlib import Path

from experiments.ir_v1 import IRRuntimeError, execute, load_json, lower

MIN = -(1 << 63)
MAX = (1 << 63) - 1
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/ir-v1/arithmetic.hir.json"


def literal(value):
    return {"kind": "int", "value": str(value)}


def variable():
    return {"kind": "var", "name": "x"}


def operation(op, lhs, rhs):
    return {"kind": "bin", "op": op, "lhs": lhs, "rhs": rhs}


class CheckedI64BoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = load_json(FIXTURE.read_bytes())

    def evaluate(self, expression, argument):
        hir = copy.deepcopy(self.base)
        fn = next(fn for fn in hir["functions"] if fn["name"] == "double")
        fn["body"] = expression
        mir = lower(hir)
        return execute(mir, "double", [argument])

    def test_exhaustive_adversarial_boundary_matrix(self):
        edges = (MIN, MIN + 1, -43, -2, -1, 0, 1, 2, 43, MAX - 1, MAX)
        for op in ("add", "sub", "mul"):
            for value in edges:
                for constant in edges:
                    with self.subTest(op=op, value=value, constant=constant):
                        result = {"add": lambda: value + constant,
                                  "sub": lambda: value - constant,
                                  "mul": lambda: value * constant}[op]()
                        expr = operation(op, variable(), literal(constant))
                        if MIN <= result <= MAX:
                            self.assertEqual(result, self.evaluate(expr, value))
                        else:
                            with self.assertRaisesRegex(
                                    IRRuntimeError, "overflow"):
                                self.evaluate(expr, value)

    def test_seeded_full_width_i64_arithmetic_oracle(self):
        rng = random.Random(20261014)
        for i in range(400):
            left = rng.getrandbits(64) - (1 << 63)
            right = rng.getrandbits(64) - (1 << 63)
            op = ("add", "sub", "mul")[i % 3]
            expected = {"add": lambda: left + right,
                        "sub": lambda: left - right,
                        "mul": lambda: left * right}[op]()
            expr = operation(op, variable(), literal(right))
            with self.subTest(index=i, op=op):
                if MIN <= expected <= MAX:
                    self.assertEqual(expected, self.evaluate(expr, left))
                else:
                    with self.assertRaisesRegex(IRRuntimeError, "overflow"):
                        self.evaluate(expr, left)

    def test_overflow_is_not_erased_by_a_later_operation(self):
        expressions = (
            operation("mul", operation("add", literal(MAX), literal(1)), literal(0)),
            operation("sub", operation("mul", literal(MAX), literal(2)),
                      operation("mul", literal(MAX), literal(2))),
            operation("mul", literal(MIN), literal(-1)),
            operation("sub", literal(MIN), literal(1)),
        )
        for expr in expressions:
            with self.subTest(expr=expr):
                with self.assertRaisesRegex(IRRuntimeError, "overflow"):
                    self.evaluate(expr, 0)

    def test_zero_multiplier_and_bounded_endpoints_succeed(self):
        cases = (
            (operation("mul", variable(), literal(0)), MAX, 0),
            (operation("mul", variable(), literal(0)), MIN, 0),
            (operation("mul", variable(), literal(1)), MIN, MIN),
            (operation("add", variable(), literal(0)), MAX, MAX),
            (operation("sub", variable(), literal(0)), MIN, MIN),
        )
        for expr, input_value, expected in cases:
            with self.subTest(input_value=input_value, expr=expr):
                self.assertEqual(self.evaluate(expr, input_value), expected)


if __name__ == "__main__":
    unittest.main()
