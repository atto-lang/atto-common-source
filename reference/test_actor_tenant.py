"""Run: python3 -m unittest discover -s reference -p 'test_*.py' -v"""
import unittest
from actor_tenant import HostModel, IsolationError, TenantRef, BufferRef


class IsolationModelTests(unittest.TestCase):
    def setUp(self):
        self.host = HostModel()
        self.a = self.host.create_tenant("alpha", 8)
        self.b = self.host.create_tenant("beta", 8)
        self.a1 = self.host.create_actor(self.a, "producer")
        self.a2 = self.host.create_actor(self.a, "consumer", capacity=1)
        self.b1 = self.host.create_actor(self.b, "consumer")

    def rejects(self, code, operation):
        with self.assertRaises(IsolationError) as cm:
            operation()
        self.assertEqual(str(cm.exception), code)

    def test_same_tenant_move_invalidates_source(self):
        buf = self.host.allocate(self.a1, b"ABC")
        moved = self.host.send_move(self.a1, self.a2, buf)
        self.assertEqual(self.host.read(self.a2, self.host.receive(self.a2)), b"ABC")
        self.rejects("STALE_BUFFER", lambda: self.host.read(self.a1, buf))
        self.rejects("OWNER", lambda: self.host.read(self.a1, moved))

    def test_borrow_blocks_mutation_and_transfer(self):
        buf = self.host.allocate(self.a1, b"AB")
        loan = self.host.borrow(self.a1, buf, self.a2)
        self.rejects("BORROWED", lambda: self.host.write(self.a1, buf, 0, 67))
        self.rejects("BORROWED", lambda: self.host.send_move(self.a1, self.a2, buf))
        self.assertEqual(self.host.loan_read(self.a2, loan), b"AB")
        self.host.release(loan)
        self.rejects("REVOKED_LOAN", lambda: self.host.loan_read(self.a2, loan))
        self.host.write(self.a1, buf, 0, 67)
        self.assertEqual(self.host.read(self.a1, buf), b"CB")

    def test_shared_deep_immutable_value_and_old_mutable_alias(self):
        buf = self.host.allocate(self.a1, b"XYZ")
        shared = self.host.freeze(self.a1, buf)
        self.assertEqual(self.host.shared_read(self.a2, shared), b"XYZ")
        self.rejects("STALE_BUFFER", lambda: self.host.write(self.a1, buf, 0, 1))
        self.rejects("FOREIGN_TENANT", lambda: self.host.shared_read(self.b1, shared))

    def test_full_or_closed_mailbox_preserves_sender(self):
        one = self.host.allocate(self.a1, b"1")
        two = self.host.allocate(self.a1, b"2")
        self.host.send_move(self.a1, self.a2, one)
        self.rejects("MAILBOX_FULL", lambda: self.host.send_move(self.a1, self.a2, two))
        self.assertEqual(self.host.read(self.a1, two), b"2")
        self.host.close_mailbox(self.a2)
        self.host.receive(self.a2)
        self.rejects("MAILBOX_CLOSED", lambda: self.host.send_move(self.a1, self.a2, two))
        self.assertEqual(self.host.read(self.a1, two), b"2")

    def test_cross_tenant_move_and_borrow_rejected(self):
        buf = self.host.allocate(self.a1, b"data")
        self.rejects("FOREIGN_TENANT", lambda: self.host.send_move(self.a1, self.b1, buf))
        self.rejects("FOREIGN_TENANT", lambda: self.host.borrow(self.a1, buf, self.b1))
        self.assertEqual(self.host.read(self.a1, buf), b"data")

    def test_broker_copy_is_independent_and_authorized(self):
        buf = self.host.allocate(self.a1, b"AB")
        self.rejects("UNAUTHORIZED_COPY", lambda: self.host.broker_copy(self.a1, buf, self.b1, None))
        cap = self.host.grant_copy(self.a, self.b)
        copied = self.host.broker_copy(self.a1, buf, self.b1, cap)
        self.host.write(self.a1, buf, 0, 90)
        self.assertEqual(self.host.read(self.a1, buf), b"ZB")
        self.assertEqual(self.host.read(self.b1, copied), b"AB")
        self.host.revoke(cap)
        self.rejects("UNAUTHORIZED_COPY", lambda: self.host.broker_copy(self.a1, buf, self.b1, cap))

    def test_quota_does_not_charge_failed_allocation(self):
        self.host.allocate(self.a1, b"12345678")
        self.rejects("QUOTA", lambda: self.host.allocate(self.a1, b"9"))
        self.assertEqual(self.host._tenant(self.a).used_bytes, 8)

    def test_retirement_generation_fence_and_neighbor_survival(self):
        buf = self.host.allocate(self.a1, b"old")
        keep = self.host.allocate(self.b1, b"live")
        self.host.retire_tenant(self.a)
        self.rejects("STALE_TENANT", lambda: self.host.read(self.a1, buf))
        self.assertEqual(self.host.read(self.b1, keep), b"live")
        new_a = self.host.create_tenant("alpha")
        self.assertNotEqual(new_a.generation, self.a.generation)
        self.rejects("STALE_TENANT", lambda: self.host.create_actor(self.a, "intruder"))
        fake = TenantRef("alpha", new_a.generation)
        self.rejects("STALE_TENANT", lambda: self.host.create_actor(fake, "intruder"))

    def test_forged_buffer_handle_denied(self):
        buf = self.host.allocate(self.a1, b"hi")
        forged = BufferRef(self.a, buf.object_id, buf.version, object())
        self.rejects("STALE_BUFFER", lambda: self.host.read(self.a1, forged))

    def test_no_cross_host_authority(self):
        other = HostModel()
        foreign = other.create_tenant("alpha")
        self.rejects("STALE_TENANT", lambda: self.host.create_actor(foreign, "intruder"))

    def test_invalid_tenant_id(self):
        self.rejects("INVALID_TENANT", lambda: self.host.create_tenant(".."))
        self.rejects("INVALID_TENANT", lambda: self.host.create_tenant("../escape"))


if __name__ == "__main__":
    unittest.main()
