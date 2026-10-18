"""Source-free G0 protocol oracle. NOT a guest Oreslang or native OTP implementation."""
import unittest
from collections import deque


class ProtocolFailure(Exception):
    pass


class _ReplyTicket:
    """Reference-model token; not a secure guest capability implementation."""
    __slots__ = ("issuer", "generation", "serial", "status")

    def __init__(self, issuer, generation, serial):
        self.issuer = issuer
        self.generation = generation
        self.serial = serial
        self.status = "pending"


class GenServerOracle:
    """Serial endpoint with bounded admission and incarnation-fenced one-shot replies.

    A token is minted by this Python model but is NOT an unforgeable guest
    capability. The model bounds all unsettled calls (queued AND executing)
    and removes settled calls immediately, with token-carried replay markers
    rather than perpetual ledger tombstones. This models memory invariants,
    not runtime authentication, race safety or atomic mailbox admission.
    """

    def __init__(self, capacity=2, actor_id="server", call_type=int, reply_type=int):
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self.capacity, self.actor_id = capacity, actor_id
        self.call_type, self.reply_type = call_type, reply_type
        self.generation = 1
        self._queue = deque()
        self._calls = {}
        self._serial = 0
        self._issuer = object()

    def call(self, sender, value):
        if sender == self.actor_id:
            raise ProtocolFailure("SELF_CALL")
        if not isinstance(value, self.call_type):
            raise ProtocolFailure("CALL_TYPE")
        if len(self._calls) >= self.capacity:
            raise ProtocolFailure("MAILBOX_FULL")
        self._serial += 1
        token = _ReplyTicket(self._issuer, self.generation, self._serial)
        self._calls[token] = "pending"
        self._queue.append((token, value))
        return token

    def dequeue(self):
        if not self._queue:
            return None
        return self._queue.popleft()

    def expire(self, token):
        record = self._validate(token)
        if record == "pending":
            self._calls[token] = "expired"
            token.status = "expired"
            return True
        return False

    def reply(self, token, value):
        record = self._validate(token)
        if not isinstance(value, self.reply_type):
            raise ProtocolFailure("REPLY_TYPE")
        if record in ("pending", "expired"):
            self._calls.pop(token)
            token.status = "consumed"
            return record == "pending"  # late reply discarded after timeout
        raise ProtocolFailure("INVALID_STATE")

    def restart(self):
        self.generation += 1
        self._queue.clear()
        self._calls.clear()
        # Stale client-held tickets carry the prior generation; no tombstone
        # set remains in the server after restart.

    def _validate(self, token):
        if not isinstance(token, _ReplyTicket) or token.issuer is not self._issuer:
            raise ProtocolFailure("UNISSUED_REPLY_CAPABILITY")
        if token.generation != self.generation:
            raise ProtocolFailure("STALE_INCARNATION")
        if token.status == "consumed":
            raise ProtocolFailure("DOUBLE_REPLY")
        if token not in self._calls:
            raise ProtocolFailure("UNISSUED_REPLY_CAPABILITY")
        return self._calls[token]


