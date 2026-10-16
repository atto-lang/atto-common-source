"""Static fixture identity and candidate-maturity checks; NOT runtime parity evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "contracts/v1/value-pipeline"
TARGETS = {".java", ".llvm", ".net", ".forge", ".wasm"}


class ValuePipelineContractTests(unittest.TestCase):
    def test_registry_has_complete_nonoverlapping_backend_statuses(self):
        doc = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["version"], 1)
        self.assertEqual(set(doc["targets"]), TARGETS)
        self.assertGreaterEqual(len(doc["cases"]), 5)
        for case in doc["cases"]:
            with self.subTest(case=case["id"]):
                implemented = set(case["candidate_implementations"])
                pending = set(case["pending"])
                self.assertFalse(implemented & pending)
                self.assertEqual(implemented | pending, TARGETS)
                self.assertTrue((ROOT / "fixtures" / case["fixture"]).is_file())
                self.assertIn(case["expected"], {"accept-execute", "reject"})
                if case["expected"] == "accept-execute":
                    self.assertIn("oracle", case)
                self.assertNotIn("verified", case)

    def test_every_fixture_declared_once(self):
        doc = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        fixtures = [case["fixture"] for case in doc["cases"]]
        self.assertEqual(len(fixtures), len(set(fixtures)))
        self.assertEqual(set(fixtures), {
            item.name for item in (ROOT / "fixtures").glob("*.ores")
        })


if __name__ == "__main__":
    unittest.main()
