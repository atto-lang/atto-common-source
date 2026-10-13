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

    def test_duplicate_wire_fields_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            json.loads('{"$symbol":"process","name":"ok","name":"evil"}',
                       object_pairs_hook=reject_duplicate_members)


if __name__ == "__main__":
    unittest.main()
