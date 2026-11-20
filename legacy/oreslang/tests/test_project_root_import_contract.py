"""Fail-closed source-only checks for the five-backend +/ import contract.

This is a fixture consistency gate, NOT a compiler, linked-module, or CI
parity result. Backend promotion requires independently executed evidence.
"""
import json
import posixpath
import unittest
from pathlib import Path, PurePosixPath

CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "project-root-import-v1.json"
EXPECTED = {
    "parent-child-direct-denied": "reject-nested-package",
    "parent-child-symlink-back-denied": "reject-nested-package",
    "parent-symlink-in-root-allowed": "resolve-parent-lib-helper",
    "child-own-root-allowed": "resolve-child-lib-child",
    "parent-child-dangling-manifest-denied": "reject-invalid-nested-marker",
}
ROOTS = {"parent": PurePosixPath("parent"), "nested": PurePosixPath("parent/nested")}
MARKERS = (PurePosixPath("parent/nested"), PurePosixPath("parent/dangling"))


def under(path, parent):
    return path == parent or parent in path.parents


def expected_namespace_result(case):
    root = ROOTS[case["importer_package"]]
    spelled = PurePosixPath(case["spelled_path"])
    physical = PurePosixPath(case["physical_target"])
    if not under(spelled, root) or not under(physical, root):
        return "reject-escape"
    # Even if canonical resolution returns a parent-owned file, traversing
    # the nested package by the spelled path must still reject.
    for marker in MARKERS:
        if marker != root and under(marker, root):
            if under(spelled, marker) or under(physical, marker):
                return ("reject-invalid-nested-marker" if marker.name == "dangling"
                        else "reject-nested-package")
    return ("resolve-child-lib-child" if root == ROOTS["nested"]
            else "resolve-parent-lib-helper")


class ProjectRootImportContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_namespace_cases_are_closed_and_unique(self):
        cases = self.contract["namespace_boundary_cases"]
        self.assertEqual(set(EXPECTED), {case["id"] for case in cases})
        self.assertEqual(len(EXPECTED), len(cases))
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertEqual(EXPECTED[case["id"]], case["expect"])
                self.assertTrue(case["specifier"].startswith("+/"))
                self.assertNotIn("..", case["specifier"].split("/"))
                self.assertEqual(case["expect"], expected_namespace_result(case))

    def test_mutated_symlink_expected_success_cannot_pass(self):
        case = next(item.copy() for item in self.contract["namespace_boundary_cases"]
                    if item["id"] == "parent-child-symlink-back-denied")
        case["expect"] = "resolve-parent-lib-helper"
        self.assertNotEqual(case["expect"], expected_namespace_result(case))

    def test_no_negative_only_parity_promotion(self):
        gates = self.contract["promotion_gates"]
        self.assertEqual(set(gates), {"safe_admission", "resolver", "execution", "provenance", "wasm"})
        self.assertIn("never imply", gates["safe_admission"])
        self.assertIn("execute", gates["execution"])
        self.assertIn("real wasm32", gates["wasm"])

    def test_relative_source_namespace_is_not_ambiguous(self):
        cases = self.contract["relative_source_cases"]
        self.assertEqual(len(cases), 4)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        files = set(self.contract["files"])
        for case in cases:
            with self.subTest(case=case["id"]):
                spec = case["specifier"]
                is_relative = spec.startswith("./") or spec.startswith("../")
                self.assertEqual(is_relative, case["namespace"] == "relative")
                origin = (posixpath.dirname(case["importer"]) if is_relative
                          else case["source_root"])
                resolved = posixpath.normpath(posixpath.join(origin, spec)) + ".ores"
                self.assertEqual(case["expect"], resolved)
                self.assertIn(resolved, files)

    def test_configured_root_extension_preserves_boundary_contract(self):
        cases = self.contract["namespace_parity_cases"]
        indexed = {case["id"]: case for case in cases}
        self.assertEqual(len(cases), len(indexed))
        self.assertEqual(len(cases), 32)
        self.assertEqual(indexed["project-root-field-subdir"]["expect"],
                         "app/src/helper.ores")
        self.assertEqual(indexed["nearest-legacy-before-ancestor-modern"]["expect_manifest"],
                         "app/child/.oreslangc.cfg.toml")
        self.assertEqual(indexed["modern-manifest-bare-cr-hidden-root-denied"]["error"],
                         "invalid-modern-manifest-line-ending")
        self.assertEqual(len(self.contract["namespace_boundary_cases"]), 5)
        self.assertEqual(len(self.contract["relative_source_cases"]), 4)
        decision = self.contract["open_decisions"][0]
        self.assertEqual(decision["status"], "backend-alignment-pending")
        self.assertIn("[project].root", decision["normative_resolution"])

    def test_unresolved_root_authority_is_explicit(self):
        decisions = self.contract["open_decisions"]
        self.assertEqual([d["id"] for d in decisions], ["root-anchor-vs-project-root"])
        self.assertIn("[project].root", decisions[0]["question"])


if __name__ == "__main__":
    unittest.main()
