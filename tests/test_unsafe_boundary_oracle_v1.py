"""Executed host-side model tests only; do not report Oreslang guest parity."""
import pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from unsafe_boundary_oracle_v1 import Denied, UnsafeBoundaryOracle

class UnsafeBoundaryOracleTest(unittest.TestCase):
    def setUp(self):
        self.o = UnsafeBoundaryOracle()
        self.actor = self.o.host_actor(trusted=True, native_allowed=True)
        self.actor_b = self.o.host_actor(trusted=True, native_allowed=True)
        self.untrusted = self.o.host_actor(trusted=False, native_allowed=False)
        self.region = self.o.host_region()
        self.grant = self.o.host_grant(self.actor, self.region, start=0x1000,
                                       size=16, writable=False)
        self.base = dict(lexical_unsafe=True, effects=frozenset({'unsafe.memory'}),
                         address=0x1000, width=4)

    def check(self, actor=None, grant=None, **overrides):
        kw = dict(self.base)
        kw.update(overrides)
        return self.o.check_native_access(actor or self.actor, grant or self.grant, **kw)

    def test_valid_read_and_explicit_rejection_matrix(self):
        self.assertTrue(self.check())
        bad = (
            {'lexical_unsafe': False},
            {'effects': frozenset()},
            {'effects': frozenset({'unsafe.ffi'})},
            {'address': 0x1001},
            {'address': 0x100F},
            {'address': 0x0FFC},
            {'address': 1 << 64},
            {'width': 3},
            {'write': True},
            {'suspended': True},
            {'effects': ['unsafe.memory']},
        )
        for case in bad:
            with self.subTest(case=case), self.assertRaises(Denied):
                self.check(**case)

    def test_actor_and_region_generation_revocation(self):
        with self.assertRaises(Denied):
            self.check(actor=self.actor_b)
        with self.assertRaises(Denied):
            self.check(actor=self.untrusted)
        self.o.host_restart(self.actor)
        with self.assertRaises(Denied):
            self.check()
        new_grant = self.o.host_grant(self.actor, self.region, start=0x1000,
                                       size=16, writable=False)
        self.assertTrue(self.check(grant=new_grant))
        self.o.host_recycle_region(self.region)
        with self.assertRaises(Denied):
            self.check(grant=new_grant)

    def test_object_forgery_never_calls_attacker_magic_methods(self):
        class Hostile:
            def __hash__(self):
                raise AssertionError('hash invoked on untrusted token')
            def __eq__(self, other):
                raise AssertionError('equality invoked on untrusted token')
            def __getattribute__(self, key):
                raise AssertionError('untrusted attribute inspected')
        hostile = Hostile()
        with self.assertRaises(Denied):
            self.check(grant=hostile)
        with self.assertRaises(Denied):
            self.check(actor=hostile)
        with self.assertRaises(Denied):
            self.o.host_grant(self.untrusted, self.region, start=0x1000,
                              size=16, writable=False)

    def test_noninteger_addresses_are_rejected_without_coercion(self):
        with self.assertRaises(Denied):
            self.check(address=True)
        with self.assertRaises(Denied):
            self.check(address='0x1000')
        with self.assertRaises(Denied):
            self.o.host_grant(self.actor, self.region, start=2**64, size=1,
                              writable=True)

if __name__ == '__main__':
    unittest.main()
