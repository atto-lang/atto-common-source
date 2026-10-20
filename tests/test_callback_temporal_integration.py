"""High-value regression cases for the fact-level callback checker."""
import random
import unittest
from scripts.callback_temporal_reference import analyze, InvalidFacts
from tests.test_callback_temporal_reference import example


class TemporalIntegrationTests(unittest.TestCase):
    def test_after_actor_turn_is_safe_only_if_registration_precedes_boundary(self):
        doc = example('after_actor_turn')
        nodes = doc['procedures'][0]['nodes']
        nodes[0]['lane'] = 'actor_lane'
        nodes[0]['serial_turn_proven'] = True
        # A syntactic leaf is not a verified scheduler turn boundary.
        self.assertIn('ORES-CB-002', [f['rule'] for f in analyze(doc)])
        nodes[1]['next'] = ['complete']
        nodes.append({'id': 'complete', 'kind': 'end_turn', 'next': []})
        self.assertEqual(analyze(doc), [])
        # Await may be a no-op on an already-completed Future.
        nodes[0]['next'] = ['yield']
        nodes.append({'id': 'yield', 'kind': 'await', 'next': ['sub']})
        self.assertIn('ORES-CB-002', [f['rule'] for f in analyze(doc)])

    def test_deferred_turn_with_abrupt_path_fails_closed(self):
        doc = example('after_actor_turn')
        nodes = doc['procedures'][0]['nodes']
        nodes[0].update(lane='actor_lane', serial_turn_proven=True)
        nodes[0]['next'] = ['sub', 'abort']
        nodes[1]['next'] = ['complete']
        nodes.extend([
            {'id': 'complete', 'kind': 'end_turn', 'next': []},
            {'id': 'abort', 'kind': 'noop', 'next': []},
        ])
        self.assertIn('ORES-CB-002', [f['rule'] for f in analyze(doc)])

    def test_deferred_not_equivalent_to_safe_registration(self):
        self.assertEqual([x['rule'] for x in analyze(example('deferred'))], ['ORES-CB-002'])

    def test_borrow_escape_and_reentrant_loan(self):
        doc = example('mixed', True)
        doc['procedures'][0]['nodes'][0].update(
            captures=[{'name': 'local', 'kind': 'exclusive', 'lifetime': 'call', 'sendable': False}],
            active_mutable_loans=['local'])
        self.assertEqual([x['rule'] for x in analyze(doc)],
                         ['ORES-CB-001', 'ORES-CB-003', 'ORES-CB-004'])

    def test_multiple_completion_and_unknown_strict(self):
        doc = example('unknown', True)
        doc['procedures'][0]['strict'] = True
        doc['procedures'][0]['nodes'][0].update(expected_invocations='at_most_once', invocations='many')
        self.assertEqual([x['rule'] for x in analyze(doc)],
                         ['ORES-CB-001', 'ORES-CB-005', 'ORES-CB-006'])

    def test_replayable_event_may_register_after_producer(self):
        doc = example('deferred')
        doc['procedures'][0]['nodes'][0]['publishes'][0]['replayable'] = True
        self.assertEqual(analyze(doc), [])

    def test_dynamic_alias_does_not_masquerade_as_proven_subscription(self):
        doc = example('deferred', True)
        doc['procedures'][0]['nodes'][0]['publishes'][0]['emitter'] = '*'
        self.assertEqual([x['rule'] for x in analyze(doc)], ['ORES-CB-002'])

    def test_nonserialized_actor_turn_cannot_prove_order(self):
        doc = example('after_actor_turn')
        doc['procedures'][0]['nodes'][0]['lane'] = 'actor_lane'
        self.assertEqual([x['rule'] for x in analyze(doc)], ['ORES-CB-002'])

    def test_requested_subscription_not_same_as_installed_listener(self):
        doc = example('deferred', True)
        doc['procedures'][0]['nodes'][1]['kind'] = 'request_subscribe'
        self.assertEqual([x['rule'] for x in analyze(doc)], ['ORES-CB-002'])

    def test_schema_unknown_fields_fail_closed(self):
        doc = example()
        doc['procedures'][0]['nodes'][0]['not_a_real_proof'] = 'trusted'
        with self.assertRaises(InvalidFacts):
            analyze(doc)

    def test_random_dag_against_exhaustive_event_ordering(self):
        rng = random.Random(1807)
        for _ in range(500):
            count = rng.randrange(3, 12)
            nodes = []
            for i in range(count - 1):
                next_ids = rng.sample(list(range(i + 1, count)), rng.randrange(1, min(3, count-i)))
                kind = rng.choice(['noop', 'subscribe', 'unsubscribe'])
                node = {'id': str(i), 'kind': kind, 'next': [str(j) for j in next_ids]}
                if kind != 'noop':
                    node.update(emitter='e', event='done')
                nodes.append(node)
            nodes.append({'id': str(count-1), 'kind': 'launch', 'next': [], 'api': 'start',
                          'timing': 'deferred', 'publishes': [{'emitter':'e', 'event':'done'}]})
            doc = {'version':'ores-callback-facts/v0', 'procedures': [{'id':'main','entry':'0','nodes':nodes}]}
            if not any(n['kind'] == 'subscribe' for n in nodes):
                continue
            index = {n['id']: n for n in nodes}
            pending = [('0', False)]
            lost = False
            while pending:
                nid, subscribed = pending.pop()
                n = index[nid]
                if n['kind'] == 'subscribe':
                    subscribed = True
                elif n['kind'] == 'unsubscribe':
                    subscribed = False
                if n['kind'] == 'launch' and not subscribed:
                    lost = True
                pending.extend((next_id, subscribed) for next_id in n['next'])
            actual = any(f['rule'] == 'ORES-CB-002' for f in analyze(doc))
            self.assertEqual(actual, lost, doc)


if __name__ == '__main__':
    unittest.main()
