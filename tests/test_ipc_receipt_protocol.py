"""Executable IPC receipt transition and identity adversaries."""
import unittest
from scripts.ipc_receipt_protocol import Phase, ProtocolViolation, Receipt

IDENTITY = dict(session_id="session_1",incarnation=7,request_id="req_1",
                payload_sha256="a"*64)


class ReceiptTests(unittest.TestCase):
    def receipt(self):
        return Receipt(**IDENTITY)

    def advance(self, receipt, step, **overrides):
        return receipt.advance(step, **{**IDENTITY, **overrides})

    def test_three_distinct_receipt_milestones(self):
        local = self.receipt()
        self.assertEqual(local.phase, Phase.LOCAL_ADMITTED)
        remote = self.advance(local, Phase.REMOTE_RECEIVED)
        self.assertEqual(remote.phase, Phase.REMOTE_RECEIVED)
        done = self.advance(remote, Phase.TURN_COMPLETED)
        self.assertEqual(done.phase, Phase.TURN_COMPLETED)
        self.assertEqual(local.phase, Phase.LOCAL_ADMITTED)

    def test_failure_is_only_terminal_after_authenticated_remote_receipt(self):
        with self.assertRaises(ProtocolViolation):
            self.advance(self.receipt(), Phase.TURN_FAILED)
        remote = self.advance(self.receipt(), Phase.REMOTE_RECEIVED)
        self.assertEqual(self.advance(remote, Phase.TURN_FAILED).phase, Phase.TURN_FAILED)

    def test_stale_generation_and_session_cannot_satisfy_new_request(self):
        for hostile in (dict(incarnation=8), dict(session_id="elsewhere"),
                        dict(request_id="other"), dict(payload_sha256="b"*64),
                        dict(incarnation=True)):
            with self.subTest(hostile=hostile), self.assertRaises(ProtocolViolation):
                self.advance(self.receipt(), Phase.REMOTE_RECEIVED, **hostile)

    def test_disconnect_is_unknown_not_failed(self):
        for current in (self.receipt(), self.advance(self.receipt(), Phase.REMOTE_RECEIVED)):
            unknown = self.advance(current, Phase.OUTCOME_UNKNOWN)
            self.assertEqual(unknown.phase, Phase.OUTCOME_UNKNOWN)
            self.assertFalse(unknown.can_automatically_replay())
            with self.assertRaises(ProtocolViolation):
                self.advance(unknown, Phase.TURN_COMPLETED)

    def test_duplicate_and_reordered_terminal_frames_are_denied(self):
        remote = self.advance(self.receipt(), Phase.REMOTE_RECEIVED)
        with self.assertRaises(ProtocolViolation):
            self.advance(remote, Phase.REMOTE_RECEIVED)
        terminal = self.advance(remote, Phase.TURN_COMPLETED)
        for event in (Phase.TURN_COMPLETED, Phase.TURN_FAILED, Phase.OUTCOME_UNKNOWN):
            with self.subTest(event=event), self.assertRaises(ProtocolViolation):
                self.advance(terminal, event)

    def test_forged_weak_identifiers_fail_at_construction(self):
        for changes in (dict(incarnation=0), dict(incarnation=True),
                        dict(session_id="../outside"), dict(request_id=""),
                        dict(payload_sha256="0"*40), dict(phase="LOCAL_ADMITTED")):
            with self.subTest(changes=changes), self.assertRaises(ProtocolViolation):
                Receipt(**{**IDENTITY, **changes})

    def test_unknown_event_and_replay_are_not_inferred(self):
        with self.assertRaises(ProtocolViolation):
            self.advance(self.receipt(), "retry_without_dedup")
        self.assertFalse(self.receipt().can_automatically_replay())


if __name__ == "__main__":
    unittest.main()
