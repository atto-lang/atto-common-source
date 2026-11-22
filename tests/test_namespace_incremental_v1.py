"""Executable reference-only tests: no actual AttoLang compiler is invoked."""
import copy
import unittest
from experiments.namespace_incremental_v1 import InvalidSnapshot, plan_incremental


def h(ch): return ch * 64


def example():
    return {
        "semantic_profile": h("1"), "codegen_profile": h("2"),
        "packages": [{"id": "shop@sha:111", "manifest_sha": h("3")},
                     {"id": "app@sha:222", "manifest_sha": h("4")}],
        "files": [
            {"package": "shop@sha:111", "namespace": "users", "path": "src/users.atto", "source_sha": h("5")},
            {"package": "shop@sha:111", "namespace": "payments", "path": "src/payments.atto", "source_sha": h("6")},
            {"package": "shop@sha:111", "namespace": "metrics", "path": "src/metrics.atto", "source_sha": h("7")},
            {"package": "app@sha:222", "namespace": "ui", "path": "src/ui.atto", "source_sha": h("8")},
        ],
        "namespaces": [
            {"package": "shop@sha:111", "name": "users", "interface_sha": h("a"), "imports": ["shop@sha:111::payments"], "inlines": []},
            {"package": "shop@sha:111", "name": "payments", "interface_sha": h("b"), "imports": [], "inlines": []},
            {"package": "shop@sha:111", "name": "metrics", "interface_sha": h("c"), "imports": [], "inlines": []},
            {"package": "app@sha:222", "name": "ui", "interface_sha": h("d"), "imports": ["shop@sha:111::users"], "inlines": []},
        ]
    }


class NamespaceIncrementalTests(unittest.TestCase):
    def change(self):
        old = example()
        return old, copy.deepcopy(old)

    def test_cold_build_and_repeated_snapshot(self):
        first = example()
        cold = plan_incremental(None, first)
        self.assertEqual(len(cold.recheck), 4)
        self.assertEqual(len(cold.codegen), 4)
        self.assertEqual(cold.relink_packages, ("app@sha:222", "shop@sha:111"))
        self.assertFalse(plan_incremental(first, copy.deepcopy(first)).codegen)

    def test_body_only_edit_one_namespace_no_caller_recheck(self):
        old, new = self.change()
        new["files"][1]["source_sha"] = h("9")
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:111::payments",))
        self.assertEqual(p.codegen, p.recheck)
        self.assertEqual(p.relink_packages, ("app@sha:222", "shop@sha:111"))

    def test_public_abi_edit_transitively_invalidates_callers_not_unrelated(self):
        old, new = self.change()
        new["namespaces"][1]["interface_sha"] = h("e")
        p = plan_incremental(old, new)
        self.assertEqual(set(p.recheck), {"shop@sha:111::payments", "shop@sha:111::users", "app@sha:222::ui"})
        self.assertNotIn("shop@sha:111::metrics", p.codegen)

    def test_inlined_body_cascades_codegen_not_typecheck(self):
        old, new = self.change()
        old["namespaces"][0]["inlines"] = ["shop@sha:111::payments"]
        new["namespaces"][0]["inlines"] = ["shop@sha:111::payments"]
        new["namespaces"][3]["inlines"] = ["shop@sha:111::users"]
        old["namespaces"][3]["inlines"] = ["shop@sha:111::users"]
        new["files"][1]["source_sha"] = h("9")
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:111::payments",))
        self.assertEqual(set(p.codegen), {"shop@sha:111::payments", "shop@sha:111::users", "app@sha:222::ui"})

    def test_namespace_member_moved_changes_both_namespace_owners(self):
        old, new = self.change()
        new["files"].append({"package":"shop@sha:111", "namespace":"payments", "path":"src/extra.atto", "source_sha":h("e")})
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:111::payments",))
        new["files"][-1]["namespace"] = "metrics"
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:111::metrics",))

    def test_removal_rebuilds_owner_and_relinks(self):
        old, new = self.change()
        new["files"] = [x for x in new["files"] if x["namespace"] != "metrics"]
        new["namespaces"] = [x for x in new["namespaces"] if x["name"] != "metrics"]
        p = plan_incremental(old, new)
        self.assertEqual(p.removed, ("shop@sha:111::metrics",))
        self.assertEqual(p.recheck, ())
        self.assertEqual(p.relink_packages, ("app@sha:222", "shop@sha:111"))

    def test_missing_import_rejects_no_cache_hit(self):
        old, new = self.change()
        new["files"] = [x for x in new["files"] if x["namespace"] != "payments"]
        new["namespaces"] = [x for x in new["namespaces"] if x["name"] != "payments"]
        with self.assertRaisesRegex(InvalidSnapshot, "missing/unauthorized"):
            plan_incremental(old, new)

    def test_package_instance_namespaces_do_not_merge(self):
        old, new = self.change()
        new["packages"].append({"id":"shop@sha:333", "manifest_sha":h("f")})
        new["namespaces"].append({"package":"shop@sha:333", "name":"payments", "interface_sha":h("b"),"imports":[],"inlines":[]})
        new["files"].append({"package":"shop@sha:333","namespace":"payments", "path":"src/payments.atto", "source_sha":h("6")})
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:333::payments",))
        self.assertEqual(p.relink_packages, ("shop@sha:333",))

    def test_manifest_rebind_vs_semantic_target_toolchain(self):
        old, new = self.change()
        new["packages"][0]["manifest_sha"] = h("f")
        p = plan_incremental(old, new)
        self.assertEqual(set(p.recheck), {"shop@sha:111::users", "shop@sha:111::payments", "shop@sha:111::metrics"})
        old, new = self.change()
        new["codegen_profile"] = h("e")
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ())
        self.assertEqual(len(p.codegen), 4)
        old, new = self.change()
        new["semantic_profile"] = h("e")
        p = plan_incremental(old, new)
        self.assertEqual(len(p.recheck), 4)

    def test_import_dependency_change_invalidates_only_importer(self):
        old, new = self.change()
        new["namespaces"][0]["imports"] = ["shop@sha:111::metrics"]
        p = plan_incremental(old, new)
        self.assertEqual(p.recheck, ("shop@sha:111::users",))

    def test_reordered_snapshot_is_stable(self):
        old, new = self.change()
        new["packages"].reverse(); new["files"].reverse(); new["namespaces"].reverse()
        self.assertEqual(plan_incremental(old, new).codegen, ())

    def test_invalid_duplicate_and_traversal_rejected(self):
        old, new = self.change()
        new["files"][1]["path"] = "../escape.atto"
        with self.assertRaises(InvalidSnapshot): plan_incremental(old, new)
        old, new = self.change()
        new["files"].append(copy.deepcopy(new["files"][0]))
        with self.assertRaises(InvalidSnapshot): plan_incremental(old, new)
        old, new = self.change()
        new["namespaces"].append(copy.deepcopy(new["namespaces"][0]))
        with self.assertRaises(InvalidSnapshot): plan_incremental(old, new)

    def test_mutual_namespace_import_cycle_bounded(self):
        old, new = self.change()
        for src in (old, new):
            src["namespaces"][1]["imports"] = ["shop@sha:111::users"]
        new["namespaces"][1]["interface_sha"] = h("e")
        p = plan_incremental(old, new)
        self.assertIn("shop@sha:111::users", p.recheck)
        self.assertIn("shop@sha:111::payments", p.recheck)


if __name__ == "__main__":
    unittest.main()
