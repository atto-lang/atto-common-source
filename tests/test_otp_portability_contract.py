#!/usr/bin/env python3
"""Validate the OTP portability contract without claiming runtime evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "library" / "v1" / "otp-portability.json"
EXPECTED = {
    "gen_server", "supervisor", "gen_statem",
    "application", "event_manager", "registry", "pg", "ets",
}
OS_EFFECTS = {
    "os", "posix", "linux", "libc", "filesystem", "network",
    "process", "threads", "java-interop", "clock.ambient",
    "memory.ambient",
}
ACTOR_PROVIDERS = {
    "executor.explicit", "mailbox.bounded", "control.trusted",
}


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_version_and_no_false_advertising(self):
        d = self.data
        self.assertEqual(d["schemaVersion"], 1)
        self.assertEqual(d["canonicalImportPrefix"], "otp/")
        self.assertEqual(d["status"], "contract-only")
        self.assertIs(d["sourceImplementationAvailable"], False)
        self.assertIn("does not invoke", d["validation"])

    def test_future_canonical_import_is_distinct_from_java_draft(self):
        d = self.data
        self.assertEqual(d["canonicalImportPrefix"], "otp/")
        self.assertEqual(d["transitionalJavaDraftImportPrefix"], "std/otp/")
        self.assertNotEqual(
            d["canonicalImportPrefix"],
            d["transitionalJavaDraftImportPrefix"],
        )
        self.assertIn("not implemented", d["transitionalJavaDraftImportStatus"])
        text = (ROOT / "docs/CORE_ALLOC_ACTOR_OTP_BOUNDARY_V1.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("future portable canonical import", text)
        self.assertIn("transitional Java resolver spelling", text)
        for module in d["modules"]:
            self.assertEqual(
                module["canonicalImport"],
                d["canonicalImportPrefix"] + module["module"],
            )

    def test_exact_eight_core_modules_and_locations(self):
        modules = self.data["modules"]
        self.assertEqual(len(modules), len(EXPECTED))
        self.assertEqual({m["module"] for m in modules}, EXPECTED)
        for m in modules:
            self.assertEqual(m["path"], f"stdlib/otp/{m['module']}.ores")
            self.assertEqual(m["canonicalImport"], f"otp/{m['module']}")
            self.assertEqual(m["layer"], "core")
            self.assertEqual(set(m["providerRequires"]), ACTOR_PROVIDERS)
            self.assertEqual(m["sourceStatus"], "pending")
            self.assertIs(m["executableTestsPassed"], False)

    def test_library_layers_are_exactly_core_and_std(self):
        layers = self.data["layers"]
        self.assertEqual([x["id"] for x in layers], ["core", "std"])
        graph = {x["id"]: x["dependsOn"] for x in layers}
        self.assertEqual(graph["core"], [])
        self.assertEqual(graph["std"], ["core"])
        self.assertFalse(layers[0]["osRequired"])
        self.assertTrue(layers[1]["osRequired"])

    def test_provider_registry_is_explicit_and_bounded(self):
        d = self.data
        provider_kinds = set(d["providerKinds"])
        self.assertEqual(set(d["actorProviders"]), ACTOR_PROVIDERS)
        self.assertTrue(ACTOR_PROVIDERS <= provider_kinds)
        self.assertIn("allocator.explicit", provider_kinds)
        self.assertIn("clock.monotonic", provider_kinds)
        self.assertIn("host.capabilities.explicit", provider_kinds)

        for module in d["modules"]:
            self.assertTrue(set(module["providerRequires"]) <= provider_kinds)
            self.assertTrue(set(module["conditionalProviders"]) <= provider_kinds)
            self.assertNotIn(
                "host.capabilities.explicit",
                module["providerRequires"],
            )
            self.assertNotIn(
                "host.capabilities.explicit",
                module["conditionalProviders"],
            )

    def test_no_host_effects_and_bounded_otp_features(self):
        d = self.data
        self.assertEqual(set(d["forbiddenHostEffects"]), OS_EFFECTS)
        for m in d["modules"]:
            self.assertTrue(m["requires"])
            self.assertTrue(set(m["requires"]).isdisjoint(OS_EFFECTS))
        self.assertIn(
            "control.authenticated",
            next(m for m in d["modules"] if m["module"] == "supervisor")["requires"],
        )
        pg = next(m for m in d["modules"] if m["module"] == "pg")
        self.assertIn("group.membership-incarnation-fenced", pg["requires"])
        self.assertIn("group.scope-explicit", pg["requires"])
        ets = next(m for m in d["modules"] if m["module"] == "ets")
        self.assertIn("table.capacity-bounded", ets["requires"])
        self.assertIn("table.atomic-operation", ets["requires"])


if __name__ == "__main__":
    unittest.main()
