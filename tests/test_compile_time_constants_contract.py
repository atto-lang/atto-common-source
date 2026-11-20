"""Portable reference checks for const-import design vectors.

These are NOT Java/GraalVM or LLVM compiler or runtime conformance tests.
"""
import json
import unittest
from pathlib import Path

DATA = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "compile-time-constants.v1.json")
    .read_text(encoding="utf-8")
)


def has_cycle(edges):
    children = {}
    for src, dst in edges:
        children.setdefault(src, []).append(dst)
        children.setdefault(dst, [])
    colors = {}

    def visit(node):
        state = colors.get(node, 0)
        if state == 1:
            return True
        if state == 2:
            return False
        colors[node] = 1
        for child in children.get(node, ()):
            if visit(child):
                return True
        colors[node] = 2
        return False

    return any(visit(node) for node in children if colors.get(node, 0) == 0)


class ConstantContractVectorTest(unittest.TestCase):
    def test_vectors_have_unique_names(self):
        rows = DATA["accepts"] + DATA["rejects"] + DATA["graphs"]
        self.assertEqual(len(rows), len({row["name"] for row in rows}))

    def test_circular_imports_independent_of_constant_cycles(self):
        for row in DATA["graphs"]:
            self.assertTrue(has_cycle(row["edges"]), row["name"])
            self.assertEqual(row["accept"], not has_cycle(row["constant_edges"]), row["name"])

    def test_reference_literals_have_consistent_types(self):
        for row in DATA["accepts"]:
            value = row["value"]
            if row["type"] == "int":
                self.assertIs(type(value), int)
            elif row["type"] == "String":
                self.assertIs(type(value), str)
            elif row["type"] == "Symbol":
                self.assertEqual(value["kind"], "global")
                self.assertTrue(value["name"])
            else:
                self.fail(f"unknown reference type {row['type']}")

    def test_rejection_categories_explicit(self):
        self.assertEqual(
            {row["reason"] for row in DATA["rejects"]},
            {"type-mismatch", "runtime-expression"},
        )


if __name__ == "__main__":
    unittest.main()
