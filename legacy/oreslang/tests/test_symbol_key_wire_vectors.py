"""Reference-only tagged Symbol property-key v1 wire vector checks.

This is NOT an execution test for the Java/GraalVM or LLVM codecs.
"""
import json
import struct
import unittest
import unicodedata
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "symbol-key-wire.v1.json"
TAG_NAMES = {0: "string", 1: "process", 2: "stable"}


def decode_key(blob):
    if len(blob) < 6 or blob[:3] != b"OK\x01":
        raise ValueError("invalid magic, version or frame size")
    kind, length = struct.unpack(">BH", blob[3:6])
    if kind not in TAG_NAMES or length != len(blob) - 6:
        raise ValueError("invalid kind or byte length")
    if kind == 0 and length > 16_384 or kind != 0 and not (1 <= length <= 256):
        raise ValueError("key length budget")
    text = blob[6:].decode("utf-8", errors="strict")
    if kind != 0:
        if unicodedata.normalize("NFC", text) != text:
            raise ValueError("noncanonical NFC")
        if any(ord(ch) < 0x20 or 0x7f <= ord(ch) <= 0x9f
               or unicodedata.category(ch) == "Cf" for ch in text):
            raise ValueError("forbidden Symbol name")
        if kind == 2:
            import uuid
            if str(uuid.UUID(text)) != text:
                raise ValueError("invalid stable Symbol UUID")
    return TAG_NAMES[kind], text


def encode_key(kind, value):
    if kind not in TAG_NAMES.values():
        raise ValueError("unknown key kind")
    encoded = value.encode("utf-8", errors="strict")
    maximum = 16_384 if kind == "string" else 256
    if len(encoded) > maximum or kind != "string" and not encoded:
        raise ValueError("oversized or empty Symbol key")
    tag = next(tag for tag, name in TAG_NAMES.items() if name == kind)
    return b"OK\x01" + struct.pack(">BH", tag, len(encoded)) + encoded


def decode_distinct_keys(frames, max_keys=4096, max_bytes=1_048_576):
    if len(frames) > max_keys:
        raise ValueError("too many keys")
    used = 0
    seen = set()
    decoded = []
    for frame in frames:
        used += len(frame)
        if used > max_bytes:
            raise ValueError("tagged keys exceed aggregate budget")
        key = decode_key(frame)
        if key in seen:
            raise ValueError("duplicate logical key")
        seen.add(key)
        decoded.append(key)
    return tuple(decoded)


class TaggedSymbolKeyVectorsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vectors = json.loads(FIXTURE.read_text(encoding="utf-8"))
        assert cls.vectors["schema_version"] == "tagged-symbol-keys-v1-proposal"

    def test_golden_roundtrips(self):
        for entry in self.vectors["golden"]:
            with self.subTest(entry=entry["label"]):
                data = bytes.fromhex(entry["hex"])
                self.assertEqual(decode_key(data), (entry["kind"], entry["key"]))
                self.assertEqual(encode_key(entry["kind"], entry["key"]), data)

    def test_invalid_encodings_fail_closed(self):
        for entry in self.vectors["invalid"]:
            with self.subTest(entry=entry["label"]):
                with self.assertRaises((ValueError, UnicodeError)):
                    decode_key(bytes.fromhex(entry["hex"]))

    def test_nominal_key_namespace(self):
        entries = self.vectors["golden"]
        for pair in self.vectors["distinct_key_pairs"]:
            actual = decode_key(bytes.fromhex(entries[pair["left"]]["hex"]))
            other = decode_key(bytes.fromhex(entries[pair["right"]]["hex"]))
            self.assertIs(actual == other, pair["equal"])

    def test_immutable_key_set_and_duplicate_rejection(self):
        original = encode_key("process", "foo")
        frames = [original, encode_key("string", "foo")]
        decoded = decode_distinct_keys(frames)
        self.assertEqual(decoded, (("process", "foo"), ("string", "foo")))
        self.assertIsInstance(decoded, tuple)
        with self.assertRaises(ValueError):
            decode_distinct_keys([original, encode_key("process", "foo")])

    def test_total_bytes_budget(self):
        frames = [encode_key("string", "x" * 16_000 + str(i))
                  for i in range(70)]
        with self.assertRaises(ValueError):
            decode_distinct_keys(frames)

    def test_legacy_text_key_hash_prefix_remains_text(self):
        tagged = encode_key("string", "#foo")
        self.assertEqual(decode_key(tagged), ("string", "#foo"))
        self.assertNotEqual(decode_key(tagged), ("process", "foo"))


if __name__ == "__main__":
    unittest.main()
