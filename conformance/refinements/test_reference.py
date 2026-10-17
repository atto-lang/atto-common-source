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
        self.assertFalse(r.accepts(chr(0xD800)))
        self.assertFalse(r.accepts(chr(0xDC00)))

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
            "type A = int with value ge 1;",
            "type A = int with value le 10;",
            "type A = string;",
        ]
        for source in invalid:
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)


    def test_stdlib_annotation_normalization(self):
        cases = (
            ("@MinLength(3) @MaxLength(32) type Username = string;",
             "type Username = string with length gte 3 and length lte 32;",
             ("", "ab", "abc", "😀😀😀", "x" * 32, "x" * 33)),
            ("@Min(1) @Max(65535) type Port = int;",
             "type Port = int with value >= 1 and value <= 65535;",
             (0, 1, 443, 65535, 65536)),
            ("@Range(min=0,max=100) type Percentage = int;",
             "type Percentage = int with value gte 0 and value lte 100;",
             (-1, 0, 50, 100, 101)),
            ("@Range(min=-10,max=10) type Signed = int;",
             "type Signed = int with value >= -10 and value <= 10;",
             (-11, -10, 0, 10, 11)),
        )
        for annotations, source, values in cases:
            with self.subTest(annotations=annotations):
                first, second = parse(annotations), parse(source)
                self.assertEqual(first.predicates, second.predicates)
                for value in values:
                    self.assertEqual(first.accepts(value), second.accepts(value))

    def test_bad_stdlib_annotations_reject(self):
        for source in (
            "@MinLength(1) type Wrong = int;",
            "@Min(1) type Wrong = string;",
            "@Range(min=1,max=2) type Wrong = string;",
            "@Range(min=1,min=2) type Wrong = int;",
            "@Range(eq=10) type Wrong = int;",
            "@MinLength(-1) type Wrong = string;",
            "@Size(min=-1) type Wrong = string;",
            "@MaxLength(1,2) type Wrong = string;",
            "@Min(foo) type Wrong = int;",
            "@Range() type Wrong = int;",
            "@Min(11) @Max(10) type Wrong = int;",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)

    def test_signed_i64_limits(self):
        minimum = parse("type Min = int with value eq -9223372036854775808;")
        self.assertTrue(minimum.accepts(-(1 << 63)))
        self.assertFalse(minimum.accepts(-(1 << 63) - 1))
        maximum = parse("type Max = int with value eq 9223372036854775807;")
        self.assertTrue(maximum.accepts((1 << 63) - 1))
        self.assertFalse(maximum.accepts(1 << 63))
        for source in (
            "type Bad = int with value eq -9223372036854775809;",
            "type Bad = int with value eq 9223372036854775808;",
            "type Bad = string with length eq 9223372036854775808;",
            "type Bad = int with value lt -9223372036854775808;",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)

    def test_exclusions_cannot_exhaust_integer_domain(self):
        for source in (
            "type Empty = int with value gte 1 and value lte 2 and value ne 1 and value ne 2;",
            "type Empty = int with value gte -9223372036854775808 and value lte -9223372036854775807 and value ne -9223372036854775808 and value ne -9223372036854775807;",
        ):
            with self.subTest(source=source):
                with self.assertRaises(ConstraintSyntaxError):
                    parse(source)

    def test_nominal_identity_is_not_erased(self):
        narrow = parse("define newtype Name(string) with length eq 10;")
        weak = parse("define newtype Name(string) with length gt 0;")
        other = parse("define newtype Other(string) with length gt 0;")
        alias = parse("type Alias = string with length gt 0;")
        self.assertTrue(narrow.entails(weak))
        self.assertFalse(weak.entails(narrow))
        self.assertFalse(narrow.entails(other))
        self.assertFalse(narrow.entails(alias))
        self.assertFalse(alias.entails(narrow))

    def test_signed_bounds_and_underscores(self):
        a = parse("type A = int with value gte -9_223_372_036_854_775_808;")
        self.assertTrue(a.accepts(-(1 << 63)))
        with self.assertRaises(ConstraintSyntaxError):
            parse("type Bad = int with value gte 1__0;")

    def test_numeric_values(self):
        percentage_keyword = parse("type Percentage = int with value gte 0 and value lte 100;")
        percentage_symbols = parse("type Percentage = int with value >= 0 and value <= 100;")
        for value in (-1, 0, 50, 100, 101):
            self.assertEqual(percentage_keyword.accepts(value), percentage_symbols.accepts(value))
        self.assertTrue(percentage_keyword.accepts(0))
        self.assertTrue(percentage_keyword.accepts(100))
        self.assertFalse(percentage_keyword.accepts(101))
        self.assertFalse(percentage_keyword.accepts(True))

        port_keyword = parse("type Port = int with value gte 1 and value lte 65535;")
        port_symbols = parse("type Port = int with value >= 1 and value <= 65535;")
        for value in (0, 1, 443, 65535, 65536):
            self.assertEqual(port_keyword.accepts(value), port_symbols.accepts(value))
        self.assertTrue(port_keyword.accepts(1))
        self.assertTrue(port_keyword.accepts(65535))
        self.assertFalse(port_keyword.accepts(0))
        self.assertFalse(port_keyword.accepts(65536))


if __name__ == "__main__":
    unittest.main()
