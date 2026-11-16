"""Source-contract validator tests; not AttoLang compilation or guest execution."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "collection_factories", ROOT / "tools/check_collection_of_factories_v1.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MANIFEST = ROOT / "fixtures/collection-of-factories-v1/manifest.json"


class CollectionFactoryManifestTest(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(MANIFEST.read_text("utf-8"))

    def check_mutant(self, mutate, message):
        mutant = copy.deepcopy(self.document)
        mutate(mutant)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "manifest.json"
            path.write_text(json.dumps(mutant), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, message):
                MODULE.check(path)

    def test_all_nine_tilde_constructors_are_parser_rejections(self):
        tilde = [c for c in self.document["cases"] if c["id"].endswith("-tilde")]
        self.assertEqual(len(tilde), 9)
        self.assertTrue(all(c["expected"] == "REJECT" and c["phase"] == "parser"
                            for c in tilde))

    def test_positive_tilde_factory_regression_is_rejected(self):
        self.check_mutant(
            lambda d: d["cases"][1].update(expected="ACCEPT", phase="guest"),
            "removed tilde constructor must be a parser rejection")

    def test_missing_tilde_rejection_is_rejected(self):
        self.check_mutant(
            lambda d: d["cases"][1].update(source="const m = Map.of<string,int>(\"a\" => 1);"),
            "negative tilde fixture no longer exercises removed constructor")

    def test_baseline_is_source_only(self):
        self.assertEqual(MODULE.check(MANIFEST), 37)

    def test_false_backend_execution_credit_is_forbidden(self):
        self.check_mutant(lambda d: d["backend_status"].update(java="PASS"),
                          "not an execution/provenance receipt")
        self.check_mutant(lambda d: d.update(status="EXECUTED"),
                          "cannot claim executed")

    def test_duplicate_case_id_is_rejected(self):
        self.check_mutant(lambda d: d["cases"].append(copy.deepcopy(d["cases"][0])),
                          "duplicate or malformed")

    def test_family_coverage_does_not_disappear(self):
        self.check_mutant(
            lambda d: d["cases"].__setitem__(
                slice(None), [c for c in d["cases"] if c["family"] != "set"]),
            "missing positive/negative coverage")

    def test_authored_case_cannot_claim_guest_pass(self):
        self.check_mutant(lambda d: d["cases"][0].update(status="GUEST_PASS"),
                          "not an executed guest proof")

    def test_positive_must_reference_its_factory(self):
        self.check_mutant(lambda d: d["cases"][0].update(source="const m = unknown();"),
                          "does not exercise")


if __name__ == "__main__":
    unittest.main()
