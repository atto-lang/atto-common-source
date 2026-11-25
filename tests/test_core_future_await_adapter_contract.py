#!/usr/bin/env python3
"""Static integrity for the freestanding await adapter proposal.

IMPORTANT: These tests do NOT compile or execute guest AttoLang source.
"""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = ROOT / "contracts/v1/await-adapter/cases.json"
FIXTURES = CASES.parent / "fixtures"
CORE = ROOT / "library/ores.core/future.atto"
DOC = ROOT / "docs/CORE_FUTURE_AWAIT_ADAPTER_V1.md"
TARGETS = {".java", ".llvm", ".wasm", ".forge", ".net", ".rs"}


def unique_keys(items):
    out = {}
    for key, value in items:
        if key in out:
            raise ValueError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


class CoreFutureAwaitAdapterContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(CASES.read_text(encoding="utf-8"),
                                  object_pairs_hook=unique_keys)

    def test_core_source_is_capture_free_and_has_no_host_imports(self):
        source = CORE.read_text(encoding="utf-8")
        self.assertIn("define module future as", source)
        self.assertIn(
            "pub fnc await<T> = susp |pending: Future<T>| -> await pending;",
            source,
        )
        self.assertEqual(source.count("pub fnc await<T>"), 1)
        for prohibited in ("import std", "ores.std", "import java",
                           "import os", "std.io", "spawn ", "new Task"):
            self.assertNotIn(prohibited, source)
        self.assertNotIn("await()", source)

    def test_manifest_has_pending_executable_proof_in_every_backend(self):
        doc = self.manifest
        self.assertEqual(doc["schema"], "ores-core-future-await-adapter-v1")
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["status"], "pending-guest-execution")
        self.assertEqual(doc["core_source"], "library/ores.core/future.atto")
        self.assertEqual(set(doc["targets"]), TARGETS)
        self.assertEqual(len(doc["targets"]), len(TARGETS))
        self.assertEqual(doc["candidate_branch"]["status"], "source-changes-unverified")
        self.assertTrue(doc["cases"])
        seen = set()
        for case in doc["cases"]:
            with self.subTest(case=case["id"]):
                self.assertNotIn(case["id"], seen)
                seen.add(case["id"])
                self.assertEqual(case["fixture"], case["id"] + ".atto")
                self.assertEqual(set(case["pending"]), TARGETS)
                self.assertEqual(case["verified"], [])
                self.assertIn(case["expected"], {"accept-execute", "reject"})
                if case["expected"] == "accept-execute":
                    self.assertEqual(case["oracle"], {"exit_code": 42})
                else:
                    self.assertEqual(set(case["oracle"]), {"diagnostic_class"})
                self.assertTrue((FIXTURES / case["fixture"]).is_file())
        self.assertEqual({p.name for p in FIXTURES.glob("*.atto")},
                         {c["fixture"] for c in doc["cases"]})
        self.assertEqual(seen, {
            "future-41-42", "caret-bind-42", "reject-factory",
            "reject-nonsusp", "reject-scalar", "reject-bare-await",
            "reject-moved-future",
        })

    def test_public_positive_source_and_failure_fixture_shapes(self):
        future = (FIXTURES / "future-41-42.atto").read_text()
        capture = (FIXTURES / "caret-bind-42.atto").read_text()
        self.assertIn("return pending |> std.await |> transform_result;", future)
        self.assertIn("return 41;", future)
        self.assertIn(">> val result: int;", capture)
        self.assertIn("^ pending", capture)
        self.assertIn("|> std.await", capture)
        negatives = {
            "reject-factory": "std.await()",
            "reject-nonsusp": "pub fnc use_future",
            "reject-scalar": "42 |> std.await",
            "reject-bare-await": "pending |> await",
            "reject-moved-future": "return await pending;",
        }
        for name, fragment in negatives.items():
            with self.subTest(name=name):
                self.assertIn(fragment,
                              (FIXTURES / f"{name}.atto").read_text())

    def test_contract_explicitly_denies_false_parity(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("Only two public library profiles", text)
        self.assertIn("not a zero-argument function", text)
        self.assertIn("not certified", text)
        self.assertIn("pending", text.lower())
        self.assertIn("Future<Result<T,E>>", text)
        self.assertIn("steps=[]", text)


if __name__ == "__main__":
    unittest.main()
