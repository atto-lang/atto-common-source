"""Deterministic source-free capability property tests, not Oreslang backend evidence."""
import random
import unittest

from scripts.authority_boundary_v1 import AuthorityBoundaryV1, Denied


RIGHTS = {
    "io.net": "net.connect",
    "io.file.read": "fs.read",
    "io.file.write": "fs.write",
    "io.env": "env.read",
    "process.spawn": "process.spawn",
    "ffi": "ffi.call",
}


class AuthorityBoundaryPropertiesV1(unittest.TestCase):
    def test_seeded_delegation_and_declared_effect_matrix(self):
        rng = random.Random(0xA11CE)
        checks = 0
        for iteration in range(256):
            allowed = {right for right in RIGHTS.values() if rng.getrandbits(1)}
            root_rights = {right for right in allowed if rng.getrandbits(1)}
            child_rights = {right for right in root_rights if rng.getrandbits(1)}
            oracle = AuthorityBoundaryV1(allowed)
            root = oracle.root_actor("root", root_rights)
            child = oracle.spawn(root, "child", child_rights)
            for actor, rights in ((root, root_rights), (child, child_rights)):
                for effect, permission in RIGHTS.items():
                    for declared in ((), (effect,)):
                        with self.subTest(iteration=iteration, actor=actor is root,
                                          effect=effect, declared=bool(declared)):
                            if declared and permission in rights:
                                self.assertEqual(oracle.perform(actor, effect, declared), effect)
                            else:
                                with self.assertRaises(Denied):
                                    oracle.perform(actor, effect, declared)
                            checks += 1
            old = child
            new = oracle.upgrade(old, set())
            with self.assertRaisesRegex(Denied, "unissued, foreign, or retired"):
                oracle.perform(old, "io.file.read", ("io.file.read",))
            self.assertEqual(oracle._actor(new).rights, frozenset())
            checks += 2
        self.assertEqual(checks, 6656)

    def test_seeded_denial_does_not_modify_actor_authority(self):
        rng = random.Random(0xB0A00)
        for iteration in range(256):
            oracle = AuthorityBoundaryV1(set(RIGHTS.values()))
            granted = {v for v in RIGHTS.values() if rng.getrandbits(1)}
            actor = oracle.root_actor("base", granted)
            missing = set(RIGHTS.values()) - granted
            if missing:
                with self.assertRaises(Denied):
                    oracle.upgrade(actor, granted | {sorted(missing)[0]})
            with self.assertRaises(Denied):
                oracle.upgrade(actor, granted, schema_compatible=False)
            self.assertEqual(oracle._actor(actor).rights, frozenset(granted))
            ticket = oracle.enter_critical(actor)
            with self.assertRaises(Denied):
                oracle.spawn(actor, "child", set())
            with self.assertRaises(Denied):
                oracle.upgrade(actor, set())
            oracle.leave_critical(actor, ticket)
            self.assertEqual(oracle._actor(actor).rights, frozenset(granted))


if __name__ == "__main__":
    unittest.main()