class OracleTests(unittest.TestCase):
    def expect_code(self, code, fn):
        with self.assertRaisesRegex(ProtocolFailure, "^" + code + "$"):
            fn()

    def test_100_clients_and_fifo(self):
        s = GenServerOracle(capacity=100)
        tokens = [s.call("client" + str(i), i) for i in range(100)]
        for i in range(100):
            token, value = s.dequeue()
            self.assertIs(token, tokens[i])
            self.assertEqual(value, i)
            self.assertTrue(s.reply(token, i * 2))
        self.assertIsNone(s.dequeue())

    def test_mailbox_full_preserves_admission(self):
        s = GenServerOracle(capacity=1)
        first = s.call("a", 7)
        self.expect_code("MAILBOX_FULL", lambda: s.call("b", 8))
        self.assertIs(s.dequeue()[0], first)

    def test_reply_is_one_shot(self):
        s = GenServerOracle()
        t = s.call("client", 2)
        self.assertTrue(s.reply(t, 9))
        self.expect_code("DOUBLE_REPLY", lambda: s.reply(t, 9))

    def test_timeout_does_not_retract_accepted_work(self):
        s = GenServerOracle()
        t = s.call("client", 3)
        self.assertTrue(s.expire(t))
        self.assertIs(s.dequeue()[0], t)
        self.assertFalse(s.reply(t, 4))
        self.expect_code("DOUBLE_REPLY", lambda: s.reply(t, 4))

    def test_incarnation_fence(self):
        s = GenServerOracle()
        t = s.call("client", 1)
        s.restart()
        self.assertIsNone(s.dequeue())
        self.expect_code("STALE_INCARNATION", lambda: s.reply(t, 1))
        t2 = s.call("client", 2)
        self.assertIsNot(t, t2)
        self.assertTrue(s.reply(t2, 2))

    def test_unissued_capability_rejected(self):
        s = GenServerOracle()
        self.expect_code("UNISSUED_REPLY_CAPABILITY", lambda: s.reply(object(), 1))

    def test_self_call_rejected(self):
        s = GenServerOracle(actor_id="server")
        self.expect_code("SELF_CALL", lambda: s.call("server", 1))

    def test_wrong_call_and_reply_type(self):
        s = GenServerOracle()
        self.expect_code("CALL_TYPE", lambda: s.call("client", "bad"))
        t = s.call("client", 1)
        self.expect_code("REPLY_TYPE", lambda: s.reply(t, "bad"))
        self.assertTrue(s.reply(t, 5))

    def test_expire_only_once(self):
        s = GenServerOracle()
        t = s.call("c", 1)
        self.assertTrue(s.expire(t))
        self.assertFalse(s.expire(t))


    def test_dequeued_work_still_counts_against_capacity(self):
        s = GenServerOracle(capacity=1)
        ticket = s.call("a", 1)
        self.assertIs(s.dequeue()[0], ticket)
        # Queue depth is zero but admitted in-flight work is still outstanding.
        self.expect_code("MAILBOX_FULL", lambda: s.call("b", 2))
        self.assertTrue(s.reply(ticket, 1))
        self.assertIsNotNone(s.call("b", 2))

    def test_timeout_does_not_release_inflight_credit(self):
        s = GenServerOracle(capacity=1)
        ticket = s.call("a", 1)
        self.assertIs(s.dequeue()[0], ticket)
        self.assertTrue(s.expire(ticket))
        self.expect_code("MAILBOX_FULL", lambda: s.call("b", 2))
        self.assertFalse(s.reply(ticket, 99))
        self.assertIsNotNone(s.call("b", 2))

    def test_retired_calls_do_not_leak_ledger_slots(self):
        s = GenServerOracle(capacity=1)
        client_retained = []
        for i in range(3000):
            ticket = s.call("client", i)
            client_retained.append(ticket)
            self.assertIs(s.dequeue()[0], ticket)
            self.assertTrue(s.reply(ticket, i))
            self.assertEqual(len(s._calls), 0)
        self.expect_code("DOUBLE_REPLY",
                         lambda: s.reply(client_retained[0], 0))
        self.assertEqual(len(s._calls), 0)

    def test_restart_discards_unsettled_without_tombstones(self):
        s = GenServerOracle(capacity=2)
        first = s.call("a", 1)
        second = s.call("b", 2)
        s.dequeue()
        self.assertEqual(len(s._calls), 2)
        s.restart()
        self.assertEqual(len(s._calls), 0)
        self.assertIsNone(s.dequeue())
        self.expect_code("STALE_INCARNATION", lambda: s.reply(first, 1))
        self.expect_code("STALE_INCARNATION", lambda: s.reply(second, 2))
        self.assertIsNotNone(s.call("c", 3))

    def test_foreign_server_capability_cannot_settle(self):
        a, b = GenServerOracle(), GenServerOracle()
        foreign = a.call("c", 1)
        self.expect_code("UNISSUED_REPLY_CAPABILITY",
                         lambda: b.reply(foreign, 1))
        self.assertEqual(len(a._calls), 1)
        self.assertTrue(a.reply(foreign, 1))

    def test_failed_admission_never_creates_pending_token(self):
        s = GenServerOracle(capacity=1)
        t = s.call("a", 1)
        self.expect_code("CALL_TYPE", lambda: s.call("b", "wrong"))
        self.expect_code("MAILBOX_FULL", lambda: s.call("b", 2))
        self.assertEqual(len(s._calls), 1)
        self.assertTrue(s.reply(t, 1))

    def test_zero_capacity_rejected(self):
        with self.assertRaisesRegex(ValueError, "capacity must be positive"):
            GenServerOracle(capacity=0)



if __name__ == "__main__":
    unittest.main()
