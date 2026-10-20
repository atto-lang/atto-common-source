import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "contracts/v1/fsm"))
import trace_v0 as m


class FSMTraceTests(unittest.TestCase):
    def test_layout_independent_replay(self):
        for length in range(7):
            for value in range(4 ** length):
                events = []
                code = value
                for turn in range(length):
                    event = code % 4
                    code //= 4
                    events.append(((event + turn) % 5, event))
                trace = m.generate(events)
                self.assertTrue(m.validate(trace))

    def test_rejected_noop_and_successful_self_edge(self):
        t = m.generate([(0, 0), (0, 2), (0, 1), (0, 1), (0, 2), (0, 3)])
        self.assertTrue(m.validate(t))
        steps = t["transitions"]
        self.assertFalse(steps[1]["accepted"])
        self.assertEqual(steps[1]["before"], steps[1]["after"])
        self.assertEqual(steps[1]["effects"], [])
        self.assertTrue(steps[2]["accepted"])
        self.assertEqual(steps[2]["before"]["state"], steps[2]["after"]["state"])
        self.assertEqual(steps[2]["after"]["version"], steps[2]["before"]["version"] + 1)

    def test_mutants_denied(self):
        original = m.generate([(0, 0), (0, 2), (0, 1)])
        self.assertTrue(m.validate(original))
        for field, value in (("effects", [9]), ("accepted", True), ("reason", "none"),
                             ("after", m.snap(9, 99, 0)), ("seq", 0)):
            mutant = copy.deepcopy(original)
            mutant["transitions"][1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                m.validate(mutant)
        mutant = copy.deepcopy(original)
        mutant["layout"] = "AoSoA"
        with self.assertRaises(ValueError):
            m.validate(mutant)

    def test_strict_json_trace_admission(self):
        original = m.generate([(0, 0), (0, 2), (0, 1), (1, 3)])
        wire = json.dumps(original, separators=(",", ":")).encode("utf-8")
        self.assertEqual(m.parse_trace(wire), original)
        self.assertEqual(m.parse_trace(wire.decode("utf-8")), original)

        # Python json.loads normally accepts duplicate fields with last-wins
        # semantics; an external guest trace must instead be unambiguous.
        duplicates = [
            wire[:-1] + b',"entity_count":5}',
            wire.replace(b'"seq":0,', b'"seq":0,"seq":0,', 1),
            wire.replace(b'"state":0,', b'"state":0,"state":0,', 1),
        ]
        for wire_mutant in duplicates:
            with self.subTest(kind="duplicate"), self.assertRaises(ValueError):
                m.parse_trace(wire_mutant)

        for wire_mutant in (
            b'{"contract":NaN}',
            b'{"contract":Infinity}',
            b'{"contract":-Infinity}',
            b'\xef\xbb\xbf' + wire,
            b'\xff' + wire,
            b' ' * (m.MAX_TRACE_BYTES + 1),
        ):
            with self.subTest(kind=wire_mutant[:30]), self.assertRaises(ValueError):
                m.parse_trace(wire_mutant)
        with self.assertRaises(ValueError):
            m.parse_trace(123)

    def test_unknown_and_overflow(self):
        for case in ((m.snap(99, 0, 0), 0, "invalid-state"),
                     (m.snap(0, 0, 4), 0, "invalid-ticks"),
                     (m.snap(0, m.LIMIT, 0), 0, "version-exhausted")):
            accepted, reason, after, effects = m.step(case[0], case[1])
            self.assertFalse(accepted)
            self.assertEqual((reason, after, effects), (case[2], case[0], []))


if __name__ == "__main__":
    unittest.main()
