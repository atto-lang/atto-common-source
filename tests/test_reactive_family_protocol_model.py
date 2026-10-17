"""Model-only admission tests for docs/REACTIVE_ITERATOR_STREAM_CHANNEL_INTEROP_V1.md.

This is NOT an Oreslang compiler, backend, scheduler or actor runtime test.
Do not treat a green host test as proof of source-level execution.
"""
import itertools
import unittest
from collections import deque


class ProtocolError(ValueError):
    pass


class AdapterModel:
    """Bounded, one-writer framed bridge with one unicast subscriber."""

    TERMINALS = frozenset(("complete", "error", "cancelled"))

    def __init__(self, capacity):
        if type(capacity) is not int or capacity < 0:
            raise ProtocolError("invalid capacity")
        self.capacity = capacity
        self.queue = deque()
        self.pending_write = None
        self.claim = None
        self.delivered_terminal = False
        self.cancelled = False
        self.pull_active = False
        self.subscribed = False
        self.disposals = 0
        self.delivered = []
        self.max_buffered = 0

    def subscribe(self):
        if self.subscribed:
            raise ProtocolError("raw single-consumer source cannot multicast")
        self.subscribed = True

    def send(self, value):
        if self.claim or self.cancelled:
            raise ProtocolError("send after terminal claim")
        if self.pending_write is not None:
            raise ProtocolError("unbounded pending write registrations")
        # Frame is (next, value), so None and Err can be ordinary payloads.
        frame = ("next", value)
        if self.capacity > len(self.queue):
            self.queue.append(frame)
        else:
            self.pending_write = frame
        self.max_buffered = max(self.max_buffered, len(self.queue))
        assert len(self.queue) <= self.capacity

    def terminate(self, kind):
        if kind not in self.TERMINALS:
            raise ProtocolError("invalid terminal variant")
        if self.claim or self.cancelled:
            raise ProtocolError("duplicate terminal claim")
        self.claim = kind

    def begin_pull(self):
        if self.pull_active:
            raise ProtocolError("concurrent pull on one activation")
        self.pull_active = True

    def settle_pull(self):
        if not self.pull_active:
            raise ProtocolError("pull was not registered")
        try:
            if self.cancelled:
                return ("cancelled", None)
            if self.queue:
                event = self.queue.popleft()
                if self.pending_write is not None:
                    self.queue.append(self.pending_write)
                    self.pending_write = None
            elif self.pending_write is not None:
                # capacity=0 rendezvous, or a prior pending write
                event = self.pending_write
                self.pending_write = None
            elif self.claim and not self.delivered_terminal:
                self.delivered_terminal = True
                event = (self.claim, None)
            else:
                return None  # blocked/absent, NOT a complete event
            if self.delivered_terminal and event[0] == "next":
                raise AssertionError("NEXT after a delivered terminal")
            self.delivered.append(event)
            return event
        finally:
            self.pull_active = False

    def next_event(self):
        self.begin_pull()
        return self.settle_pull()

    def cancel(self):
        if self.cancelled or self.delivered_terminal:
            return False
        self.cancelled = True
        self.claim = self.claim or "cancelled"
        self.pending_write = None
        self.queue.clear()
        self.disposals += 1
        return True


