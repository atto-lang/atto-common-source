"""Model-only admission tests for docs/REACTIVE_ITERATOR_STREAM_CHANNEL_INTEROP_V1.md.

This is NOT an Oreslang compiler, backend, scheduler or actor runtime test.
Do not treat a green host test as proof of source-level execution.
"""
import itertools
import unittest
from collections import deque


class ProtocolError(ValueError):
    pass


def canonical_signal(kind, value=None):
    """Closed consumer ABI: Result<Option<T>, Option<E>>."""
    if kind == "next":
        return ("Ok", ("Some", value))
    if kind == "complete":
        return ("Ok", None)
    if kind == "cancelled":
        return ("Err", None)
    if kind == "error":
        return ("Err", ("Some", value))
    raise ProtocolError("invalid signal kind")


def producer_frame(kind, value=None):
    """Producer wire frame: Result<Option<T>, E>; no CANCELLED variant."""
    if kind == "next":
        return ("Ok", ("Some", value))
    if kind == "complete":
        return ("Ok", None)
    if kind == "error":
        return ("Err", value)
    raise ProtocolError("producer frame cannot encode cancellation")


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
        self.terminal_error = None
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

    def terminate(self, kind, error=None):
        if kind not in self.TERMINALS:
            raise ProtocolError("invalid terminal variant")
        if kind != "error" and error is not None:
            raise ProtocolError("only ERROR carries a terminal error payload")
        if self.claim or self.cancelled:
            raise ProtocolError("duplicate terminal claim")
        self.claim = kind
        self.terminal_error = error

    def begin_pull(self):
        if self.delivered_terminal:
            raise ProtocolError("pull after terminal event")
        if self.pull_active:
            raise ProtocolError("concurrent pull on one activation")
        self.pull_active = True

    def settle_pull(self):
        if not self.pull_active:
            raise ProtocolError("pull was not registered")
        resolved = False
        try:
            if self.cancelled:
                if self.delivered_terminal:
                    raise ProtocolError("terminal already delivered")
                self.delivered_terminal = True
                event = ("cancelled", None)
            elif self.queue:
                event = self.queue.popleft()
                if self.pending_write is not None:
                    self.queue.append(self.pending_write)
                    self.pending_write = None
            elif self.pending_write is not None:
                # Capacity-zero rendezvous, or the oldest pending write.
                event = self.pending_write
                self.pending_write = None
            elif self.claim and not self.delivered_terminal:
                self.delivered_terminal = True
                event = (self.claim, self.terminal_error
                         if self.claim == "error" else None)
            else:
                # A blocked pull remains registered: an unrelated caller
                # cannot start a second pull while this one is outstanding.
                return None
            resolved = True
            if self.delivered_terminal and event[0] == "next":
                raise AssertionError("NEXT after a delivered terminal")
            self.delivered.append(event)
            return event
        finally:
            if resolved:
                self.pull_active = False

    def next_event(self):
        if self.delivered_terminal:
            return None  # idempotent observed terminal, no new registration
        self.begin_pull()
        return self.settle_pull()

    def cancel(self):
        # The first terminal claimant wins; do not rewrite a committed
        # COMPLETE/ERROR as CANCELLED after observing it in another turn.
        if self.cancelled or self.delivered_terminal or self.claim:
            return False
        self.cancelled = True
        self.claim = self.claim or "cancelled"
        self.pending_write = None
        self.queue.clear()
        self.disposals += 1
        return True


class FutureAdapterModel:
    """One shared Future producer and independent subscription lifetimes.

    A call to settle() queues notifications; only drain() simulates delivery
    on the consumer execution lane. This is a host-model admission check,
    NOT an implementation of the actor scheduler.
    """

    def __init__(self):
        self.settlement = None
        self.subscribers = []
        self.pending_notifications = []
        self.producer_cancellations = 0

    def subscribe(self):
        index = len(self.subscribers)
        self.subscribers.append({"state": "open", "events": [], "disposals": 0})
        if self.settlement is not None:
            self.pending_notifications.append(index)
        return index

    def cancel(self, index):
        sub = self.subscribers[index]
        if sub["state"] != "open":
            return False
        sub["state"] = "cancelled"
        sub["events"].append(("cancelled", None))
        sub["disposals"] += 1
        return True  # The Future producer is BORROWED, never cancelled.

    def settle(self, kind, value=None):
        if kind not in ("success", "error", "cancelled"):
            raise ProtocolError("invalid Future settlement")
        if self.settlement is not None:
            raise ProtocolError("Future settled twice")
        self.settlement = (kind, value)
        self.pending_notifications.extend(
            i for i, sub in enumerate(self.subscribers)
            if sub["state"] == "open"
        )

    def drain(self):
        """No inline callback or resurrection of a cancelled observer."""
        notifications = self.pending_notifications
        self.pending_notifications = []
        for index in notifications:
            sub = self.subscribers[index]
            if sub["state"] != "open":
                continue
            kind, value = self.settlement
            if kind == "success":
                sub["events"].extend((("next", value), ("complete", None)))
            else:
                sub["events"].append((kind, value if kind == "error" else None))
            sub["state"] = "closed"
            sub["disposals"] += 1


