"""Checked arithmetic occurs on executed paths and crosses direct calls."""
import unittest
from experiments.ir_v1 import IRRuntimeError, execute, lower, validate_hir

FEATURES = ["bool.v1", "checked-i64.v1", "control-flow.v1", "functions.v1"]
MAX = 2**63 - 1

def number(n):
    return {"kind": "int", "value": str(n)}

def variable(n):
    return {"kind": "var", "name": n}

def op(kind, a, b):
    return {"kind": "bin", "op": kind, "lhs": a, "rhs": b}

def fun(name, params, body):
    return {"name": name,
            "params": [{"name": n, "type": "i64"} for n in params],
            "result_type": "i64", "body": body}

def verified(*funcs):
    h = {"ir_family": "ores-hir", "schema_version": "1.0.0-experimental",
         "module_id": "checked_paths", "required_features": FEATURES,
         "functions": sorted(funcs, key=lambda fn: fn["name"])}
    return lower(validate_hir(h))

class CheckedControlFlowTests(unittest.TestCase):
    def test_checked_multiply_cross_function_call(self):
        callee = fun("scale", ["count"], op("mul", variable("count"), number(43)))
        main = fun("main", ["x"], {"kind": "call", "function": "scale",
                                   "args": [variable("x")]})
        mir = verified(main, callee)
        self.assertEqual(43, execute(mir, "main", [1]))
        self.assertEqual(0, execute(mir, "main", [0]))
        with self.assertRaises(IRRuntimeError):
            execute(mir, "main", [MAX])

    def test_unreachable_overflow_must_not_execute(self):
        body = {"kind": "if",
                "condition": op("lt", variable("x"), number(0)),
                "then": number(43),
                "else": op("add", number(MAX), number(1))}
        mir = verified(fun("main", ["x"], body))
        self.assertEqual(43, execute(mir, "main", [-1]))
        with self.assertRaises(IRRuntimeError):
            execute(mir, "main", [0])

if __name__ == "__main__":
    unittest.main()
