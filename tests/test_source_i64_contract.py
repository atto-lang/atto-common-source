"""Adversarial checks of the frozen source-i64 corpus and independent arithmetic oracle."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "scripts/verify_source_i64_corpus.py"
spec = importlib.util.spec_from_file_location("corpus", FILE)
assert spec and spec.loader
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class SourceI64ContractTests(unittest.TestCase):
    def test_frozen_corpus_and_oracle(self):
        cases = gate.validate_bytes(gate.CORPUS.read_bytes())["cases"]
        self.assertEqual(len(cases), 7)
        self.assertEqual([gate.oracle(x["expression"]) for x in cases],
                         [int(x["expected"]) for x in cases])

    def test_reviewed_git_blob(self):
        b = gate.CORPUS.read_bytes()
        self.assertEqual(hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest(),
                         gate.GIT_BLOB_SHA1)

    def test_oracle_rejects_unsafe_or_unsupported_expressions(self):
        for expression in ("3/2", "2 ** 63", "foo()", "1;2", "1 or 2",
                           "9223372036854775807+1", "-9223372036854775808-1",
                           "3037000500*3037000500", "--9223372036854775808",
                           "(-9223372036854775808)*(-1)", "[1][0]",
                           "+" * 50 + "1"):
            with self.subTest(expression=expression):
                with self.assertRaises(gate.ContractError):
                    gate.oracle(expression)

    def test_i64_edges(self):
        self.assertEqual(gate.oracle("-9223372036854775808"), -(1 << 63))
        self.assertEqual(gate.oracle("9223372036854775807"), (1 << 63) - 1)
        self.assertEqual(gate.oracle("(-3)*5+2"), -13)

    def test_tampered_digest_fails_closed(self):
        b = gate.CORPUS.read_bytes()
        for altered in (b+b" ", b[:-1], b.replace(b"14",b"15",1), b"{}",
                        b" "*8193, b"\\xff"+b):
            with self.subTest(size=len(altered)):
                with self.assertRaises(gate.ContractError):
                    gate.validate_bytes(altered)

    def test_duplicate_json_keys_rejected_if_blob_is_re_reviewed(self):
        with self.assertRaises(gate.ContractError):
            gate.no_duplicate_keys([("expected","14"),("expected","15")])

    def test_invalid_json_constant_rejected(self):
        with self.assertRaises(gate.ContractError):
            gate.bad_constant("NaN")

if __name__ == "__main__":
    unittest.main()
