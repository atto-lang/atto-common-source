"""Deterministic 64-bit boundary and differential properties for the verified MIR executor.

This is an independent mathematical oracle, not a proof of Java or LLVM
machine-code conformance. Those backends require separate guest execution.
"""
import copy
import random
import unittest
from pathlib import Path

from experiments.ir_v1 import IRRuntimeError, execute, load_json, lower

SOURCE = (Path(__file__).resolve().parents[1] / "fixtures" / "ir-v1" /
          "arithmetic.hir.json")
LOWER = -(1 << 63)
UPPER = (1 << 63) - 1


class CheckedI64Properties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference_hir = load_json(SOURCE.read_bytes())

    def check_pair(self, a, b, op):
        hir = copy.deepcopy(self.reference_hir)
        function = next(fn for fn in hir["functions"] if fn["name"] == "double")
        function["body"] = {
            "kind": "bin", "op": op,
            "lhs": {"kind": "var", "name": "x"},
            "rhs": {"kind": "int", "value": str(b)},
        }
        mir = lower(hir)
        actual_math = {"add": lambda: a + b,
                       "sub": lambda: a - b,
                       "mul": lambda: a * b}[op]()
        if LOWER <= actual_math <= UPPER:
            self.assertEqual(execute(mir, "double", [a]), actual_math,
                             (a, b, op))
        else:
            with self.assertRaises(IRRuntimeError, msg=str((a, b, op))):
                execute(mir, "double", [a])

    def test_all_boundary_pairs_and_operators(self):
        edges = (LOWER, LOWER + 1, -2, -1, 0, 1, 2, UPPER - 1, UPPER)
        for a in edges:
            for b in edges:
                for op in ("add", "sub", "mul"):
                    with self.subTest(a=a, b=b, op=op):
                        self.check_pair(a, b, op)

    def test_deterministic_random_full_i64_domain(self):
        rng = random.Random(0xC0FFEE64)
        for _ in range(360):
            a = rng.randrange(LOWER, UPPER + 1)
            b = rng.randrange(LOWER, UPPER + 1)
            for op in ("add", "sub", "mul"):
                self.check_pair(a, b, op)


if __name__ == "__main__":
    unittest.main()
