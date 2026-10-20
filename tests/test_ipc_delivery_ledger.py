"""Adversarial IPC correlation, bounded credits and ambiguity vectors."""
import unittest
from dataclasses import replace
from scripts.ipc_delivery_ledger import AdmissionError, BoundedLedger, Envelope, Stage

BASE = dict(sender_domain="tenantA", sender_actor="parent",
            sender_incarnation=4, destination_actor="child",
            destination_incarnation=3, route_epoch=8,
            transport_session="sessionA", message_sequence=1,
            frame_sequence=1, capability_generation=2,
            payload_sha256="a"*64)


def env(**changes):
    return Envelope(**{**BASE, **changes})


class LedgerTests(unittest.TestCase):
    def test_admit_receive_done_are_three_different_milestones(self):
        ledger=BoundedLedger(capacity=2)
        message=env()
        self.assertEqual(ledger.admit(message), Stage.LOCAL_ADMITTED)
        self.assertEqual(ledger.transport_credits, 1)
        self.assertEqual(ledger.transition(message, Stage.REMOTE_ACCEPTED,
                                          authenticated=True), Stage.REMOTE_ACCEPTED)
        self.assertEqual(ledger.transport_credits, 0)
        self.assertEqual(ledger.in_flight, 1)
        self.assertEqual(ledger.transition(message, Stage.HANDLER_COMMITTED,
                                          authenticated=True), Stage.HANDLER_COMMITTED)
        self.assertEqual(ledger.in_flight, 0)
        self.assertTrue(ledger.invariant())

    def test_cross_domain_generation_route_session_and_payload_mismatch(self):
        ledger=BoundedLedger(capacity=1); message=env(); ledger.admit(message)
        for key, value in (("sender_domain","tenantB"),
                           ("destination_incarnation",4),("route_epoch",9),
                           ("transport_session","sessionB"),("frame_sequence",2),
                           ("capability_generation",3),("payload_sha256","b"*64)):
            with self.subTest(key=key), self.assertRaises(AdmissionError):
                ledger.transition(replace(message, **{key:value}),
                                  Stage.REMOTE_ACCEPTED,authenticated=True)
        self.assertEqual(ledger.transport_credits,1)
        self.assertTrue(ledger.invariant())

    def test_duplicate_receipt_and_unknown_cannot_replay(self):
        ledger=BoundedLedger(capacity=1); msg=env(); ledger.admit(msg)
        ledger.transition(msg,Stage.REMOTE_ACCEPTED,authenticated=True)
        with self.assertRaises(AdmissionError):
            ledger.transition(msg,Stage.REMOTE_ACCEPTED,authenticated=True)
        self.assertEqual(ledger.transition(msg,Stage.UNKNOWN,authenticated=True),
                         Stage.UNKNOWN)
        with self.assertRaises(AdmissionError):
            ledger.transition(msg,Stage.HANDLER_COMMITTED,authenticated=True)
        with self.assertRaises(AdmissionError):
            ledger.admit(msg)
        self.assertFalse(ledger.can_replay(msg))
        self.assertTrue(ledger.invariant())

    def test_capacity_exhaustion_and_credit_refund(self):
        ledger=BoundedLedger(capacity=1)
        first=env(); second=env(message_sequence=2)
        ledger.admit(first)
        with self.assertRaises(AdmissionError): ledger.admit(second)
        ledger.transition(first,Stage.FAILED,authenticated=True)
        self.assertEqual(ledger.transport_credits,0)
        ledger.admit(second)
        self.assertTrue(ledger.invariant())

    def test_current_incarnation_hot_route_advance_preserves_order(self):
        ledger=BoundedLedger(capacity=2)
        first=env(); second=env(message_sequence=2,route_epoch=9,
                                transport_session="sessionB")
        ledger.admit(first); ledger.admit(second)
        ledger.transition(second,Stage.REMOTE_ACCEPTED,authenticated=True)
        ledger.transition(first,Stage.REMOTE_ACCEPTED,authenticated=True)
        ledger.transition(first,Stage.HANDLER_COMMITTED,authenticated=True)
        ledger.transition(second,Stage.HANDLER_COMMITTED,authenticated=True)
        self.assertEqual(ledger.in_flight,0)
        self.assertTrue(ledger.invariant())

    def test_restarted_actor_cannot_complete_old_messages(self):
        ledger=BoundedLedger(capacity=2); old=env(); ledger.admit(old)
        with self.assertRaises(AdmissionError):
            ledger.admit(env(message_sequence=2,destination_incarnation=4))
        with self.assertRaises(AdmissionError):
            ledger.transition(env(destination_incarnation=4),
                              Stage.REMOTE_ACCEPTED,authenticated=True)

    def test_no_fake_auth_early_commit_or_sequence_wrap(self):
        ledger=BoundedLedger(capacity=1); msg=env(); ledger.admit(msg)
        for auth in (0,None,False,"true"):
            with self.assertRaises(AdmissionError):
                ledger.transition(msg,Stage.REMOTE_ACCEPTED,authenticated=auth)
        with self.assertRaises(AdmissionError):
            ledger.transition(msg,Stage.HANDLER_COMMITTED,authenticated=True)
        with self.assertRaises(AdmissionError):
            env(message_sequence=2**63)
        with self.assertRaises(AdmissionError):
            env(sender_incarnation=True)

    def test_failed_means_proven_no_remote_admission_only(self):
        ledger=BoundedLedger(capacity=1); message=env(); ledger.admit(message)
        ledger.transition(message, Stage.REMOTE_ACCEPTED, authenticated=True)
        with self.assertRaises(AdmissionError):
            ledger.transition(message, Stage.FAILED, authenticated=True)
        self.assertEqual(ledger.in_flight, 1)
        self.assertEqual(ledger.transition(message, Stage.HANDLER_FAILED,
                                           authenticated=True), Stage.HANDLER_FAILED)
        self.assertEqual(ledger.in_flight, 0)
        self.assertTrue(ledger.invariant())

    def test_handler_failed_cannot_claim_pre_admission_terminal(self):
        ledger=BoundedLedger(capacity=1); message=env(); ledger.admit(message)
        with self.assertRaises(AdmissionError):
            ledger.transition(message, Stage.HANDLER_FAILED, authenticated=True)
        self.assertTrue(ledger.invariant())

    def test_route_epoch_and_capability_generation_cannot_rollback(self):
        ledger=BoundedLedger(capacity=2); first=env(); ledger.admit(first)
        for changes in (dict(message_sequence=2, route_epoch=7),
                        dict(message_sequence=2, capability_generation=1)):
            with self.subTest(changes=changes), self.assertRaises(AdmissionError):
                ledger.admit(env(**changes))
        ledger.admit(env(message_sequence=2,route_epoch=9,capability_generation=3))
        ledger.transition(first, Stage.REMOTE_ACCEPTED, authenticated=True)
        ledger.transition(first, Stage.HANDLER_COMMITTED, authenticated=True)
        self.assertTrue(ledger.invariant())

    def test_denied_admission_never_consumes_sequence_or_credits(self):
        ledger=BoundedLedger(capacity=1)
        one=env(); two=env(message_sequence=2,route_epoch=9)
        ledger.admit(one)
        with self.assertRaises(AdmissionError):
            ledger.admit(two)
        self.assertEqual(ledger._last_seq,1)
        ledger.transition(one,Stage.UNKNOWN,authenticated=True)
        ledger.admit(two)
        self.assertEqual(ledger._last_seq,2)
        self.assertTrue(ledger.invariant())

    def test_transport_loss_is_unknown_not_definitive_failure(self):
        ledger=BoundedLedger(capacity=1); msg=env(); ledger.admit(msg)
        self.assertEqual(ledger.transition(msg,Stage.UNKNOWN,authenticated=True),
                         Stage.UNKNOWN)
        self.assertEqual(ledger.transport_credits,0)
        self.assertFalse(ledger.can_replay(msg))
        self.assertTrue(ledger.invariant())


if __name__ == "__main__":
    unittest.main()
