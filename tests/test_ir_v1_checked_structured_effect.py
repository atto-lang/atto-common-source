"""Structured checked-i64 reference effects, independent of backend execution.

These tests exercise verified MIR execution and operation identity, not a
source-constructed guest Error or production exception ABI.
"""
import unittest

from experiments.ir_v1 import CheckedI64Overflow, IRRuntimeError, execute, lower

FEATURES = ["bool.v1", "checked-i64.v1", "control-flow.v1", "functions.v1"]
MIN = -(1 << 63)
MAX = (1 << 63) - 1


def num(n):
    return {"kind": "int", "value": str(n)}


def var(name):
    return {"kind": "var", "name": name}


def binop(op, lhs, rhs):
    return {"kind": "bin", "op": op, "lhs": lhs, "rhs": rhs}


def call(name, *args):
    return {"kind": "call", "function": name, "args": list(args)}


def function(name, body, *params):
    return {"name": name, "params": [
        {"name": p, "type": "i64"} for p in params
    ], "result_type": "i64", "body": body}


def mir(*functions):
    return lower({
        "ir_family": "ores-hir",
        "schema_version": "1.0.0-experimental",
        "module_id": "effect_identity",
        "required_features": FEATURES,
        "functions": sorted(functions, key=lambda f: f["name"]),
    })


class CheckedI64StructuredEffectTests(unittest.TestCase):
    def assert_effect(self, error, name, tag):
        self.assertIsInstance(error, IRRuntimeError)
        self.assertEqual(error.error_code, "ORES_I64_OVERFLOW")
        self.assertEqual(error.guest_error_name, "ArithmeticOverflowError")
        self.assertEqual(error.effect_kind, "Throw")
        self.assertEqual(error.effect_code, 0x494F0001)
        self.assertEqual(error.operation, name)
        self.assertEqual(error.operation_tag, tag)
        self.assertEqual(error.packed_status, (tag << 32) | 0x494F0001)
        self.assertEqual(str(error),
                         "ORES_I64_OVERFLOW: checked i64 arithmetic overflow")
        self.assertIsNone(error.__cause__)

    def test_arithmetic_failure_operations_preserve_tags(self):
        cases = (
            ("add", MAX, 1, "add", 1),
            ("sub", MIN, 1, "subtract", 2),
            ("mul", MAX, 2, "multiply", 3),
            ("mul", MIN, -1, "multiply", 3),
        )
        for op, lhs, rhs, name, tag in cases:
            with self.subTest(op=op, lhs=lhs, rhs=rhs):
                executable = mir(function(
                    "main", binop(op, var("x"), num(rhs)), "x"))
                with self.assertRaises(CheckedI64Overflow) as caught:
                    execute(executable, "main", [lhs])
                self.assert_effect(caught.exception, name, tag)

    def test_first_overflow_wins_even_if_another_operand_would_fail(self):
        executable = mir(function(
            "main", binop(
                "mul",
                binop("add", var("x"), num(1)),
                binop("mul", var("x"), num(2))),
            "x"))
        with self.assertRaises(CheckedI64Overflow) as caught:
            execute(executable, "main", [MAX])
        self.assert_effect(caught.exception, "add", 1)

    def test_nested_call_does_not_replace_original_effect(self):
        executable = mir(
            function("scale", binop("mul", var("x"), num(43)), "x"),
            function("forward", binop("add", call("scale", var("x")),
                                      num(1)), "x"),
            function("main", call("forward", var("x")), "x"))
        with self.assertRaises(CheckedI64Overflow) as caught:
            execute(executable, "main", [MAX])
        self.assert_effect(caught.exception, "multiply", 3)
        self.assertEqual(execute(executable, "main", [0]), 1)
        self.assertEqual(execute(executable, "main", [1]), 44)

    def test_unsupported_opcode_cannot_forge_effect_identity(self):
        for op in ("neg_i64", "div_i64", "not_an_opcode"):
            with self.assertRaises(ValueError):
                CheckedI64Overflow(op)


if __name__ == "__main__":
    unittest.main()
