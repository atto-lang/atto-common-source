"""Static fixture integrity checks: candidate support is not executed parity."""
import copy
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "contracts/v1/value-pipeline"
TARGETS = {".java", ".llvm", ".net", ".forge", ".wasm"}
CASE_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
DIAGNOSTIC = re.compile(r"[a-z][a-z0-9-]*\Z")


class ValuePipelineContractTests(unittest.TestCase):
    def check_registry(self, doc, root=ROOT):
        self.assertIs(type(doc), dict)
        self.assertIs(type(doc.get("version")), int)
        self.assertEqual(doc["version"], 1)
        targets = doc.get("targets")
        self.assertIsInstance(targets, list)
        self.assertEqual(len(targets), len(TARGETS))
        self.assertTrue(all(isinstance(t, str) for t in targets))
        self.assertEqual(set(targets), TARGETS)
        cases = doc.get("cases")
        self.assertIsInstance(cases, list)
        self.assertGreaterEqual(len(cases), 9, "v1 must not silently drop registered cases")
        seen_ids, seen_fixtures = set(), set()
        for case in cases:
            self.assertIsInstance(case, dict)
            case_id, fixture = case.get("id"), case.get("fixture")
            with self.subTest(case=case_id):
                self.assertIsInstance(case_id, str)
                self.assertRegex(case_id, CASE_ID)
                self.assertEqual(fixture, case_id + ".ores")
                self.assertNotIn(case_id, seen_ids)
                self.assertNotIn(fixture, seen_fixtures)
                seen_ids.add(case_id)
                seen_fixtures.add(fixture)
                self.assertTrue((root / "fixtures" / fixture).is_file())
                implemented = case.get("candidate_implementations")
                pending = case.get("pending")
                self.assertIsInstance(implemented, list)
                self.assertIsInstance(pending, list)
                self.assertTrue(all(isinstance(t, str) for t in implemented + pending))
                self.assertEqual(len(implemented), len(set(implemented)))
                self.assertEqual(len(pending), len(set(pending)))
                self.assertFalse(set(implemented) & set(pending))
                self.assertEqual(set(implemented) | set(pending), TARGETS)
                self.assertIn(case.get("expected"), {"accept-execute", "reject"})
                oracle = case.get("oracle")
                self.assertIsInstance(oracle, dict)
                if case["expected"] == "accept-execute":
                    self.assertEqual(len(oracle), 1)
                    if "exit_code" in oracle:
                        self.assertIs(type(oracle["exit_code"]), int)
                        self.assertGreaterEqual(oracle["exit_code"], 0)
                        self.assertLessEqual(oracle["exit_code"], 255)
                    else:
                        self.assertIsInstance(oracle.get("result"), str)
                        self.assertTrue(oracle["result"].strip())
                else:
                    self.assertEqual(set(oracle), {"diagnostic_class", "diagnostic_contains"})
                    self.assertIsInstance(oracle["diagnostic_class"], str)
                    self.assertRegex(oracle["diagnostic_class"], DIAGNOSTIC)
                    fragments = oracle["diagnostic_contains"]
                    self.assertIsInstance(fragments, dict)
                    self.assertTrue(fragments)
                    self.assertTrue(set(fragments) <= set(implemented))
                    self.assertTrue(all(isinstance(f, str) and f.strip()
                                        for f in fragments.values()))
                self.assertNotIn("verified", case)
        fixture_files = {p.name for p in (root / "fixtures").glob("*.ores") if p.is_file()}
        self.assertEqual(seen_fixtures, fixture_files,
                         "registry and fixture directory must have identical membership")

    def test_registry_has_complete_nonoverlapping_backend_statuses(self):
        doc = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        self.check_registry(doc)

    def test_malformed_registry_is_rejected(self):
        original = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        mutations = {}
        def add(label, mutate):
            doc = copy.deepcopy(original)
            mutate(doc)
            mutations[label] = doc

        add("duplicate_id", lambda d: d["cases"][1].update(id=d["cases"][0]["id"]))
        add("duplicate_candidate", lambda d: d["cases"][0]["candidate_implementations"].append(".java"))
        add("duplicate_pending", lambda d: d["cases"][0]["pending"].append(".net"))
        add("conflicting_status", lambda d: d["cases"][0]["pending"].append(".java"))
        add("unknown_target", lambda d: d["cases"][0]["pending"].append(".new"))
        add("registry_shrink", lambda d: d["cases"].pop())
        add("path_traversal", lambda d: d["cases"][0].update(fixture="../outside.ores"))
        add("wrong_fixture", lambda d: d["cases"][0].update(fixture="result-map-error.ores"))
        add("boolean_exit", lambda d: next(c for c in d["cases"] if "exit_code" in c["oracle"])["oracle"].update(exit_code=True))
        add("invalid_exit", lambda d: next(c for c in d["cases"] if "exit_code" in c["oracle"])["oracle"].update(exit_code=256))
        add("blank_diagnostic", lambda d: next(c for c in d["cases"] if c["expected"] == "reject")["oracle"].update(diagnostic_class=""))
        add("unproven_diagnostic", lambda d: next(c for c in d["cases"] if c["expected"] == "reject")["oracle"]["diagnostic_contains"].update({".net": "unproven"}))
        add("duplicated_target", lambda d: d["targets"].append(".java"))
        add("false_verification", lambda d: d["cases"][0].update(verified=True))
        for label, doc in mutations.items():
            with self.subTest(mutation=label):
                with self.assertRaises(AssertionError):
                    self.check_registry(doc)

    def test_every_fixture_declared_once(self):
        doc = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))
        fixtures = [case["fixture"] for case in doc["cases"]]
        self.assertEqual(len(fixtures), len(set(fixtures)))
        self.assertEqual(set(fixtures), {
            item.name for item in (ROOT / "fixtures").glob("*.ores")
        })


if __name__ == "__main__":
    unittest.main()
