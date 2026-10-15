"""Boundary regression tests for verified checked-i64 HIR and MIR."""
import unittest
from experiments.ir_v1 import IRRuntimeError, execute, lower, validate_hir

MIN = -(2**63)
MAX = 2**63 - 1
FEATURES = ["bool.v1", "checked-i64.v1", "control-flow.v1", "functions.v1"]

def hir(op):
    return {
        "ir_family": "ores-hir", "schema_version": "1.0.0-experimental",
        "module_id": "checked_boundaries", "required_features": FEATURES,
        "functions": [{
            "name": "calc",
            "params": [{"name": "x", "type": "i64"}, {"name": "y", "type": "i64"}],
            "result_type": "i64",
            "body": {"kind": "bin", "op": op,
                     "lhs": {"kind": "var", "name": "x"},
                     "rhs": {"kind": "var", "name": "y"}}
        }]
    }

class CheckedBoundaryTests(unittest.TestCase):
    def test_extremal_arithmetic(self):
        boundaries = (MIN, MIN + 1, -43, -2, -1, 0, 1, 2, 43, MAX - 1, MAX)
        for op in ("add", "sub", "mul"):
            mir = lower(validate_hir(hir(op)))
            for a in boundaries:
                for b in boundaries:
                    result = {"add": lambda: a + b,
                              "sub": lambda: a - b,
                              "mul": lambda: a * b}[op]()
                    with self.subTest(op=op, a=a, b=b):
                        if MIN <= result <= MAX:
                            self.assertEqual(result, execute(mir, "calc", [a, b]))
                        else:
                            with self.assertRaises(IRRuntimeError):
                                execute(mir, "calc", [a, b])

if __name__ == "__main__":
    unittest.main()
