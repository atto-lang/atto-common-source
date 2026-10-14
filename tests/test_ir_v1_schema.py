"""Validate JSON Schema 2020-12 with a real standards-compliant validator.

Test-only dependency: jsonschema==4.26.0. Never mistake structural schema
admission for semantic HIR/MIR verification.
"""
import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

from experiments.ir_v1 import IRValidationError, validate_hir, validate_mir

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
FIXTURES = ROOT / "fixtures" / "ir-v1"


class IRV1JSONSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hir = json.loads((FIXTURES / "arithmetic.hir.json").read_text())
        cls.mir = json.loads((FIXTURES / "arithmetic.mir.json").read_text())
        cls.hir_schema = json.loads((CONTRACTS / "ores-hir-v1.experimental.schema.json").read_text())
        cls.mir_schema = json.loads((CONTRACTS / "ores-mir-v1.experimental.schema.json").read_text())
        Draft202012Validator.check_schema(cls.hir_schema)
        Draft202012Validator.check_schema(cls.mir_schema)
        cls.hir_validator = Draft202012Validator(cls.hir_schema)
        cls.mir_validator = Draft202012Validator(cls.mir_schema)

    def test_reference_hir_and_mir_are_schema_valid(self):
        self.hir_validator.validate(self.hir)
        self.mir_validator.validate(self.mir)
        validate_hir(self.hir)
        validate_mir(self.mir)

    def test_schema_rejects_unknown_hir_fields(self):
        doc = copy.deepcopy(self.hir)
        doc["functions"][0]["body"]["injected"] = "unexpected"
        with self.assertRaises(ValidationError):
            self.hir_validator.validate(doc)

    def test_schema_rejects_unrecognized_mir_instruction(self):
        doc = copy.deepcopy(self.mir)
        doc["functions"][0]["blocks"][0]["instructions"][0]["op"] = "unsafe_ffi"
        with self.assertRaises(ValidationError):
            self.mir_validator.validate(doc)

    def test_schema_rejects_invalid_required_features(self):
        for schema, doc in ((self.hir_validator, self.hir), (self.mir_validator, self.mir)):
            changed = copy.deepcopy(doc)
            changed["required_features"] = ["allow-ffi"]
            with self.assertRaises(ValidationError):
                schema.validate(changed)

    def test_schema_rejects_wrong_instruction_type_or_missing_field(self):
        doc = copy.deepcopy(self.mir)
        doc["functions"][0]["blocks"][0]["instructions"][0]["type"] = "bool"
        with self.assertRaises(ValidationError):
            self.mir_validator.validate(doc)
        doc = copy.deepcopy(self.mir)
        del doc["functions"][0]["blocks"][0]["term"]
        with self.assertRaises(ValidationError):
            self.mir_validator.validate(doc)

    def test_schema_does_not_replace_semantic_verifier(self):
        doc = copy.deepcopy(self.hir)
        double = next(f for f in doc["functions"] if f["name"] == "double")
        double["body"]["rhs"]["value"] = "9223372036854775808"
        self.hir_validator.validate(doc)  # Canonical decimal syntax, out of i64 range.
        with self.assertRaises(IRValidationError):
            validate_hir(doc)


if __name__ == "__main__":
    unittest.main()
