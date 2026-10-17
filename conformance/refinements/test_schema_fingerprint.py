import unittest

from conformance.refinements.reference import parse, ConstraintSyntaxError
from conformance.refinements.schema_fingerprint import descriptor


class SchemaFingerprintTests(unittest.TestCase):
    def test_java_port_fingerprint_fixture(self):
        variations = [
            parse("@Min(1) @Max(65535) type Port = int;"),
            parse("@Range(min=1,max=65535) type Port = int;"),
            parse("type Port = int with value gte 1 and value lte 65535;"),
            parse("type Port = int with value >= 1 and value <= 65535;"),
        ]
        hashes = {descriptor(contract).fingerprint for contract in variations}
        self.assertEqual(hashes, {
            "6162f74ca5d074640b2415eae37297ce299c6e1d1c77b6e9afb76ad686049cd2"
        })

    def test_nominal_qualified_identity_fixture(self):
        name = parse("define newtype Username(string) with length gte 1;")
        a = descriptor(name, "app.Username")
        b = descriptor(name, "other.Username")
        self.assertEqual(
            a.fingerprint,
            "8b8a65194fb051d69d27590862fe4522d5e8be3dcfb263e1445f8982f5203540",
        )
        self.assertNotEqual(a.fingerprint, b.fingerprint)
        for identity in (None, "Username", "app.Username\nattacker", "app..Username"):
            with self.subTest(identity=identity):
                with self.assertRaises(ConstraintSyntaxError):
                    descriptor(name, identity)

    def test_bare_nominal_has_explicit_full_domain(self):
        bare_string = descriptor(parse("define newtype Bare(string);"), "app.Bare")
        bare_int = descriptor(parse("define newtype Bare(int);"), "app.Bare")
        self.assertEqual(bare_string.minimum, 0)
        self.assertEqual(bare_string.maximum, (1 << 63) - 1)
        self.assertEqual(bare_int.minimum, -(1 << 63))
        self.assertEqual(bare_int.maximum, (1 << 63) - 1)
        self.assertNotEqual(bare_string.fingerprint, bare_int.fingerprint)
        self.assertEqual(bare_string.excluded, ())
        self.assertEqual(bare_string.nominal_identity, "app.Bare")

    def test_exclusion_normalization_is_order_independent(self):
        first = descriptor(parse(
            "type X = int with value gte 0 and value lte 100 and value ne 3 and value ne 7;"
        ))
        second = descriptor(parse(
            "type X = int with value ne 7 and value lte 100 and value ne 3 and value gte 0;"
        ))
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(first.excluded, (3, 7))

    def test_normalized_string_constraints_have_one_identity(self):
        a = descriptor(parse("@MinLength(1) @MaxLength(32) type Username = string;"))
        b = descriptor(parse("type Username = string with length >= 1 and length <= 32;"))
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