class ReactiveProtocolModelTests(unittest.TestCase):
    def test_canonical_signal_is_four_way_and_sum_safe(self):
        self.assertEqual(canonical_signal("next", None),
                         ("Ok", ("Some", None)))
        self.assertEqual(canonical_signal("next", ("Err", "ordinary-data")),
                         ("Ok", ("Some", ("Err", "ordinary-data"))))
        self.assertEqual(canonical_signal("complete"), ("Ok", None))
        self.assertEqual(canonical_signal("cancelled"), ("Err", None))
        self.assertEqual(canonical_signal("error", "boom"),
                         ("Err", ("Some", "boom")))
        self.assertEqual(canonical_signal("error", None),
                         ("Err", ("Some", None)))
        self.assertNotEqual(canonical_signal("error", None),
                            canonical_signal("cancelled"))

    def test_producer_frame_has_no_consumer_cancel_variant(self):
        self.assertEqual(producer_frame("next", None),
                         ("Ok", ("Some", None)))
        self.assertEqual(producer_frame("complete"), ("Ok", None))
        self.assertEqual(producer_frame("error", "boom"), ("Err", "boom"))
        with self.assertRaises(ProtocolError):
            producer_frame("cancelled")

    def test_rendezvous_never_buffers(self):
        m = AdapterModel(0)
        m.subscribe()
        m.send(None)
        self.assertEqual(len(m.queue), 0)
        self.assertEqual(m.next_event(), ("next", None))
        self.assertIsNone(m.next_event())
        m.terminate("complete")
        self.assertEqual(m.settle_pull(), ("complete", None))
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
        self.assertTrue(m.pull_active)
        m.send(5)
        self.assertEqual(m.settle_pull(), ("next", 5))

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

    def test_cancel_after_terminal_claim_does_not_rewrite_result(self):
        m = AdapterModel(1)
        m.send(3)
        m.terminate("complete")
        self.assertFalse(m.cancel())
        self.assertEqual(m.next_event(), ("next", 3))
        self.assertEqual(m.next_event(), ("complete", None))

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
        for steps in itertools.product(("send", "next", "settle", "complete", "cancel"),
                                       repeat=6):
            for cap in (0, 1, 2):
                m = AdapterModel(cap)
                for step in steps:
                    before = (tuple(m.queue), m.pending_write, m.claim,
                              m.terminal_error, m.delivered_terminal,
                              m.cancelled, m.pull_active,
                              m.disposals, tuple(m.delivered))
                    try:
                        if step == "send":
                            m.send(len(m.delivered))
                        elif step == "next":
                            m.next_event()
                        elif step == "settle":
                            if m.pull_active:
                                m.settle_pull()
                        elif step == "complete":
                            m.terminate("complete")
                        else:
                            m.cancel()
                    except ProtocolError:
                        # Rejected operations MUST be side-effect free.
                        self.assertEqual(before,
                                         (tuple(m.queue), m.pending_write, m.claim,
                                          m.terminal_error, m.delivered_terminal,
                                          m.cancelled, m.pull_active, m.disposals,
                                          tuple(m.delivered)))
                    self.assertLessEqual(len(m.queue), cap)
                    self.assertFalse(m.pending_write is not None and len(m.queue) < cap
                                     and not m.cancelled)
                    terminals = [x for x in m.delivered if x[0] != "next"]
                    self.assertLessEqual(len(terminals), 1)
                    if terminals:
                        self.assertFalse(any(x[0] == "next" for x in
                                             m.delivered[m.delivered.index(terminals[0]) + 1:]))

    def test_blocked_rendezvous_pull_cannot_be_reentered(self):
        m = AdapterModel(0)
        m.begin_pull()
        self.assertIsNone(m.settle_pull())
        self.assertTrue(m.pull_active)
        with self.assertRaises(ProtocolError):
            m.begin_pull()
        m.send(("Some", None))
        self.assertEqual(m.settle_pull(), ("next", ("Some", None)))
        self.assertFalse(m.pull_active)
        m.terminate("complete")
        self.assertEqual(m.next_event(), ("complete", None))

    def test_cancel_wakes_existing_pull_and_cleans_once(self):
        m = AdapterModel(0)
        m.begin_pull()
        self.assertIsNone(m.settle_pull())
        self.assertTrue(m.cancel())
        self.assertFalse(m.cancel())
        self.assertEqual(m.settle_pull(), ("cancelled", None))
        self.assertEqual(m.disposals, 1)
        self.assertFalse(m.pull_active)
        self.assertIsNone(m.next_event())

    def test_terminal_claim_wakes_pending_pull_without_fabricated_next(self):
        for kind in ("complete", "error", "cancelled"):
            with self.subTest(kind=kind):
                m = AdapterModel(0)
                m.begin_pull()
                self.assertIsNone(m.settle_pull())
                m.terminate(kind)
                self.assertEqual(m.settle_pull(), (kind, None))
                self.assertIsNone(m.next_event())

    def test_pending_data_precedes_terminal_after_waiter_resolves(self):
        m = AdapterModel(0)
        m.begin_pull()
        self.assertIsNone(m.settle_pull())
        m.send(("Err", "data-error"))
        m.terminate("error")
        self.assertEqual(m.settle_pull(), ("next", ("Err", "data-error")))
        self.assertEqual(m.next_event(), ("error", None))

    def test_shared_future_is_not_restarted_for_each_subscriber(self):
        f = FutureAdapterModel()
        first = f.subscribe()
        second = f.subscribe()
        f.settle("success", ("Err", "ordinary-payload"))
        self.assertEqual(f.subscribers[first]["events"], [])  # no Zalgo
        f.drain()
        expected = [("next", ("Err", "ordinary-payload")), ("complete", None)]
        self.assertEqual(f.subscribers[first]["events"], expected)
        self.assertEqual(f.subscribers[second]["events"], expected)
        late = f.subscribe()
        self.assertEqual(f.subscribers[late]["events"], [])
        f.drain()
        self.assertEqual(f.subscribers[late]["events"], expected)
        self.assertEqual(f.producer_cancellations, 0)

    def test_cancelled_future_observer_detaches_but_producer_survives(self):
        f = FutureAdapterModel()
        cancelled = f.subscribe()
        live = f.subscribe()
        self.assertTrue(f.cancel(cancelled))
        self.assertFalse(f.cancel(cancelled))
        f.settle("success", None)
        f.drain()
        self.assertEqual(f.subscribers[cancelled]["events"],
                         [("cancelled", None)])
        self.assertEqual(f.subscribers[live]["events"],
                         [("next", None), ("complete", None)])
        self.assertEqual([s["disposals"] for s in f.subscribers], [1, 1])
        self.assertEqual(f.producer_cancellations, 0)

    def test_late_future_callback_cannot_resurrect_cancelled_subscription(self):
        f = FutureAdapterModel()
        observer = f.subscribe()
        f.settle("success", 99)
        self.assertTrue(f.cancel(observer))
        f.drain()  # scheduled callback races after owned cancellation
        self.assertEqual(f.subscribers[observer]["events"],
                         [("cancelled", None)])
        self.assertEqual(f.subscribers[observer]["disposals"], 1)

    def test_failed_future_is_terminal_not_result_data(self):
        f = FutureAdapterModel()
        observer = f.subscribe()
        f.settle("error", "upstream")
        f.drain()
        self.assertEqual(f.subscribers[observer]["events"],
                         [("error", "upstream")])
        with self.assertRaises(ProtocolError):
            f.settle("success", "second settlement")
        late = f.subscribe()
        f.drain()
        self.assertEqual(f.subscribers[late]["events"],
                         [("error", "upstream")])

    def test_cancelled_future_and_invalid_settlement(self):
        f = FutureAdapterModel()
        observer = f.subscribe()
        for bad in ("complete", "next", "Err", None):
            with self.subTest(kind=bad), self.assertRaises(ProtocolError):
                f.settle(bad)
        f.settle("cancelled")
        f.drain()
        self.assertEqual(f.subscribers[observer]["events"],
                         [("cancelled", None)])
        self.assertFalse(f.cancel(observer))

    def test_typed_terminal_error_is_distinct_from_err_data(self):
        m = AdapterModel(0)
        m.send(("Err", "ordinary-data"))
        m.terminate("error", "network-broken")
        self.assertEqual(m.next_event(), ("next", ("Err", "ordinary-data")))
        self.assertEqual(m.next_event(), ("error", "network-broken"))
        self.assertIsNone(m.next_event())

    def test_non_error_terminal_cannot_carry_failure_payload(self):
        for kind in ("complete", "cancelled"):
            with self.subTest(kind=kind):
                m = AdapterModel(0)
                with self.assertRaises(ProtocolError):
                    m.terminate(kind, "failure")
                self.assertIsNone(m.claim)
                m.terminate(kind)
                self.assertEqual(m.next_event(), (kind, None))

    def test_projection_does_not_confuse_blocked_with_end(self):
        m = AdapterModel(0)
        self.assertIsNone(m.next_event())  # pending, NOT IteratorResult.done
        self.assertTrue(m.pull_active)
        m.terminate("complete")
        self.assertEqual(m.settle_pull(), ("complete", None))


if __name__ == "__main__":
    unittest.main()
