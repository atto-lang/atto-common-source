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
