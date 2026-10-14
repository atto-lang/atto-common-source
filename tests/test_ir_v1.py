"""Executable adversarial HIR to MIR v1 tests (no production backend evidence)."""
import copy
import json
import random
import unittest
from pathlib import Path

from experiments.ir_v1 import (IRValidationError, IRRuntimeError, load_json,
                               validate_hir, validate_mir, lower, execute, fingerprint)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "ir-v1" / "arithmetic.hir.json"
MIR_FIXTURE = FIXTURE.with_name("arithmetic.mir.json")
EXPECTED = FIXTURE.with_name("results.json")


class IRV1Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hir = load_json(FIXTURE.read_bytes())
        cls.mir = load_json(MIR_FIXTURE.read_bytes())

    def test_canonical_hir_and_mir_roundtrip(self):
        self.assertEqual(validate_hir(self.hir), self.hir)
        self.assertEqual(validate_mir(self.mir), self.mir)
        self.assertEqual(lower(self.hir), self.mir)
        self.assertEqual(fingerprint(lower(self.hir)), fingerprint(self.mir))

    def test_executable_examples(self):
        for case in json.loads(EXPECTED.read_text()):
            self.assertEqual(execute(self.mir, case["function"], case["args"]), case["expected"])

    def test_checked_arithmetic_overflow(self):
        for num in (-2**63, 2**63 - 1):
            with self.assertRaises(IRRuntimeError):
                execute(self.mir, "double", [num])
        with self.assertRaises(IRValidationError):
            execute(self.mir, "double", [True])

    def test_unknown_hir_and_mir_operations_rejected(self):
        hir = copy.deepcopy(self.hir)
        hir["functions"][0]["body"]["op"] = "div"
        with self.assertRaises(IRValidationError):
            validate_hir(hir)
        mir = copy.deepcopy(self.mir)
        mir["functions"][0]["blocks"][0]["instructions"][0]["op"] = "unsafe_ptr"
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_unsupported_schema_version_and_features_rejected(self):
        for key in ("schema_version", "required_features", "ir_family"):
            altered = copy.deepcopy(self.mir)
            altered[key] = "unsupported"
            with self.assertRaises(IRValidationError):
                validate_mir(altered)

    def test_no_undeclared_fields(self):
        for ir, verify in ((self.hir, validate_hir), (self.mir, validate_mir)):
            altered = copy.deepcopy(ir)
            altered["side_channel"] = "ignored?"
            with self.assertRaises(IRValidationError):
                verify(altered)

    def test_duplicate_json_keys_nonfinite_rejected(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
            with self.assertRaises(IRValidationError):
                load_json(raw)

    def test_unknown_callee_or_wrong_call_arity_rejected(self):
        hir = copy.deepcopy(self.hir)
        hir["functions"][0]["body"]["condition"]["args"] = []
        with self.assertRaises(IRValidationError):
            validate_hir(hir)
        hir = copy.deepcopy(self.hir)
        hir["functions"][0]["body"]["condition"]["function"] = "missing"
        with self.assertRaises(IRValidationError):
            validate_hir(hir)

    def test_duplicate_ssa_definition_and_missing_reference_rejected(self):
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "double")
        fn["blocks"][0]["instructions"][0]["id"] = fn["params"][0]["name"]
        with self.assertRaises(IRValidationError):
            validate_mir(mir)
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "double")
        fn["blocks"][0]["term"]["value"] = "missing"
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_control_flow_edge_and_cycle_rejected(self):
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "choose")
        fn["blocks"][0]["term"]["then_args"] = ["bogus"]
        with self.assertRaises(IRValidationError):
            validate_mir(mir)
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "choose")
        fn["blocks"][1]["term"] = {"op": "jump", "target": "b0", "args": []}
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_unreachable_blocks_rejected(self):
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "double")
        fn["blocks"].append({"id": "b1", "params": [], "instructions": [],
                             "term": {"op": "return", "value": "v0"}})
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_bool_is_not_an_integer(self):
        hir = copy.deepcopy(self.hir)
        fn = next(f for f in hir["functions"] if f["name"] == "double")
        fn["body"] = {"kind": "int", "value": True}
        with self.assertRaises(IRValidationError):
            validate_hir(hir)

    def test_hashing_order_independent_within_objects(self):
        self.assertEqual(fingerprint({"a": 1, "b": 2}),
                         fingerprint({"b": 2, "a": 1}))

    def test_violating_mir_is_not_executed(self):
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "double")
        fn["blocks"][0]["term"] = {"op": "return", "value": "garbage"}
        with self.assertRaises(IRValidationError):
            execute(mir, "double", [2])

    def test_recursive_hir_and_mir_are_rejected(self):
        hir = copy.deepcopy(self.hir)
        fn = next(f for f in hir["functions"] if f["name"] == "double")
        fn["body"] = {"kind": "call", "function": "double",
                      "args": [{"kind": "var", "name": "x"}]}
        with self.assertRaises(IRValidationError):
            validate_hir(hir)
        mir = copy.deepcopy(self.mir)
        fn = next(f for f in mir["functions"] if f["name"] == "double")
        instruction = fn["blocks"][0]["instructions"][1]
        instruction.clear()
        instruction.update({"op": "call", "id": "v1", "type": "i64",
                            "function": "double", "args": ["x"]})
        with self.assertRaises(IRValidationError):
            validate_mir(mir)

    def test_random_differential_1000_arithmetic_expressions(self):
        rng = random.Random(42)
        hir = copy.deepcopy(self.hir)
        fn = next(f for f in hir["functions"] if f["name"] == "double")
        for _ in range(1000):
            x = rng.randrange(-10000, 10001)
            v = rng.randrange(-10000, 10001)
            op = rng.choice(("add", "sub", "mul"))
            fn["body"] = {"kind": "bin", "op": op,
                          "lhs": {"kind": "var", "name": "x"},
                          "rhs": {"kind": "int", "value": str(v)}}
            mir = lower(hir)
            expected = {"add": x + v, "sub": x - v, "mul": x * v}[op]
            self.assertEqual(execute(mir, "double", [x]), expected)


if __name__ == "__main__":
    unittest.main()
