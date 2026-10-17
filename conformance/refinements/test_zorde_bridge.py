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

    def test_nominal_identity_is_preserved(self):
        descriptor = to_zorde_descriptor(
            parse("define newtype Name(string) with length ge 1;")
        )
        self.assertTrue(descriptor["nominal"])

    def test_unimplemented_exclusion_fails_closed(self):
        refined = parse("type NotTen = int with value ne 10;")
        with self.assertRaises(ConstraintSyntaxError):
            to_zorde_descriptor(refined)


if __name__ == "__main__":
    unittest.main()
