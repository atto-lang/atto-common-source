"""Source-only integrity tests; never claim compiler or NativeAOT parity."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "fixtures/structural-infer-aggregate-v1/manifest.json"

class StructuralInferAggregateContractTests(unittest.TestCase):
    def test_closed_case_matrix_and_zero_unearned_receipts(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual("proposed-not-executable", data["status"])
        self.assertEqual(["java", "llvm", "net", "wasm"], data["backends"])
        self.assertEqual(set(data["backends"]), set(data["evidence"]))
        self.assertEqual({"unverified"}, set(data["evidence"].values()))
        self.assertTrue((ROOT / data["spec"]).is_file())
        cases = data["cases"]
        self.assertGreaterEqual(len(cases), 14)
        ids = [case["id"] for case in cases]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({"accept", "reject"}, {case["expect"] for case in cases})
        for case in cases:
            self.assertIn("fnc ", case["source"])
            self.assertIn(case["expect"], {"accept", "reject"})
            if "source_file" in case:
                fixture_root = (ROOT / "fixtures/structural-infer-aggregate-v1").resolve()
                path = (ROOT / case["source_file"]).resolve()
                self.assertEqual(".atto", path.suffix)
                self.assertTrue(path.is_relative_to(fixture_root),
                    "fixture cannot escape canonical aggregate corpus")
                self.assertEqual(case["source"] + "\\n",
                    path.read_text(encoding="utf-8"),
                    "manifest source and .atto fixture must remain byte-identical")

            if case["expect"] == "accept":
                self.assertEqual(42, case["exit_code"])
            else:
                self.assertNotIn("exit_code", case)

    def test_language_decision_coverage(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        by_id = {case["id"]: case["source"] for case in data["cases"]}
        for key in ("p01_infer_struct_spread", "p02_infer_record_spread",
                    "p04_structural_readonly_projection", "p05_retype_field",
                    "n06_structural_escape", "n08_dynamic_spread",
                    "n09_noncopy_nested_spread"):
            self.assertIn(key, by_id)
        self.assertIn("infer struct{...", by_id["p01_infer_struct_spread"])
        self.assertIn("infer record{...", by_id["p02_infer_record_spread"])
        self.assertIn("structural HasValue", by_id["p04_structural_readonly_projection"])

if __name__ == "__main__":
    unittest.main()
