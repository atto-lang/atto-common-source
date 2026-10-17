"""Contract tests for the reference normalizer (not backend conformance)."""
import unittest
from conformance.refinements.reference import parse, ConstraintSyntaxError


class RefinementReferenceTests(unittest.TestCase):
    def test_equivalent_annotation_and_with(self):
        a = parse("@Size(min=1, max=32) type A = string;")
        b = parse("type B = string with length gte 1 and length lte 32;")
        for value in ("", "a", "😀", "x" * 32, "x" * 33):
            self.assertEqual(a.accepts(value), b.accepts(value))

    def test_length_is_code_points(self):
        r = parse("type Emoji = string with length eq 1;")
        self.assertTrue(r.accepts("😀"))
        self.assertFalse(r.accepts("e\u0301"))

    def test_operator_aliases(self):
        pairs = [
            ("eq", "==", "=="),
            ("ne", "!=", "!="),
            ("gt", ">", ">"),
            ("gte", ">=", ">="),
            ("lt", "<", "<"),
            ("lte", "<=", "<="),
        ]
        for keyword, symbol, normalized in pairs:
            with self.subTest(keyword=keyword, symbol=symbol):
                a = parse(f"type A = int with value {keyword} 10;")
                b = parse(f"type B = int with value {symbol} 10;")
                self.assertEqual(a.predicates[0].op, normalized)
                self.assertEqual(b.predicates[0].op, normalized)

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
            "type A = int with value ge 1;",
            "type A = int with value le 10;",
        ]
        for source in invalid:
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)

    def test_numeric_values(self):
        keyword = parse("type Percentage = int with value gte 0 and value lte 100;")
        symbols = parse("type Percentage = int with value >= 0 and value <= 100;")
        for value in (-1, 0, 50, 100, 101):
            self.assertEqual(keyword.accepts(value), symbols.accepts(value))
        self.assertTrue(keyword.accepts(0))
        self.assertTrue(keyword.accepts(100))
        self.assertFalse(keyword.accepts(101))
        self.assertFalse(keyword.accepts(True))


if __name__ == "__main__":
    unittest.main()
