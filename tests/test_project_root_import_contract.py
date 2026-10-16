"""Fail-closed source-only checks for the five-backend +/ import contract.

This is a fixture consistency gate, NOT a compiler, linked-module, or CI
parity result. Backend promotion requires independently executed evidence.
"""
import json
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

    def test_unresolved_root_authority_is_explicit(self):
        decisions = self.contract["open_decisions"]
        self.assertEqual([d["id"] for d in decisions], ["root-anchor-vs-project-root"])
        self.assertIn("[project].root", decisions[0]["question"])


if __name__ == "__main__":
    unittest.main()
