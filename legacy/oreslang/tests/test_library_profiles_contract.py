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

    def test_exact_public_profiles_and_layers(self):
        profiles = self.data["publicProfiles"]
        self.assertEqual([p["id"] for p in profiles], ["core", "std"])
        self.assertEqual(
            [x["id"] for x in self.data["libraryLayers"]],
            ["core", "std"],
        )
        self.assertEqual(profiles[0]["admittedLibraryLayers"], ["core"])
        self.assertEqual(profiles[1]["admittedLibraryLayers"], ["core", "std"])

    def test_old_tiers_are_providers_not_library_layers(self):
        layers = {x["id"] for x in self.data["libraryLayers"]}
        self.assertEqual(layers, {"core", "std"})
        forbidden = set(self.data["forbiddenPublicProfileNames"])
        self.assertTrue({"alloc", "actor", "otp"} <= forbidden)
        self.assertTrue({"alloc", "actor", "otp"}.isdisjoint(layers))
        providers = set(self.data["providerKinds"])
        self.assertTrue({
            "allocator.explicit",
            "executor.explicit",
            "mailbox.bounded",
            "control.trusted",
            "clock.monotonic",
        } <= providers)

    def test_dependency_direction_is_downward_closed(self):
        layers = {x["id"]: x for x in self.data["libraryLayers"]}
        self.assertEqual(layers["core"]["dependsOn"], [])
        self.assertEqual(layers["std"]["dependsOn"], ["core"])
        self.assertFalse(layers["core"]["osRequired"])
        self.assertTrue(layers["std"]["osRequired"])

    def test_core_is_freestanding_but_may_use_explicit_providers(self):
        core = next(p for p in self.data["publicProfiles"] if p["id"] == "core")
        self.assertFalse(core["osRequired"])
        self.assertFalse(core["ambientAllocatorAllowed"])
        self.assertNotIn("host.capabilities.explicit", core["optionalProviders"])
        rules = self.data["rules"]
        self.assertTrue(rules["coreMustRemainLinkableWithoutOS"])
        self.assertTrue(rules["coreMustNotRequireHeap"])
        self.assertTrue(rules["coreMayUseExplicitProviders"])
        self.assertTrue(rules["coreMayNotDependOnStd"])
        self.assertTrue(rules["providerRequirementsMustBeCompilerInferred"])
        self.assertTrue(rules["actorRuntimeIsOptional"])

    def test_forbidden_profile_names_never_overlap_public_names(self):
        public = {p["id"] for p in self.data["publicProfiles"]}
        self.assertTrue(
            public.isdisjoint(set(self.data["forbiddenPublicProfileNames"]))
        )

    def test_document_matches_profile_contract(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("exactly two public library profiles", text)
        self.assertIn("`core`", text)
        self.assertIn("`std`", text)
        self.assertIn("not additional library layers or public profiles", text)
        self.assertIn("provider/capability families", text)


if __name__ == "__main__":
    unittest.main()
