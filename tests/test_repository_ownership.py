"""Negative mutation tests for AttoLang repository routing and trust checks."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "governance"))
from validate_ownership import InventoryError, remote, validate


class OwnershipContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "governance/repositories.json").read_text(encoding="utf-8"))
        cls.map_text = (ROOT / "docs/REPOSITORY_MAP.md").read_text(encoding="utf-8")
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")

    def check_manifest_bad(self, mutation):
        doc = copy.deepcopy(self.manifest)
        mutation(doc)
        with self.assertRaises(InventoryError):
            validate(json.dumps(doc), self.map_text, self.readme)

    def check_map_bad(self, mutate):
        with self.assertRaises(InventoryError):
            validate(json.dumps(self.manifest), mutate(self.map_text), self.readme)

    def test_expected_full_inventory(self):
        result = validate(json.dumps(self.manifest), self.map_text, self.readme)
        self.assertEqual(len(result), 68)
        self.assertEqual(len([x for x in result if x["visibility"] == "public"]), 2)

    def test_wrong_schema(self):
        self.check_manifest_bad(lambda d: d.update(schema_version=2))

    def test_wrong_organization(self):
        self.check_manifest_bad(lambda d: d.update(organization="another-org"))

    def test_wrong_expected_count(self):
        self.check_manifest_bad(lambda d: d.update(expected_count=67))

    def test_untrusted_public_classification(self):
        self.check_manifest_bad(lambda d: d.update(sensitivity="public"))

    def test_provenance_drift(self):
        self.check_manifest_bad(lambda d: d.update(provenance="README.md"))

    def test_unknown_top_level(self):
        self.check_manifest_bad(lambda d: d.update(unsafe_approval=True))

    def test_missing_repository(self):
        self.check_manifest_bad(lambda d: d["repos"].pop())

    def test_duplicate_repository(self):
        self.check_manifest_bad(lambda d: d["repos"].__setitem__(1, copy.deepcopy(d["repos"][0])))

    def test_invalid_repo_slug(self):
        self.check_manifest_bad(lambda d: d["repos"][0].update(name="../escape"))

    def test_empty_scope(self):
        self.check_manifest_bad(lambda d: d["repos"][0].update(summary=""))

    def test_wrong_category(self):
        self.check_manifest_bad(lambda d: d["repos"][0].update(category="Cloud deployments"))

    def test_private_repo_labeled_public(self):
        self.check_manifest_bad(lambda d: d["repos"][1].update(visibility="public"))

    def test_public_org_hidden_as_private(self):
        self.check_manifest_bad(lambda d: d["repos"][0].update(visibility="private"))

    def test_map_summary_drift(self):
        self.check_map_bad(lambda m: m.replace("Normative language semantics and language-change proposals", "Unrelated project", 1))

    def test_repo_link_domain_forged(self):
        self.check_map_bad(lambda m: m.replace("https://github.com/atto-lang/atto-spec", "https://github.com/attacker/atto-spec", 1))

    def test_label_url_mismatch(self):
        self.check_map_bad(lambda m: m.replace("https://github.com/atto-lang/atto-spec", "https://github.com/atto-lang/atto-source.rs", 1))

    def test_missing_category_heading(self):
        self.check_map_bad(lambda m: m.replace("### Compilers, code generation and runtime", "#### Compilers, code generation and runtime", 1))

    def test_duplicate_map_row(self):
        def mutate(m):
            line = next(x for x in m.splitlines() if "github.com/atto-lang/atto-spec)" in x)
            return m + "\n" + line + "\n"
        self.check_map_bad(mutate)

    def test_missing_private_warning(self):
        self.check_map_bad(lambda m: m.replace("private", "nonpublic"))

    def test_missing_wasmtime_boundary(self):
        self.check_map_bad(lambda m: m.replace("Wasmtime", "another runtime"))

    def test_root_readme_must_link_routing_map(self):
        with self.assertRaises(InventoryError):
            validate(json.dumps(self.manifest), self.map_text, self.readme.replace("docs/REPOSITORY_MAP.md", "docs/NONE.md"))

    def test_remote_refuses_missing_token_even_for_empty_input(self):
        with self.assertRaisesRegex(InventoryError, "ATTO_AUDIT_TOKEN"):
            remote([], "")


if __name__ == "__main__":
    unittest.main()
