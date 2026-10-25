#!/usr/bin/env python3
"""Validate the OTP/freestanding layer CONTRACT, never claim runtime evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "library" / "v1" / "otp-portability.json"
EXPECTED = {
    "gen_server", "supervisor", "gen_statem",
    "application", "event_manager", "registry", "pg", "ets",
}
OS_EFFECTS = {"os", "posix", "linux", "libc", "filesystem", "network",
              "process", "threads", "java-interop", "clock.ambient",
              "memory.ambient"}

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
        self.assertNotEqual(d["canonicalImportPrefix"],
                            d["transitionalJavaDraftImportPrefix"])
        self.assertIn("not implemented", d["transitionalJavaDraftImportStatus"])
        text = (ROOT / "docs/CORE_ALLOC_ACTOR_OTP_BOUNDARY_V1.md").read_text(
            encoding="utf-8")
        self.assertIn("future portable canonical import", text)
        self.assertIn("transitional Java resolver spelling", text)
        for module in d["modules"]:
            self.assertEqual(
                module["canonicalImport"],
                d["canonicalImportPrefix"] + module["module"])

    def test_exact_eight_unique_modules_and_locations(self):
        modules = self.data["modules"]
        self.assertEqual(len(modules), len(EXPECTED))
        self.assertEqual({m["module"] for m in modules}, EXPECTED)
        for m in modules:
            self.assertEqual(m["path"], f"stdlib/otp/{m['module']}.ores")
            self.assertEqual(m["canonicalImport"], f"otp/{m['module']}")
            self.assertEqual(m["layer"], "otp")
            self.assertEqual(m["sourceStatus"], "pending")
            self.assertIs(m["executableTestsPassed"], False)

    def test_core_freestanding_and_dependency_graph(self):
        layers = self.data["layers"]
        names = {x["id"] for x in layers}
        self.assertEqual(len(layers), len(names))
        graph = {x["id"]: x["dependsOn"] for x in layers}
        self.assertTrue({"core", "alloc", "actor", "otp", "host-adapter"} <= names)
        self.assertEqual(graph["core"], [])
        self.assertEqual(graph["actor"], ["core"])
        self.assertEqual(graph["otp"], ["core", "actor"])
        for x in layers:
            self.assertTrue(set(x["dependsOn"]) <= names)
            self.assertNotIn(x["id"], x["dependsOn"])
            if x["id"] != "host-adapter":
                self.assertIs(x["osRequired"], False)
            self.assertIs(x["heapRequired"], x["id"] == "alloc")
        seen, active = set(), set()
        def visit(node):
            if node in active:
                raise AssertionError("dependency cycle: " + node)
            if node in seen:
                return
            active.add(node)
            for dep in graph[node]:
                visit(dep)
            active.remove(node)
            seen.add(node)
        for layer in graph:
            visit(layer)
        self.assertNotIn("alloc", graph["core"])

    def test_no_host_effects_and_bounded_actor_api(self):
        d = self.data
        self.assertEqual(set(d["forbiddenHostEffects"]), OS_EFFECTS)
        for m in d["modules"]:
            self.assertTrue(m["requires"])
            self.assertTrue(set(m["requires"]).isdisjoint(OS_EFFECTS))
            self.assertTrue(set(m["conditional"]).isdisjoint(OS_EFFECTS))
            self.assertNotIn("clock.ambient", m["conditional"])
            self.assertNotIn("memory.ambient", m["conditional"])
        self.assertIn("control.authenticated", next(m for m in d["modules"]
                                                   if m["module"] == "supervisor")["requires"])
        pg = next(m for m in d["modules"] if m["module"] == "pg")
        self.assertIn("group.membership-incarnation-fenced", pg["requires"])
        self.assertIn("group.scope-explicit", pg["requires"])
        ets = next(m for m in d["modules"] if m["module"] == "ets")
        self.assertIn("table.capacity-bounded", ets["requires"])
        self.assertIn("table.atomic-operation", ets["requires"])

if __name__ == "__main__":
    unittest.main()
