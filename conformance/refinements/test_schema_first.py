import unittest
from conformance.refinements.reference import parse, ConstraintSyntaxError
from conformance.refinements.schema_first import infer_schema
from conformance.refinements.schema_fingerprint import descriptor


class StaticSchemaFirstParityTests(unittest.TestCase):
    def test_port_three_source_forms_one_type_and_runtime_rule(self):
        examples = [
            infer_schema("Port", "Zorde.int().min(1).max(65535)"),
            parse("@Min(1) @Max(65535) type Port = int;"),
            parse("type Port = int with value >= 1 and value <= 65535;"),
        ]
        hashes = {descriptor(schema).fingerprint for schema in examples}
        self.assertEqual(len(hashes), 1)
        for n in (-(1 << 63), -1, 0, 1, 443, 65535, 65536, (1 << 63) - 1):
            accepted = [schema.accepts(n) for schema in examples]
            self.assertEqual(accepted, [accepted[0]] * len(accepted))

    def test_zorde_integer_builder_matches_with_min_max_shorthand(self):
        examples = [
            infer_schema("Code", "Zorde.int().min(0).max(5)"),
            parse("@Range(min=0,max=5) type Code = int;"),
            parse("define type Code = int with min 0 and max 5;"),
            parse("type Code = int with value gte 0 and value lte 5;"),
        ]
        fingerprints = {descriptor(schema).fingerprint for schema in examples}
        self.assertEqual(fingerprints, {
            "827510a6eea2d9be501904db2a1ce1f840bb37d0ae8424db074edd24189673b2"
        })
        for candidate in (-1, 0, 3, 5, 6, 1.0, True):
            self.assertEqual(
                [schema.accepts(candidate) for schema in examples],
                [type(candidate) is int and 0 <= candidate <= 5] * len(examples)
            )

    def test_length_emoji_parity(self):
        a = infer_schema("Name", "Zorde.string().minLength(1).maxLength(32)")
        b = parse("@MinLength(1) @MaxLength(32) type Name = string;")
        self.assertEqual(descriptor(a), descriptor(b))
        for value in ("", "x", "😀", "e\u0301", "x" * 32, "x" * 33,
                      chr(0xD800), chr(0xDC00)):
            self.assertEqual(a.accepts(value), b.accepts(value))

    def test_hole_normalization_semantics(self):
        a = infer_schema("Port", "Zorde.int().min(1).max(65535).exclude(0)")
        b = infer_schema("Port", "Zorde.int().min(1).max(65535)")
        self.assertEqual(descriptor(a), descriptor(b))
        live = infer_schema("Port", "Zorde.int().min(1).max(3).exclude(2)")
        self.assertFalse(live.accepts(2))
        self.assertTrue(live.accepts(1))
        self.assertTrue(live.accepts(3))

    def test_empty_builder_infers_primitive_without_narrowing(self):
        a = descriptor(infer_schema("Raw", "Zorde.int()"))
        b = descriptor(infer_schema("Name", "Zorde.string()"))
        self.assertEqual((a.minimum, a.maximum), (-(1 << 63), (1 << 63) - 1))
        self.assertEqual((b.minimum, b.maximum), (0, (1 << 63) - 1))

    def test_untrusted_schema_code_cannot_infer_static_type(self):
        invalid = (
            "Zorde.int().min(x)",
            "Zorde.int().min(1.0)",
            "Zorde.string().min(1)",
            "Zorde.int().minLength(1)",
            "Zorde.string().minLength(-1)",
            "Zorde.int().min(2).max(1)",
            "Zorde.int().max(2).min(3)",
            "Zorde.int().min(1).max(3).exclude(1).exclude(2).exclude(3)",
            "Zorde.int().refine(someCallback)",
            "mySchemaFactory()",
            "Zorde.int().transform(x)",
            "Zorde.int().min(1); evil()",
            "Zorde.int().min(9223372036854775808)",
            "Zorde.int().min(-9223372036854775809)",
        )
        for source in invalid:
            with self.subTest(source=source), self.assertRaises(ConstraintSyntaxError):
                infer_schema("Port", source)


if __name__ == "__main__":
    unittest.main()
