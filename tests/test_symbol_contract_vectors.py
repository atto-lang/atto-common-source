"""Self-check portable Symbol v1 contract vectors.

Not a test of the Java/Graal or LLVM implementations. Backend adapters must
compile and run identical guest source before claiming any Symbol parity.
"""
import json
import unittest
import unicodedata
import uuid
from pathlib import Path

VECTORS = Path(__file__).resolve().parents[1] / "fixtures" / "symbols.v1.json"
BIDI_CONTROLS = {0x061C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}


def canonical_key(value):
    if not isinstance(value, str):
        raise ValueError("Symbol name must be text")
    # A strict UTF-8 conversion rejects unpaired UTF-16 surrogate code points.
    value.encode("utf-8", "strict")
    normalized = unicodedata.normalize("NFC", value)
    if not normalized or len(normalized.encode("utf-8")) > 256:
        raise ValueError("empty or oversized Symbol name")
    if any(ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F
           or ord(ch) in BIDI_CONTROLS for ch in normalized):
        raise ValueError("unsafe Symbol code point")
    return normalized


def canonical_identity(value):
    if value["kind"] not in ("process", "stable"):
        raise ValueError("unknown Symbol kind")
    key = canonical_key(value["name"])
    if value["kind"] == "stable":
        try:
            key = str(uuid.UUID(key))
        except (ValueError, AttributeError) as error:
            raise ValueError("invalid stable UUID") from error
    return value["kind"], key


def decode_wire(value):
    if not isinstance(value, dict) or set(value) != {"$symbol", "name"}:
        raise ValueError("invalid Symbol wire members")
    kind = value["$symbol"]
    key = canonical_key(value["name"])
    if key != value["name"]:
        raise ValueError("wire Symbol is not NFC canonical")
    if kind == "stable":
        try:
            if str(uuid.UUID(key)) != key:
                raise ValueError("noncanonical stable UUID")
        except (ValueError, AttributeError) as error:
            raise ValueError("invalid stable UUID") from error
    elif kind != "process":
        raise ValueError("unknown Symbol kind")
    # No global table is accessed or mutated here.
    return kind, key


