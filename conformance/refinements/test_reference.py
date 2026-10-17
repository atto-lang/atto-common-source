"""Contract tests for the reference normalizer (not backend conformance)."""
import unittest
from conformance.refinements.reference import parse, ConstraintSyntaxError


class RefinementReferenceTests(unittest.TestCase):
    def test_equivalent_annotation_and_with(self):
        a = parse("@Size(min=1, max=32) type A = string;")
        b = parse("type B = string with length ge 1 and length le 32;")
        for value in ("", "a", "😀", "x" * 32, "x" * 33):
            self.assertEqual(a.accepts(value), b.accepts(value))

    def test_length_is_code_points(self):
        r = parse("type Emoji = string with length eq 1;")
        self.assertTrue(r.accepts("😀"))
        self.assertFalse(r.accepts("e\u0301"))

    def test_operator_aliases(self):
        self.assertEqual(parse("type A = string with length eq 10;").predicates[0].op,
                         parse("type B = string with length == 10;").predicates[0].op)

    def test_implication(self):
        exact = parse("type A = string with length eq 10;")
        nonempty = parse("type B = string with length gt 0;")
        self.assertTrue(exact.entails(nonempty))
        self.assertFalse(nonempty.entails(exact))

    def test_nominal_is_distinct(self):
        n = parse("define newtype A(string) with length gt 0;")
        a = parse("type B = string with length gt 0;")
        self.assertTrue(n.nominal)
        self.assertFalse(n.entails(a))
        self.assertFalse(a.entails(n))

    def test_reject_unsafe_or_unknown(self):
        invalid = [
            "type A = string with length gt 0 or length eq 10;",
            "type A = string with length gt foo();",
            "type A = string with length gt 10 and length lt 5;",
            "type A = string with length lt 0;",
            "type A = int with length gt 0;",
            "type A = string where it.trim().length > 0;",
            "@Size(min=1,min=2) type A = string;",
            "@Unknown type A = string;",
            "type A = string with length eq 3.5;",
            "type A = string;",
        ]
        for source in invalid:
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)

    def test_numeric_values(self):
        r = parse("type Percentage = int with value ge 0 and value le 100;")
        self.assertTrue(r.accepts(0))
        self.assertTrue(r.accepts(100))
        self.assertFalse(r.accepts(101))
        self.assertFalse(r.accepts(True))


if __name__ == "__main__":
    unittest.main()
