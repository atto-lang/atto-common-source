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

# Frozen v1 baseline plus named-stage extension: additions are allowed, silent substitution is not.
REQUIRED_V1_CASES = {
    "scalar-left-associative", "result-map-error", "option-transpose",
    "reject-noncallable-stage", "reject-maperr-on-option",
    "option-map-aot", "result-chain-aot", "result-recovery-aot",
    "aot-option-result-composition",
    "scalar-named-first-argument", "reject-duplicate-forwarded-binding",
}


def load_unique_json(source):
    """Reject ambiguous duplicate keys at every depth before validating the registry."""
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate registry JSON key: {key}")
            result[key] = value
        return result
    return json.loads(source, object_pairs_hook=object_pairs)


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
        self.assertGreaterEqual(len(cases), 11, "v1 must not silently drop registered cases")
        seen_ids, seen_fixtures = set(), set()
        for case in cases:
            self.assertIsInstance(case, dict)
            case_id, fixture = case.get("id"), case.get("fixture")
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
        self.assertTrue(REQUIRED_V1_CASES <= seen_ids,
                        "all eleven registered v1 cases must remain registered")
        fixture_files = {p.name for p in (root / "fixtures").glob("*.ores") if p.is_file()}
        self.assertEqual(seen_fixtures, fixture_files,
                         "registry and fixture directory must have identical membership")

    def test_registry_has_complete_nonoverlapping_backend_statuses(self):
        doc = load_unique_json((ROOT / "cases.json").read_text(encoding="utf-8"))
        self.check_registry(doc)

    def test_malformed_registry_is_rejected(self):
        original = load_unique_json((ROOT / "cases.json").read_text(encoding="utf-8"))
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

    def test_duplicate_json_keys_fail_closed(self):
        text = (ROOT / "cases.json").read_text(encoding="utf-8")
        self.assertIn('"version": 1,', text)
        with self.assertRaisesRegex(ValueError, "duplicate registry JSON key"):
            load_unique_json(text.replace('"version": 1,',
                                          '"version": 1, "version": 1,', 1))
        self.assertIn('"exit_code": 7', text)
        with self.assertRaisesRegex(ValueError, "duplicate registry JSON key"):
            load_unique_json(text.replace('"exit_code": 7',
                                          '"exit_code": 7, "exit_code": 8', 1))

    def test_every_fixture_declared_once(self):
        doc = load_unique_json((ROOT / "cases.json").read_text(encoding="utf-8"))
        fixtures = [case["fixture"] for case in doc["cases"]]
        self.assertEqual(len(fixtures), len(set(fixtures)))
        self.assertEqual(set(fixtures), {
            item.name for item in (ROOT / "fixtures").glob("*.ores")
        })


if __name__ == "__main__":
    unittest.main()
