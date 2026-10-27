#!/usr/bin/env python3
"""Contract-only regression: never report this as a guest compiler/runtime pass."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/v1/unsafe-boundary-v1.json"
DOC = ROOT / "docs/UNSAFE_BOUNDARY_V1.md"
POINTER = ROOT / "docs/POINTER_CAPABILITY_CONTRACT.md"


class UnsafeBoundaryContractV1Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.doc = DOC.read_text(encoding="utf-8")
        cls.pointer = POINTER.read_text(encoding="utf-8")

    def test_never_mislabels_reference_as_guest_evidence(self):
        c = self.contract
        self.assertEqual(c["schema"], "oreslang.unsafe-boundary.v1")
        self.assertEqual(c["schema_version"], 1)
        self.assertEqual(c["status"], "contract-only")
        self.assertIs(c["is_guest_implementation"], False)
        self.assertIn("does not invoke any Oreslang compiler", c["validation"])
        self.assertEqual(c["backends"], dict.fromkeys(
            ("java", "llvm", "forge", "wasm", "net"), "pending"))
        self.assertIn("not yet executable", self.doc.lower())

    def test_nonvacuous_positive_and_negative_scenarios(self):
        cases = self.contract["cases"]
        self.assertGreaterEqual(len(cases), 35)
        ids = [case["id"] for case in cases]
        self.assertEqual(len(ids), len(set(ids)))
        expected = {case["expected"] for case in cases}
        self.assertEqual(expected, {"accept", "accept_after_g2", "reject"})
        required_keys = {"id", "expected", "kind", "reason",
                         "java", "llvm", "forge", "wasm", "net"}
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertEqual(set(case), required_keys)
                self.assertTrue(case["kind"] and case["reason"])
                for backend in ("java", "llvm", "forge", "wasm", "net"):
                    self.assertEqual(case[backend], "pending")
        self.assertTrue(all(c["expected"] != "accept"
                            for c in cases if c["id"].startswith("unsafe-")
                            and c["kind"] != "lexical"))

    def test_required_adversarial_edges_present(self):
        cases = {c["id"]: c for c in self.contract["cases"]}
        required = {
            "unsafe-fnc-without-unsafe-caller",
            "unsafe-block-without-effect",
            "unsafe-effect-without-grant",
            "grant-without-unsafe-context",
            "untrusted-actor-unsafe-block",
            "naked-integer-address",
            "read-grant-upgrade-to-write",
            "cross-actor-grant",
            "stale-actor-generation",
            "stale-region-reallocation-aba",
            "raw-pointer-nested-generic-message",
            "grant-hidden-in-any",
            "async-ffi-unpinned-pointer",
            "raw-lease-hot-reload-reclaim",
            "ffi-effect-hidden-in-macro",
            "ffi-effect-hidden-in-linked-metadata",
            "unsafe-bypasses-sealed-actor-state",
            "unsafe-forges-supervisor-control",
            "unsafe-assumes-hard-realtime",
            "unsupported-backend-silent-fallback",
        }
        self.assertTrue(required <= set(cases))
        self.assertTrue(all(cases[x]["expected"] == "reject" for x in required))

    def test_effect_taxonomy_and_existing_pointer_contract_not_rewritten(self):
        self.assertEqual(set(self.contract["effect_kinds"]),
                         {"unsafe.memory", "unsafe.ffi",
                          "unsafe.mmio", "unsafe.intrinsic"})
        for phrase in ("RawPointer<T>", "Pointer<T>", "unsafe.memory",
                       "generation", "UNTRUSTED", "AOT", "hard_rt"):
            self.assertIn(phrase, self.doc)
        for phrase in ("RawPointer<T>", "unsafe.memory", "grant", "LLVM"):
            self.assertIn(phrase, self.pointer)


if __name__ == "__main__":
    unittest.main()
