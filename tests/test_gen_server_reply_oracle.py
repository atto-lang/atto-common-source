"""Source-free G0 protocol oracle. NOT a guest Oreslang or native OTP implementation."""
import unittest
from collections import deque


class ProtocolFailure(Exception):
    pass


class GenServerOracle:
    """Serial endpoint with bounded admission and incarnation-fenced one-shot replies.

    A token is an opaque object issued by the reference model only. This Python
    model cannot prove the guest runtime's capability/authentication boundary.
    """

    def __init__(self, capacity=2, actor_id="server", call_type=int, reply_type=int):
        assert capacity > 0
        self.capacity, self.actor_id = capacity, actor_id
        self.call_type, self.reply_type = call_type, reply_type
        self.generation = 1
        self._queue = deque()
        self._calls = {}
        self._serial = 0

    def call(self, sender, value):
        if sender == self.actor_id:
            raise ProtocolFailure("SELF_CALL")
        if not isinstance(value, self.call_type):
            raise ProtocolFailure("CALL_TYPE")
        if len(self._queue) >= self.capacity:
            raise ProtocolFailure("MAILBOX_FULL")
        self._serial += 1
        token = object()  # identity cannot be obtained by guessing an integer
        self._calls[token] = [self.generation, self._serial, "pending"]
        self._queue.append((token, value))
        return token

    def dequeue(self):
        if not self._queue:
            return None
        return self._queue.popleft()

    def expire(self, token):
        record = self._validate(token)
        if record[2] == "pending":
            record[2] = "expired"
            return True
        return False

    def reply(self, token, value):
        record = self._validate(token)
        if not isinstance(value, self.reply_type):
            raise ProtocolFailure("REPLY_TYPE")
        if record[2] == "consumed":
            raise ProtocolFailure("DOUBLE_REPLY")
        if record[2] == "pending":
            record[2] = "consumed"
            return True
        if record[2] == "expired":
            record[2] = "consumed"
            return False  # late reply discarded, cannot complete another call
        raise ProtocolFailure("INVALID_STATE")

    def restart(self):
        self.generation += 1
        self._queue.clear()
        # Keep old token tombstones: no cross-generation reply reuse.

    def _validate(self, token):
        if token not in self._calls:
            raise ProtocolFailure("UNISSUED_REPLY_CAPABILITY")
        record = self._calls[token]
        if record[0] != self.generation:
            raise ProtocolFailure("STALE_INCARNATION")
        return record


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


if __name__ == "__main__":
    unittest.main()
