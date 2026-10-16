"""Hardening tests for strict JSON and semantic HIR/MIR admission.

These tests are independent of jsonschema, use only stdlib and do not prove
production compiler conformance.
"""
from __future__ import annotations

import copy
import random
import unittest
from pathlib import Path

from experiments.ir_v1 import (
    IRRuntimeError, IRValidationError, canonical_bytes, execute,
    fingerprint, load_json, lower, validate_hir, validate_mir,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ir-v1"


def model(expr, env):
    """Independent arithmetic/conditional expression oracle, not MIR."""
    kind = expr["kind"]
    if kind == "int":
        return int(expr["value"])
    if kind == "bool":
        return expr["value"]
    if kind == "var":
        return env[expr["name"]]
    if kind == "let":
        value = model(expr["value"], env)
        return model(expr["body"], {**env, expr["name"]: value})
    if kind == "if":
        return model(expr["then" if model(expr["condition"], env) else "else"], env)
    if kind == "bin":
        a, b = model(expr["lhs"], env), model(expr["rhs"], env)
        return {
            "add": lambda: a + b,
            "sub": lambda: a - b,
            "mul": lambda: a * b,
            "lt": lambda: a < b,
            "eq": lambda: a == b,
        }[expr["op"]]()
    raise AssertionError("unsupported model expression")


def integer(n):
    return {"kind": "int", "value": str(n)}


def var(name):
    return {"kind": "var", "name": name}


def binary(op, lhs, rhs):
    return {"kind": "bin", "op": op, "lhs": lhs, "rhs": rhs}


class IRV1HardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hir = load_json((FIXTURES / "arithmetic.hir.json").read_bytes())
        cls.mir = load_json((FIXTURES / "arithmetic.mir.json").read_bytes())

    def test_canonical_json_is_acyclic_string_keyed_and_uncoerced(self):
        bad = [
            {1: "integer key"},
            {1: "same key", "1": "different key"},
            {"float": 1.25},
            {"tuple": (1, 2)},
            {"set": {1, 2}},
            {"huge_number": 2**260},
            {"surrogate": "\ud800"},
        ]
        nested = {}
        value = nested
        for _ in range(65):
            child = {}
            value["next"] = child
            value = child
        bad.append(nested)
        cyclic = []
        cyclic.append(cyclic)
        bad.append(cyclic)
        for item in bad:
            with self.subTest(item=repr(type(item))):
                with self.assertRaises(IRValidationError):
                    canonical_bytes(item)
                with self.assertRaises(IRValidationError):
                    fingerprint(item)

    def test_json_parser_rejects_coerced_floats_huge_ints_and_duplicates(self):
        for raw in [
            '{"x":1.0}', '{"x":1e2}', '{"x":-0.0}',
            '{"x":Infinity}', '{"x":NaN}', '{"x":1,"x":2}',
            '{"x":' + "9"*100 + '}',
            '{"x":"\\ud800"}',
            "[" * 70 + "0" + "]" * 70,
            '{"x":"unterminated',
        ]:
            with self.subTest(raw=raw[:40]):
                with self.assertRaises(IRValidationError):
                    load_json(raw)

    def test_canonical_bytes_stable_under_object_order(self):
        self.assertEqual(canonical_bytes({"z": {"x": 1, "y": [2, 3]}, "a": None}),
                         canonical_bytes({"a": None, "z": {"y": [2, 3], "x": 1}}))

    def test_canonical_preflight_enforces_exact_utf8_budget(self):
        limit = 1_048_576
        # Exact JSON punctuation: {"x":"<payload>"} has eight bytes of
        # overhead. The maximum accepted document is not rounded down.
        within = {"x": "a" * (limit - 8)}
        self.assertEqual(len(canonical_bytes(within)), limit)
        with self.assertRaises(IRValidationError):
            canonical_bytes({"x": "a" * (limit - 7)})
        with self.assertRaises(IRValidationError):
            canonical_bytes({"x": "\\n" * limit})
        with self.assertRaises(IRValidationError):
            canonical_bytes([False] * (limit // 5 + 1))

    def test_canonical_size_accounts_for_escaped_keys_and_unicode(self):
        samples = [
            {"new\\nline": "\\t\\u0000", "slash\\\\": "\\u03c0"},
            ["\\u2603", {"quote\\\"": True, "negative": -42}],
            {"null": None, "empty": {}, "list": [0, False, "ok"]},
        ]
        for value in samples:
            with self.subTest(value=value):
                encoded = canonical_bytes(value)
                self.assertEqual(len(encoded), len(
                    __import__("json").dumps(value, sort_keys=True,
                        ensure_ascii=False, allow_nan=False,
                        separators=(",", ":")).encode("utf-8")))

    def test_unknown_nested_hir_fields_are_rejected(self):
        hir = copy.deepcopy(self.hir)
        body = next(f for f in hir["functions"] if f["name"] == "double")["body"]
        body["security_override"] = True
        with self.assertRaises(IRValidationError):
            validate_hir(hir)

    def test_unknown_nested_mir_fields_are_rejected(self):
        mir = copy.deepcopy(self.mir)
        inst = next(f for f in mir["functions"] if f["name"] == "double")["blocks"][0]["instructions"][0]
        inst["effects"] = ["unsafe"]
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_unbounded_values_never_enter_the_interpreter(self):
        for value in (2**63, -(2**63)-1, 3.14, True, "5"):
            with self.subTest(value=value):
                with self.assertRaises(IRValidationError):
                    execute(self.mir, "double", [value])

    def test_untrusted_mir_cannot_reach_code_execution_with_forged_branch(self):
        mir = copy.deepcopy(self.mir)
        branch = next(f for f in mir["functions"] if f["name"] == "choose")["blocks"][0]["term"]
        branch["cond"] = "unknown"
        with self.assertRaises(IRValidationError):
            execute(mir, "choose", [-3])

    def test_hir_to_mir_differential_nested_conditional_properties(self):
        rng = random.Random(20261014)
        hir = copy.deepcopy(self.hir)
        fn = next(f for f in hir["functions"] if f["name"] == "double")
        for i in range(300):
            constant = rng.randrange(-20, 21)
            op = rng.choice(("add", "sub", "mul"))
            expression = binary(op, var("x"), integer(constant))
            if i % 3 == 0:
                expression = {
                    "kind": "if",
                    "condition": binary("lt", var("x"), integer(rng.randrange(-20, 21))),
                    "then": expression,
                    "else": binary("sub", integer(constant), var("x")),
                }
            if i % 7 == 0:
                expression = {
                    "kind": "let",
                    "name": "tmp",
                    "value": expression,
                    "body": {
                        "kind": "if",
                        "condition": binary("eq", var("tmp"), integer(0)),
                        "then": integer(4),
                        "else": binary("add", var("tmp"), integer(1)),
                    },
                }
            fn["body"] = expression
            mir = lower(hir)
            x = rng.randrange(-100, 101)
            expected = model(expression, {"x": x})
            observed = execute(mir, "double", [x])
            self.assertEqual(observed, expected, f"seeded edit {i}")

    def test_repeated_verification_cannot_modify_ir_input(self):
        hir = copy.deepcopy(self.hir)
        mirror = copy.deepcopy(hir)
        validate_hir(hir)
        lower(hir)
        self.assertEqual(hir, mirror)
        mir = copy.deepcopy(self.mir)
        mirror = copy.deepcopy(mir)
        validate_mir(mir)
        execute(mir, "main", [])
        self.assertEqual(mir, mirror)


if __name__ == "__main__":
    unittest.main()