def reject_duplicate_members(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate wire member")
        result[key] = value
    return result


def admitted_symbol(case, visibility):
    """Illustrative policy evaluator; NOT an Oreslang runtime security check."""
    if case["policy"] == "trusted":
        return True
    if case["policy"] != "untrusted" or case["kind"] != "process":
        return False
    public = visibility["std_core_manifest"]["allowed_process_keys"]
    if case["name"] in public:
        return True
    return any(
        rule["tenant"] == case["tenant"]
        and rule["endpoint"] == case["endpoint"]
        and rule["protocol"] == case["protocol"]
        and case["name"] in rule["allowed_process_keys"]
        for rule in visibility["scoped_userland_exports"]
    )


class SymbolContractVectorsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
        assert cls.vectors["schema_version"] == "symbols-v1-proposal"

    def test_equality_vectors(self):
        for case in self.vectors["equality"]:
            with self.subTest(case=case["label"]):
                equal = canonical_identity(case["left"]) == canonical_identity(case["right"])
                self.assertIs(equal, case["equal"])

    def test_symbols_are_not_strings(self):
        for case in self.vectors["distinct_types"]:
            self.assertIs(case["equal"], False)
            self.assertEqual(canonical_key(case["string"]), case["symbol"]["name"])
            self.assertNotEqual(type(case["string"]), tuple)

    def test_valid_names(self):
        for case in self.vectors["valid_keys"]:
            with self.subTest(case=case["label"]):
                self.assertEqual(canonical_key(case["value"]), case["value"])

    def test_invalid_names(self):
        for case in self.vectors["invalid_keys"]:
            with self.subTest(case=case["label"]):
                if "utf8_hex" in case:
                    with self.assertRaises(UnicodeDecodeError):
                        bytes.fromhex(case["utf8_hex"]).decode("utf-8", "strict")
                else:
                    with self.assertRaises((ValueError, UnicodeEncodeError)):
                        canonical_key(case["value"])

    def test_wire_never_interns(self):
        for case in self.vectors["wire_decoding"]:
            with self.subTest(case=case["label"]):
                before = 0
                if case["accept"]:
                    self.assertEqual(len(decode_wire(case["input"])), 2)
                else:
                    with self.assertRaises(ValueError):
                        decode_wire(case["input"])
                self.assertEqual(before, case["permanent_table_delta"])

    def test_core_and_private_userland_admission_matrix(self):
        visibility = self.vectors["visibility_policy"]
        self.assertTrue(set(visibility["std_core_manifest"]["allowed_process_keys"]).isdisjoint(
            visibility["private_userland_process_keys"]))
        for case in self.vectors["admission"]:
            with self.subTest(case=case["label"]):
                self.assertIs(admitted_symbol(case, visibility), case["accept"])
                if "permanent_table_delta" in case:
                    self.assertEqual(case["permanent_table_delta"], 0)

    def test_hash_symbol_syntax_contract_vectors(self):
        # This checks the proposed fixture matrix, not Java/LLVM execution.
        cases = self.vectors["syntax"]
        self.assertEqual(len({c["source"] for c in cases}), len(cases))
        self.assertEqual(
            {c["expected"] for c in cases},
            {"accept", "type_error", "parse_error"},
        )
        expected = {
            "final Symbol foo: #abc": "accept",
            "final int foo: #ready": "type_error",
            "let x = infer struct{foo: #ready}": "accept",
            "let y = #'ready foo'": "accept",
            'let y = #"ready foo"': "accept",
            "let y = #class": "accept",
            "let y = :ready": "parse_error",
            "let x = infer struct{foo: :ready}": "parse_error",
            "let y = #": "parse_error",
            "let y = # ready": "parse_error",
            "let y = #123": "parse_error",
            "let y = new Symbol('ready')": "type_error",
            "let y = Symbol.process('ready')": "accept",
        }
        actual = {c["source"]: c["expected"] for c in cases}
        for snippet, outcome in expected.items():
            with self.subTest(snippet=snippet):
                self.assertEqual(actual[snippet], outcome)

    def test_literal_equivalence_and_quoted_spelling(self):
        cases = {c["label"]: c for c in self.vectors["literal_equivalence"]}
        same = cases["single and double quotes same canonical name"]
        self.assertEqual(same["left_source"], "#'ready foo'")
        self.assertEqual(same["right_source"], '#"ready foo"')
        self.assertEqual(canonical_identity(same), ("process", "ready foo"))
        self.assertIs(same["same"], True)
        factory = cases["unquoted symbol equals trusted factory by kind and key"]
        self.assertEqual(canonical_identity(factory), ("process", "ready"))
        self.assertIs(factory["same"], True)
        for case in self.vectors["literal_equivalence"]:
            with self.subTest(label=case["label"]):
                self.assertIsInstance(case["same"], bool)
                self.assertIsInstance(case["left_source"], str)
                self.assertIsInstance(case["right_source"], str)

    def test_keyed_container_contract_is_explicitly_staged(self):
        cases = self.vectors["keyed_containers"]
        self.assertEqual(len(cases), len({case["source"] for case in cases}))
        self.assertEqual({case["kind"] for case in cases},
                         {"map", "record", "struct", "class"})
        expected = {"future_accept", "type_error", "duplicate_key_error"}
        self.assertEqual({case["expect"] for case in cases}, expected)
        self.assertIn("infer struct{foo: 1, [#foo]: 2}",
                      {case["source"] for case in cases})
        self.assertIn("let r = infer struct{foo: 1}; r[#foo]",
                      {case["source"] for case in cases if case["expect"] == "type_error"})
        self.assertTrue(any("NFC" in c["note"] for c in cases))
        # These fixtures are design expectations; this self-check never runs a guest compiler.

    def test_duplicate_wire_fields_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            json.loads('{"$symbol":"process","name":"ok","name":"evil"}',
                       object_pairs_hook=reject_duplicate_members)


if __name__ == "__main__":
    unittest.main()
