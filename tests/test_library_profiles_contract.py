#!/usr/bin/env python3
"""Validate the two-public-profile Oreslang library architecture."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "library" / "v1" / "library-profiles.json"
DOC = ROOT / "docs" / "CORE_ALLOC_ACTOR_OTP_BOUNDARY_V1.md"


class LibraryProfileContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_exact_public_profiles(self):
        profiles = self.data["publicProfiles"]
        self.assertEqual([p["id"] for p in profiles], ["core", "std"])
        self.assertFalse(profiles[0]["osRequired"])
        self.assertTrue(profiles[1]["osRequired"])
        self.assertEqual(profiles[0]["requiredLayers"], ["core"])
        self.assertIn("host-adapter", profiles[1]["requiredLayers"])

    def test_internal_tiers_are_not_public_profiles(self):
        public = {p["id"] for p in self.data["publicProfiles"]}
        layers = {p["id"] for p in self.data["internalLayers"]}
        self.assertEqual(public, {"core", "std"})
        self.assertTrue({"core", "alloc", "actor", "otp", "host-adapter"} <= layers)
        self.assertTrue({"alloc", "actor", "otp"}.isdisjoint(public))
        self.assertTrue(
            {"alloc", "actor", "otp"} <=
            set(self.data["forbiddenPublicProfileNames"])
        )

    def test_dependency_direction(self):
        layers = {x["id"]: x for x in self.data["internalLayers"]}
        self.assertEqual(layers["core"]["dependsOn"], [])
        self.assertEqual(layers["alloc"]["dependsOn"], ["core"])
        self.assertEqual(layers["actor"]["dependsOn"], ["core"])
        self.assertEqual(layers["otp"]["dependsOn"], ["core", "actor"])
        self.assertTrue(layers["host-adapter"]["stdOnly"])
        self.assertNotIn("host-adapter", layers["core"]["dependsOn"])

    def test_core_is_freestanding_but_can_opt_into_explicit_providers(self):
        core = next(p for p in self.data["publicProfiles"] if p["id"] == "core")
        self.assertFalse(core["ambientAllocatorAllowed"])
        self.assertIn("alloc", core["optionalLayers"])
        self.assertIn("actor", core["optionalLayers"])
        self.assertIn("otp", core["optionalLayers"])
        rules = self.data["rules"]
        self.assertTrue(rules["coreMustRemainLinkableWithoutOS"])
        self.assertTrue(rules["coreMustNotRequireHeap"])
        self.assertTrue(rules["coreMayUseCallerProvidedAllocation"])
        self.assertTrue(rules["actorRuntimeIsOptional"])
        self.assertTrue(rules["coreMayNotDependOnStd"])

    def test_document_matches_profile_contract(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("exactly two public library profiles", text)
        self.assertIn("`core`", text)
        self.assertIn("`std`", text)
        self.assertIn("not public library profiles", text)


if __name__ == "__main__":
    unittest.main()
