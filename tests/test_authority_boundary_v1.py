"""Negative-first tests for a source-free oracle, NOT Oreslang backend tests."""
import json
from pathlib import Path
import unittest

from scripts.authority_boundary_v1 import AuthorityBoundaryV1, Denied

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/v1/authority-boundary-v1.json"


class AuthorityBoundaryContractTest(unittest.TestCase):
    def setUp(self):
        self.oracle = AuthorityBoundaryV1({"net.connect", "fs.read", "env.read"})
        self.root = self.oracle.root_actor("root", {"net.connect", "fs.read"})
        self.worker = self.oracle.spawn(self.root, "worker", {"fs.read"})

    def run_case(self, case):
        o, root, worker = self.oracle, self.root, self.worker
        actions = {
            "scalar-int": lambda: o.narrow(o.pack_any("int", 7), "int"),
            "scalar-bool": lambda: o.narrow(o.pack_any("bool", False), "bool"),
            "scalar-option-none": lambda: o.narrow(o.pack_any("Option[int]", None), "Option[int]"),
            "scalar-option-some": lambda: o.narrow(o.pack_any("Option[int]", 4), "Option[int]"),
            "bool-as-int": lambda: o.pack_any("int", True),
            "int-overflow": lambda: o.pack_any("int", 1 << 63),
            "raw-null-to-int": lambda: o.pack_any("int", None),
            "unknown-to-any-implicit": lambda: o.narrow(o.unknown(4), "int"),
            "unknown-guard-int": lambda: o.narrow(o.validate(o.unknown(4), "int"), "int"),
            "unknown-guard-wrong-type": lambda: o.validate(o.unknown("oops"), "int"),
            "any-to-other-type": lambda: o.narrow(o.pack_any("int", 4), "string"),
            "capability-into-any": lambda: o.pack_any("ActorRef[int]", root),
            "callable-into-any": lambda: o.pack_any("callable", lambda: None),
            "list-into-any": lambda: o.pack_any("list", []),
            "opaque-any-message": lambda: o.send(root, worker, o.pack_any("int", 12)),
            "opaque-unknown-message": lambda: o.send(root, worker, o.unknown(12)),
            "explicit-narrow-message": lambda: o.send(root, worker, o.narrow(o.pack_any("int", 12), "int")),
            "mutable-message": lambda: o.send(root, worker, [1, 2]),
            "actor-cap-message": lambda: o.send(root, worker, worker),
            "actor-send-fake-source": lambda: o.send(object(), worker, 5),
            "actor-send-fake-dest": lambda: o.send(root, object(), 5),
            "actor-send-valid": lambda: o.send(root, worker, "hello"),
            "process-policy-escalation": lambda: o.root_actor("rogue", {"ffi.call"}),
            "spawn-escalation": lambda: o.spawn(worker, "rogue", {"net.connect"}),
            "child-net-effect-denied": lambda: o.perform(worker, "io.net", ("io.net",)),
            "root-net-effect-allowed": lambda: o.perform(root, "io.net", ("io.net",)),
            "child-file-effect-allowed": lambda: o.perform(worker, "io.file.read", ("io.file.read",)),
            "unknown-effect-denied": lambda: o.perform(root, "io.not.real"),
            "annotation-does-not-grant": lambda: o.perform(worker, "ffi", ("ffi",)),
            "critical-send-denied": lambda: self._during_loan(lambda: o.send(root, worker, 7)),
            "critical-io-denied": lambda: self._during_loan(lambda: o.perform(root, "io.net")),
            "critical-release-valid": lambda: self._release_then(lambda: o.send(root, worker, 7)),
            "foreign-loan-release": lambda: self._foreign_release(),
            "upgrade-expands-rights": lambda: o.upgrade(worker, {"net.connect", "fs.read"}),
            "upgrade-with-live-loan": lambda: self._during_loan(lambda: o.upgrade(root, {"fs.read"})),
            "upgrade-incompatible-schema": lambda: o.upgrade(worker, {"fs.read"}, False),
            "upgrade-parent-with-child": lambda: o.upgrade(root, {"fs.read"}),
            "upgrade-child-restrict": lambda: o.upgrade(worker, set()),
            "stale-child-after-upgrade": lambda: self._upgrade_stale(worker),
            "upgrade-reject-atomic": lambda: self._check_failed_upgrade_no_revoke(),
        }
        self.assertIn(case["id"], actions, "unhandled contract vector")
        return actions[case["id"]]()

    def _during_loan(self, action):
        lease = self.oracle.enter_critical(self.root)
        try:
            return action()
        finally:
            self.oracle.leave_critical(self.root, lease)

    def _release_then(self, action):
        lease = self.oracle.enter_critical(self.root)
        self.oracle.leave_critical(self.root, lease)
        return action()

    def _foreign_release(self):
        lease = self.oracle.enter_critical(self.root)
        try:
            return self.oracle.leave_critical(self.worker, lease)
        finally:
            self.oracle.leave_critical(self.root, lease)

    def _upgrade_stale(self, old):
        self.oracle.upgrade(old, set())
        return self.oracle.perform(old, "io.file.read")

    def _check_failed_upgrade_no_revoke(self):
        with self.assertRaises(Denied):
            self.oracle.upgrade(self.worker, {"ffi.call"})
        return self.oracle.perform(self.worker, "io.file.read", ("io.file.read",))

    def test_vectors_all_executed(self):
        contract = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(contract["schema"], "oreslang.authority-boundary.v1")
        self.assertEqual(contract["evidence"], "SOURCE_FREE_ORACLE_ONLY")
        self.assertGreaterEqual(len(contract["cases"]), 35)
        ids = [case["id"] for case in contract["cases"]]
        self.assertEqual(len(ids), len(set(ids)))
        for case in contract["cases"]:
            with self.subTest(case=case["id"]):
                self.setUp()
                self.assertIn(case["expect"], ("allow", "deny"))
                if case["expect"] == "deny":
                    with self.assertRaises(Denied):
                        self.run_case(case)
                else:
                    self.run_case(case)

    def test_object_identity_not_reusable_between_oracles(self):
        other = AuthorityBoundaryV1({"fs.read"})
        with self.assertRaises(Denied):
            other.perform(self.worker, "io.file.read")
        with self.assertRaises(Denied):
            other.narrow(self.oracle.pack_any("int", 5), "int")

    def test_untrusted_value_not_inspected_before_validation(self):
        class Hostile:
            def __getattribute__(self, _):
                raise AssertionError("inspected untrusted object")
        opaque = self.oracle.unknown(Hostile())
        with self.assertRaises(Denied):
            self.oracle.narrow(opaque, "int")
        with self.assertRaises(Denied):
            self.oracle.validate(opaque, "int")

    def test_hostile_fake_authorities_never_execute_hash_code(self):
        class Hostile:
            def __hash__(self):
                raise AssertionError("untrusted hash executed")
        fake = Hostile()
        with self.assertRaises(Denied):
            self.oracle.perform(fake, "io.net")
        with self.assertRaises(Denied):
            self.oracle.narrow(fake, "int")
        with self.assertRaises(Denied):
            self.oracle.leave_critical(self.root, fake)

    def test_failed_upgrade_keeps_current_generation(self):
        with self.assertRaises(Denied):
            self.oracle.upgrade(self.worker, {"net.connect"})
        self.assertEqual(self.oracle.perform(self.worker, "io.file.read", ("io.file.read",)), "io.file.read")


    def test_spoofed_effect_declaration_is_not_admitted(self):
        class ForgedEffect:
            def __eq__(self, other):
                raise AssertionError("user comparison must not be invoked")
        with self.assertRaises(Denied):
            self.oracle.perform(self.root, "io.net", (ForgedEffect(),))
        with self.assertRaises(Denied):
            self.oracle.perform(self.root, "io.net")
        self.assertEqual(self.oracle.perform(self.root, "io.net", ("io.net",)), "io.net")

    def test_mixed_duplicate_and_unknown_effects_fail_closed(self):
        class Hostile:
            def __eq__(self, _):
                raise AssertionError("effect spoofing")
            def __hash__(self):
                raise AssertionError("effect hashing")
        bad = (
            ("io.net", Hostile()),
            ("io.net", "io.net"),
            ("io.net", "not-an-effect"),
            ("io.net", 7),
            ("io.net", None),
            ("io.net",) * 20,
        )
        for declared in bad:
            with self.subTest(declared_types=tuple(type(x).__name__ for x in declared)):
                with self.assertRaises(Denied):
                    self.oracle.perform(self.root, "io.net", declared)
        for not_a_tuple in (["io.net"], "io.net", None):
            with self.assertRaises(Denied):
                self.oracle.perform(self.root, "io.net", not_a_tuple)
        self.assertEqual(self.oracle.perform(self.root, "io.net", ("io.net",)), "io.net")

    def test_child_spawn_forbidden_while_state_loan_is_live(self):
        lease = self.oracle.enter_critical(self.root)
        try:
            with self.assertRaises(Denied):
                self.oracle.spawn(self.root, "forbidden", set())
        finally:
            self.oracle.leave_critical(self.root, lease)
        self.oracle.spawn(self.root, "allowed", set())

if __name__ == "__main__":
    unittest.main()
