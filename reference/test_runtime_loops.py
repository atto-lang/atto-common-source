"""Source-free behavioral checks; run with python3 -m unittest -v."""
import unittest
from runtime_loops import RuntimeLoops, LoopError


class RuntimeLoopTests(unittest.TestCase):
    def setUp(self):
        self.m = RuntimeLoops()
        self.a = self.m.spawn('a', 1)
        self.b = self.m.spawn('b', 1)

    def rejection(self, reason, fn):
        with self.assertRaises(LoopError) as error:
            fn()
        self.assertEqual(str(error.exception), reason)

    def test_full_send_preserves_owner(self):
        p = self.m.allocate(self.a, b'1')
        q = self.m.allocate(self.a, b'2')
        self.m.send(self.a, self.b, p)
        self.rejection('MAILBOX_FULL', lambda: self.m.send(self.a, self.b, q))
        self.assertEqual(self.m.read(self.a, q), b'2')
        self.rejection('NOT_OWNER', lambda: self.m.read(self.a, p))

    def test_conservation_and_duplicate_settlement(self):
        self.m.send(self.a, self.b, self.m.allocate(self.a, b'x'))
        kind, turn = self.m.select_next()
        self.assertEqual(kind, 'DATA')
        self.assertIsNone(self.m.select_next())  # same actor cannot reenter
        self.m.settle(turn)
        self.rejection('STALE_SETTLEMENT', lambda: self.m.settle(turn))
        self.m.assert_conserved(self.m.actor(self.b))

    def test_supervisor_preempts_ready_data(self):
        self.m.send(self.a, self.b, self.m.allocate(self.a, b'x'))
        self.m.post_control(self.b, 'PANIC')
        self.assertEqual(self.m.select_next(), ('CONTROL', self.b, 'PANIC'))
        self.assertEqual(self.m.actors['b'].abandoned, 1)
        self.m.assert_conserved(self.m.actors['b'])
        self.rejection('STALE_ACTOR', lambda: self.m.send(self.a, self.b, self.m.allocate(self.a, b'late')))

    def test_control_precedes_all_pending_data(self):
        self.m.send(self.a, self.b, self.m.allocate(self.a, b'data'))
        refs = [self.m.spawn('control-' + str(n)) for n in range(5)]
        for ref in refs:
            self.m.post_control(ref, 'STOP')
        self.assertEqual([self.m.select_next()[0] for _ in range(5)], ['CONTROL'] * 5)
        self.assertEqual(self.m.select_next()[0], 'DATA')

    def test_stop_then_panic_upgrades_control(self):
        self.assertTrue(self.m.post_control(self.a, 'STOP'))
        self.assertFalse(self.m.post_control(self.a, 'PANIC'))
        self.assertEqual(self.m.select_next(), ('CONTROL', self.a, 'PANIC'))
        self.assertEqual(len(self.m.control), 0)

    def test_stop_drains_but_rejects_future_admission(self):
        self.m.send(self.a, self.b, self.m.allocate(self.a, b'x'))
        self.m.post_control(self.b, 'STOP')
        self.assertEqual(self.m.select_next()[2], 'STOP')
        self.rejection('MAILBOX_CLOSED', lambda: self.m.send(self.a, self.b, self.m.allocate(self.a, b'y')))
        kind, turn = self.m.select_next()
        self.assertEqual(kind, 'DATA')
        self.m.settle(turn)
        self.assertTrue(self.m.actors['b'].retired)

    def test_inflight_panic_waits_for_failed_settlement(self):
        self.m.send(self.a, self.b, self.m.allocate(self.a, b'x'))
        kind, turn = self.m.select_next()
        self.assertEqual(kind, 'DATA')
        self.m.post_control(self.b, 'PANIC')
        self.assertEqual(self.m.select_next()[0], 'CONTROL')
        self.assertFalse(self.m.actors['b'].retired)
        self.rejection('FENCED_TURN', lambda: self.m.settle(turn))
        self.m.settle(turn, failed=True)
        self.assertTrue(self.m.actors['b'].retired)
        self.assertEqual(self.m.actors['b'].failed, 1)

    def test_new_incarnation_fences_old_actor_ref(self):
        self.m.post_control(self.a, 'STOP')
        self.m.select_next()
        newer = self.m.spawn('a')
        self.assertEqual(newer.generation, 2)
        self.rejection('STALE_ACTOR', lambda: self.m.allocate(self.a, b'stale'))

    def test_control_queue_full_fails_loudly(self):
        m = RuntimeLoops(max_control=1)
        x, y = m.spawn('x'), m.spawn('y')
        m.post_control(x, 'PANIC')
        self.rejection('CONTROL_CAPACITY', lambda: m.post_control(y, 'PANIC'))
        self.assertEqual(len(m.control), 1)

    def test_fd_generation_fencing(self):
        old = self.m.register_io(self.a, 17)
        self.assertTrue(self.m.cancel_io(old))
        new = self.m.register_io(self.b, 17)
        self.assertFalse(self.m.notify_ready(old))
        self.assertTrue(self.m.notify_ready(new))
        self.assertFalse(self.m.cancel_io(old))
        self.assertTrue(self.m.poll_io(new))
        self.assertEqual(self.m.actor(self.b).admitted, 1)

    def test_reactor_park_wakeup_and_oneshot(self):
        token = self.m.register_io(self.a, 3)
        self.assertTrue(self.m.park_reactor())
        self.assertTrue(self.m.notify_ready(token))
        self.assertFalse(self.m.parked)
        self.assertEqual(self.m.wake_count, 1)
        self.assertFalse(self.m.notify_ready(token))
        self.assertFalse(self.m.park_reactor())
        self.assertTrue(self.m.poll_io(token))
        self.rejection('IO_REARM_ORDER', lambda: self.m.rearm_io(self.m.register_io(self.b, 4)))
        self.m.rearm_io(token)
        self.assertTrue(self.m.notify_ready(token))

    def test_io_backpressure_retains_pending_readiness(self):
        self.m.send(self.b, self.a, self.m.allocate(self.b, b'full'))
        token = self.m.register_io(self.a, 5)
        self.assertTrue(self.m.notify_ready(token))
        self.assertFalse(self.m.poll_io(token))
        self.rejection('IO_REARM_ORDER', lambda: self.m.rearm_io(token))
        _, turn = self.m.select_next()
        self.m.settle(turn)
        self.assertTrue(self.m.poll_io(token))
        self.assertEqual(self.m.actor(self.a).admitted, 2)

    def test_serial_actor_fair_round_robin(self):
        m = RuntimeLoops()
        source = m.spawn('source')
        a, b = m.spawn('a'), m.spawn('b')
        for target in [a, a, b, b]:
            m.send(source, target, m.allocate(source, b'x'))
        order = []
        for _ in range(4):
            kind, turn = m.select_next()
            self.assertEqual(kind, 'DATA')
            order.append(turn.actor.name)
            m.settle(turn)
        self.assertEqual(order, ['a', 'b', 'a', 'b'])


if __name__ == '__main__':
    unittest.main()
