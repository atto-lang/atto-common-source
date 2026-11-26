import unittest
import json
from pathlib import Path

from conformance.refinements.reference import parse, ConstraintSyntaxError
from conformance.refinements.zorde_bridge import to_zorde_descriptor


class ZordeBridgeTests(unittest.TestCase):
    def test_nonempty_string_uses_canonical_inclusive_interval(self):
        d = to_zorde_descriptor(
            parse("type NonEmpty = string with length gt 0;")
        )
        self.assertEqual(d["schema"], "zorde.scalar/v1")
        self.assertEqual((d["minimum"], d["maximum"]), (1, (1 << 63) - 1))
        self.assertEqual(d["property"], "length")
        self.assertEqual(d["excluded"], [])
        self.assertEqual(d["length_semantics"], "unicode_scalar_values")

    def test_exact_fixture_matches_zorde_contract(self):
        fixture = (Path(__file__).resolve().parents[2] /
                   "fixtures/refinement-v1/zorde-code-0-5.json")
        expected = json.loads(fixture.read_text(encoding="utf-8"))
        for source in (
            "define type Code = int with min 0 and max 5;",
            "type Code = int with value gte 0 and value lte 5;",
            "@Range(min=0,max=5) type Code = int;",
        ):
            with self.subTest(source=source):
                self.assertEqual(to_zorde_descriptor(parse(source)), expected)

    def test_integer_shorthand_same_zorde_descriptor_and_outcomes(self):
        shorthand = parse("define type Code = int with min 0 and max 5;")
        canonical = parse("type Code = int with value gte 0 and value lte 5;")
        annotated = parse("@Range(min=0,max=5) type Code = int;")
        descriptors = [to_zorde_descriptor(v) for v in
                       (shorthand, canonical, annotated)]
        self.assertEqual(descriptors[0], descriptors[1])
        self.assertEqual(descriptors[1], descriptors[2])
        self.assertEqual(descriptors[0]["schema"], "zorde.scalar/v1")
        self.assertEqual(descriptors[0]["minimum"], 0)
        self.assertEqual(descriptors[0]["maximum"], 5)
        self.assertEqual(descriptors[0]["excluded"], [])
        self.assertIn("exact_signed_int64", descriptors[0]["runtime_requirements"])
        self.assertIn("no_float_coercion", descriptors[0]["runtime_requirements"])
        for value in (-1, 0, 1, 4, 5, 6, True, 1.0):
            decisions = [v.accepts(value) for v in
                         (shorthand, canonical, annotated)]
            self.assertEqual(decisions, [0 <= value <= 5
                             if type(value) is int else False] * 3)

    def test_shorthand_rejects_unsafe_or_ambiguous_forms(self):
        for source in (
            "define type Bad = int with min 5 and max 0;",
            "type Bad = string with min 0 and max 5;",
            "type Bad = int with min 0 or max 5;",
            "type Bad = int with min 0; evil()",
            "type Bad = int with min foo();",
            "type Bad = int with min -9223372036854775809;",
            "define type Bad = int as positive integer;",
        ):
            with self.subTest(source=source), self.assertRaises(ConstraintSyntaxError):
                parse(source)

    def test_positive_is_strict_and_zero_is_not_positive(self):
        positive = parse("define type Positive = int with value gt 0;")
        self.assertFalse(positive.accepts(0))
        self.assertTrue(positive.accepts(1))
        self.assertFalse(positive.accepts(-1))
        self.assertEqual(to_zorde_descriptor(positive)["minimum"], 1)

    def test_string_v2_charset_descriptor_matches_shared_zorde_fixture(self):
        fixture = (Path(__file__).resolve().parents[2] /
                   "fixtures/refinement-v1/zorde-english-letters-2-4-v2.json")
        expected = json.loads(fixture.read_text(encoding="utf-8"))
        samples = (
            "define type English = string with min_length 2 and max_length 4 "
            "and chars ascii_letters;",
            "type English = string with length gte 2 and length lte 4 "
            "and chars ascii_letters;",
            "@Size(min=2,max=4) type English = string with chars ascii_letters;",
        )
        for source in samples:
            with self.subTest(source=source):
                refined = parse(source)
                self.assertEqual(to_zorde_descriptor(refined), expected)
                for value, valid in (
                    ("AB", True), ("aBc", True), ("A", False),
                    ("ABCDE", False), ("A1", False), ("éA", False),
                    ("中A", False), ("😀", False), (3, False),
                ):
                    self.assertEqual(refined.accepts(value), valid)

    def test_han_v2_schema_fingerprint_and_exact_64bit_bounds(self):
        path = (Path(__file__).resolve().parents[2] /
                "fixtures/refinement-v1/zorde-han-nonempty-v2.json")
        manifest = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["maximum"], (1 << 63) - 1)
        self.assertEqual(manifest["fingerprint"],
                         "72c95e512c6e377ec6d4d2a16fcd18b88f2c84abe2d95f01cdc144d6e57061cc")
        for source in (
            "define type HanText = string with min_length 1 and chars han;",
            "type HanText = string with length gte 1 and chars han;",
            "@MinLength(1) type HanText = string with chars han;",
        ):
            with self.subTest(source=source):
                self.assertEqual(to_zorde_descriptor(parse(source)), manifest)

    def test_han_ucd18_manifest_exactly_matches_reference(self):
        from conformance.refinements.reference import HAN_UCD_18
        path = (Path(__file__).resolve().parents[2] /
                "fixtures/refinement-v1/unicode18-han-ranges.csv")
        pairs = []
        for raw in path.read_text(encoding="ascii").splitlines():
            if raw.startswith("#") or not raw:
                continue
            a, b = raw.split(",")
            pairs.append((int(a), int(b)))
        self.assertEqual(tuple(pairs), HAN_UCD_18)
        self.assertEqual(len(pairs), 25)
        self.assertEqual(sum(b-a+1 for a,b in pairs), 103352)
        self.assertTrue(all(pairs[i-1][1] < pairs[i][0]
                            for i in range(1, len(pairs))))

    def test_strict_ascii_case_and_reserved_unicode_policies(self):
        upper = parse("type U = string with chars ascii_uppercase;")
        lower = parse("type L = string with chars ascii_lowercase;")
        self.assertTrue(upper.accepts("ABC"))
        self.assertFalse(upper.accepts("ABc"))
        self.assertFalse(upper.accepts("A1"))
        self.assertTrue(lower.accepts("abc"))
        self.assertFalse(lower.accepts("Abc"))
        self.assertFalse(lower.accepts("é"))
        for policy, value in (("uppercase", "ABC"), ("lowercase", "abc")):
            refined = parse("type S = string with chars " + policy + ";")
            d = to_zorde_descriptor(refined)
            self.assertEqual(d["schema"], "zorde.scalar/v2")
            self.assertEqual(d["unicode_version"], "18.0.0")
            self.assertIn("verified_ucd_18_0_0_tables", d["runtime_requirements"])
            with self.assertRaises(ConstraintSyntaxError):
                refined.accepts(value)

        han = parse("type S = string with min_length 1 and chars han;")
        d = to_zorde_descriptor(han)
        self.assertEqual(d["schema"], "zorde.scalar/v2")
        self.assertEqual(d["unicode_version"], "18.0.0")
        for value, valid in (
            ("中文", True), ("中", True), ("𠀀", True), ("𳑹", True),
            ("中A", False), ("中，", False), ("😀", False), ("", False),
            ("𪛠", False), ("𳑺", False),
        ):
            with self.subTest(han=value):
                self.assertEqual(han.accepts(value), valid)

    def test_invalid_string_policy_combinations(self):
        for source in (
            "type S = int with chars ascii_letters;",
            "type S = string with chars ascii_letters and chars han;",
            "type S = string with min_length 4 and max_length 3;",
            "type S = string with min_length -1;",
            "type S = string with chars chinese;",
            "type S = string with chars english;",
            "type S = string with chars ascii_letters or chars han;",
        ):
            with self.subTest(source=source), self.assertRaises(ConstraintSyntaxError):
                parse(source)

    def test_exact_length_annotation(self):
        d = to_zorde_descriptor(
            parse("@Size(min=10, max=10) type Exact10 = string;")
        )
        self.assertEqual((d["minimum"], d["maximum"]), (10, 10))

    def test_numeric_exclusive_bounds_normalize_without_runtime_exclusive_flags(self):
        d = to_zorde_descriptor(
            parse("type Digit = int with value gt 0 and value lt 10;")
        )
        self.assertEqual((d["minimum"], d["maximum"]), (1, 9))
        self.assertNotIn("min_exclusive", d)
        self.assertNotIn("max_exclusive", d)

    def test_effective_exclusions_are_preserved_for_runtime_kernel(self):
        d = to_zorde_descriptor(parse(
            "type Not42 = int with value gte 1 and value lte 100 and value ne 42;"
        ))
        self.assertEqual(d["excluded"], [42])
        self.assertIn("sorted_unique_exclusions", d["runtime_requirements"])

    def test_redundant_exclusions_are_normalized_away(self):
        plain = to_zorde_descriptor(parse(
            "type Port = int with value gte 1 and value lte 65535;"
        ))
        redundant = to_zorde_descriptor(parse(
            "type Port = int with value gte 1 and value lte 65535 "
            "and value ne 0 and value ne 65536;"
        ))
        self.assertEqual(plain, redundant)

    def test_nominal_identity_requires_compiler_qualified_name(self):
        refined = parse("define newtype Name(string) with length gte 1;")
        with self.assertRaises(ConstraintSyntaxError):
            to_zorde_descriptor(refined)
        with self.assertRaises(ConstraintSyntaxError):
            to_zorde_descriptor(refined, "Name")
        a = to_zorde_descriptor(refined, "app.auth.Name")
        b = to_zorde_descriptor(refined, "other.auth.Name")
        self.assertEqual(a["nominal_identity"], "app.auth.Name")
        self.assertNotEqual(a["fingerprint"], b["fingerprint"])

    def test_equivalent_source_surfaces_emit_identical_descriptor(self):
        annotation = to_zorde_descriptor(parse(
            "@Range(min=1,max=65535) type Port = int;"
        ))
        source = to_zorde_descriptor(parse(
            "type Port = int with value >= 1 and value <= 65535;"
        ))
        self.assertEqual(annotation, source)
        self.assertEqual(
            annotation["fingerprint"],
            "6162f74ca5d074640b2415eae37297ce299c6e1d1c77b6e9afb76ad686049cd2",
        )

    def test_bare_nominal_has_full_domain_but_distinct_identity(self):
        d = to_zorde_descriptor(
            parse("define newtype Counter(int);"), "app.Counter"
        )
        self.assertEqual(d["minimum"], -(1 << 63))
        self.assertEqual(d["maximum"], (1 << 63) - 1)
        self.assertEqual(d["excluded"], [])
        self.assertEqual(d["nominal_identity"], "app.Counter")


if __name__ == "__main__":
    unittest.main()