class ReactiveProtocolModelTests(unittest.TestCase):
    def test_rendezvous_never_buffers(self):
        m = AdapterModel(0)
        m.subscribe()
        m.send(None)
        self.assertEqual(len(m.queue), 0)
        self.assertEqual(m.next_event(), ("next", None))
        self.assertIsNone(m.next_event())
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("complete", None))
        self.assertIsNone(m.next_event())

    def test_result_error_is_not_a_terminal(self):
        m = AdapterModel(1)
        m.subscribe()
        data_error = ("Err", "bad-input")
        m.send(data_error)
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("next", data_error))
        self.assertEqual(m.next_event(), ("complete", None))

    def test_full_buffer_bounds_pending_registrations(self):
        m = AdapterModel(1)
        m.send(1)
        m.send(2)
        self.assertEqual(m.max_buffered, 1)
        with self.assertRaises(ProtocolError):
            m.send(3)
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("next", 1))
        self.assertEqual(m.next_event(), ("next", 2))
        self.assertEqual(m.next_event(), ("complete", None))

    def test_terminal_claim_does_not_overtake_data(self):
        for capacity in (0, 1, 2):
            with self.subTest(capacity=capacity):
                m = AdapterModel(capacity)
                m.send("a")
                if capacity:
                    m.send("b")  # second pending write at capacity=1
                m.terminate("error")
                self.assertEqual(m.next_event(), ("next", "a"))
                if capacity:
                    self.assertEqual(m.next_event(), ("next", "b"))
                self.assertEqual(m.next_event(), ("error", None))
                self.assertIsNone(m.next_event())

    def test_no_send_or_double_terminal_after_claim(self):
        for terminal in ("complete", "error", "cancelled"):
            m = AdapterModel(1)
            m.terminate(terminal)
            with self.assertRaises(ProtocolError):
                m.send(99)
            with self.assertRaises(ProtocolError):
                m.terminate("complete")

    def test_unknown_terminal_rejected(self):
        m = AdapterModel(0)
        for invalid in ("next", "done", "None", "Err", "", None):
            with self.subTest(kind=invalid), self.assertRaises(ProtocolError):
                m.terminate(invalid)

    def test_subscription_is_unicast_not_multicast(self):
        m = AdapterModel(3)
        m.subscribe()
        with self.assertRaises(ProtocolError):
            m.subscribe()

    def test_one_outstanding_pull(self):
        m = AdapterModel(0)
        m.begin_pull()
        with self.assertRaises(ProtocolError):
            m.begin_pull()
        self.assertIsNone(m.settle_pull())
        m.send(5)
        self.assertEqual(m.next_event(), ("next", 5))

    def test_cancel_disposes_once_and_rejects_write(self):
        m = AdapterModel(1)
        m.send(5)
        self.assertTrue(m.cancel())
        self.assertFalse(m.cancel())
        self.assertEqual(m.disposals, 1)
        self.assertEqual(m.next_event(), ("cancelled", None))
        self.assertEqual(m.max_buffered, 1)
        with self.assertRaises(ProtocolError):
            m.send(6)

    def test_cancel_after_complete_is_noop(self):
        m = AdapterModel(1)
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("complete", None))
        self.assertFalse(m.cancel())

    def test_terminal_vocabulary_always_distinct(self):
        self.assertEqual(len(AdapterModel.TERMINALS), 3)
        self.assertNotIn("next", AdapterModel.TERMINALS)
        self.assertNotIn("Err", AdapterModel.TERMINALS)

    def test_capacity_validation(self):
        for invalid in (-1, None, True, 1.5, "1"):
            with self.subTest(capacity=invalid), self.assertRaises(ProtocolError):
                AdapterModel(invalid)

    def test_all_small_single_writer_traces_preserve_invariants(self):
        # Model-check all bounded action strings: no hidden buffer/pending
        # credit expansion and no NEXT after any observed terminal.
        for steps in itertools.product(("send", "next", "complete", "cancel"),
                                       repeat=6):
            for cap in (0, 1, 2):
                m = AdapterModel(cap)
                for step in steps:
                    try:
                        if step == "send":
                            m.send(len(m.delivered))
                        elif step == "next":
                            m.next_event()
                        elif step == "complete":
                            m.terminate("complete")
                        else:
                            m.cancel()
                    except ProtocolError:
                        pass  # a rejected operation cannot mutate the model
                    self.assertLessEqual(len(m.queue), cap)
                    self.assertFalse(m.pending_write is not None and len(m.queue) < cap
                                     and not m.cancelled)
                    terminals = [x for x in m.delivered if x[0] != "next"]
                    self.assertLessEqual(len(terminals), 1)
                    if terminals:
                        self.assertFalse(any(x[0] == "next" for x in
                                             m.delivered[m.delivered.index(terminals[0]) + 1:]))

    def test_projection_does_not_confuse_blocked_with_end(self):
        m = AdapterModel(0)
        self.assertIsNone(m.next_event())  # pending, NOT IteratorResult.done
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("complete", None))


if __name__ == "__main__":
    unittest.main()
