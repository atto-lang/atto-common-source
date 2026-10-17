import unittest

from conformance.refinements.reference import parse, ConstraintSyntaxError
from conformance.refinements.zorde_bridge import to_zorde_descriptor


class ZordeBridgeTests(unittest.TestCase):
    def test_nonempty_string(self):
        descriptor = to_zorde_descriptor(
            parse("type NonEmpty = string with length gt 0;")
        )
        self.assertEqual(descriptor["min_length"], 1)
        self.assertIsNone(descriptor["max_length"])
        self.assertEqual(descriptor["length_semantics"], "unicode_scalar_values")

    def test_exact_length_annotation(self):
        descriptor = to_zorde_descriptor(
            parse("@Size(min=10, max=10) type Exact10 = string;")
        )
        self.assertEqual(descriptor["min_length"], 10)
        self.assertEqual(descriptor["max_length"], 10)

    def test_numeric_exclusive_range(self):
        descriptor = to_zorde_descriptor(
            parse("type Digit = int with value gt 0 and value lt 10;")
        )
        self.assertEqual(descriptor["min"], 0)
        self.assertTrue(descriptor["min_exclusive"])
        self.assertEqual(descriptor["max"], 10)
        self.assertTrue(descriptor["max_exclusive"])

    def test_equal_bounds_keep_stricter_exclusivity(self):
        descriptor = to_zorde_descriptor(
            parse("type Strict = int with value gt 5 and value gte 5 and value lt 10 and value lte 10;")
        )
        self.assertEqual(descriptor["min"], 5)
        self.assertTrue(descriptor["min_exclusive"])
        self.assertEqual(descriptor["max"], 10)
        self.assertTrue(descriptor["max_exclusive"])

    def test_nominal_identity_is_preserved(self):
        descriptor = to_zorde_descriptor(
            parse("define newtype Name(string) with length gte 1;")
        )
        self.assertTrue(descriptor["nominal"])


    def test_nominal_descriptor_ids_do_not_collapse(self):
        a = to_zorde_descriptor(parse("define newtype Username(string) with length gte 1;"))
        b = to_zorde_descriptor(parse("define newtype UserId(string) with length >= 1;"))
        alias = to_zorde_descriptor(parse("type Alias = string with length >= 1;"))
        self.assertEqual(a["nominal_id"], "Username")
        self.assertEqual(b["nominal_id"], "UserId")
        self.assertNotEqual(a, b)
        self.assertIsNone(alias["nominal_id"])

    def test_numeric_descriptor_does_not_claim_runtime_parity(self):
        d = to_zorde_descriptor(
            parse("type Port = int with value gte 1 and value lte 65535;")
        )
        self.assertFalse(d["runtime_supported"])
        self.assertEqual(d["requires"], "signed_int64_exact_validator")
        self.assertEqual((d["min"], d["max"]), (1, 65535))

    def test_redundant_exclusions_do_not_require_runtime_holes(self):
        plain = to_zorde_descriptor(parse(
            "type Port = int with value gte 1 and value lte 65535;"
        ))
        redundant = to_zorde_descriptor(parse(
            "type Port = int with value gte 1 and value lte 65535 and value ne 0;"
        ))
        self.assertEqual(plain, redundant)
        with self.assertRaises(ConstraintSyntaxError):
            to_zorde_descriptor(parse(
                "type Port = int with value gte 1 and value lte 65535 and value ne 42;"
            ))

    def test_unimplemented_exclusion_fails_closed(self):
        refined = parse("type NotTen = int with value ne 10;")
        with self.assertRaises(ConstraintSyntaxError):
            to_zorde_descriptor(refined)


if __name__ == "__main__":
    unittest.main()
