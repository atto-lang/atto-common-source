"""Negative and positive controls for compiler-fact static analysis prototype."""
import copy
import unittest

from scripts.static_facts_analyzer import InvalidFacts, analyze, strongly_connected


def facts():
    return {
        "version": "ores-static-facts/v0",
        "unit": "test",
        "procedures": [
            {"id": "main", "loops": []},
            {"id": "worker", "loops": []},
            {"id": "done", "loops": []},
        ],
        "edges": [],
        "taint_sources": [],
        "flows": [],
        "sinks": [],
        "permission_checks": [],
    }


def edge(a, b, kind="call", fanout=1, guard="unproved"):
    return {"from": a, "to": b, "kind": kind, "fanout": fanout, "guard": guard}


def rules(doc):
    return [r["rule"] for r in analyze(doc)]


class StaticFactsTests(unittest.TestCase):
    def test_clean_program(self):
        self.assertEqual(analyze(facts()), [])

    def test_unknown_loop_and_no_safepoint(self):
        f = facts()
        f["procedures"][0]["loops"] = [{"id": "L1", "exit": "unknown", "safepoint": False}]
        self.assertEqual(rules(f), ["ORES-TERM-002", "ORES-TERM-003"])

    def test_proved_no_exit_and_safepoint(self):
        f = facts()
        f["procedures"][0]["loops"] = [{"id": "L", "exit": "proved_no_exit", "safepoint": True}]
        self.assertEqual(rules(f), ["ORES-TERM-001"])

    def test_proved_terminates_avoids_loop_diagnostic(self):
        f = facts()
        f["procedures"][0]["loops"] = [{"id": "L", "exit": "proved_terminates", "safepoint": False}]
        self.assertEqual(rules(f), [])

    def test_spawn_thirty_cycle(self):
        f = facts()
        f["edges"] = [edge("main", "worker", "actor_spawn", 30), edge("worker", "main")]
        results = analyze(f)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["rule"], "ORES-AMP-001")
        self.assertEqual(results[0]["severity"], "error")
        self.assertEqual(results[0]["confidence"], "potential")
        self.assertEqual(results[0]["witness"], ["main", "worker"])

    def test_unbounded_loop_repeated_spawn_without_cycle(self):
        f = facts()
        f["procedures"][0]["loops"] = [{"id": "retry_loop", "exit": "unknown", "safepoint": True}]
        f["edges"] = [{**edge("main", "worker", "actor_spawn", 30), "enclosing_loop": "retry_loop"}]
        self.assertEqual(rules(f), ["ORES-AMP-005", "ORES-TERM-002"])

    def test_unknown_fanout_cycle(self):
        f = facts()
        f["edges"] = [edge("main", "worker", "actor_spawn", "unknown"), edge("worker", "main")]
        self.assertEqual(rules(f), ["ORES-AMP-001"])

    def test_invalid_enclosing_loop_rejected(self):
        f = facts()
        f["edges"] = [{**edge("main", "worker"), "enclosing_loop": "missing"}]
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_single_spawn_without_cycle(self):
        f = facts()
        f["edges"] = [edge("main", "worker", "actor_spawn", 30)]
        self.assertEqual(rules(f), [])

    def test_proven_finite_total_cycle_bound(self):
        f = facts()
        f["edges"] = [edge("main", "worker", "actor_spawn", 30, "proved_bounded"), edge("worker", "main")]
        self.assertEqual(rules(f), [])

    def test_task_and_message_cycles(self):
        f = facts()
        f["edges"] = [edge("main", "main", "task_spawn")]
        self.assertEqual(rules(f), ["ORES-AMP-002"])
        f["edges"] = [edge("main", "worker", "message"), edge("worker", "main")]
        self.assertEqual(rules(f), ["ORES-AMP-003"])

    def test_recursive_call_and_long_acyclic_path(self):
        f = facts()
        f["edges"] = [edge("main", "worker"), edge("worker", "main")]
        self.assertEqual(rules(f), ["ORES-AMP-004"])
        f["edges"] = [edge("main", "worker"), edge("worker", "done")]
        self.assertEqual(rules(f), [])

    def test_scc_cross_edges_do_not_make_false_cycles(self):
        nodes = ["a", "b", "c", "d"]
        edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("d", "b"), edge("c", "d")]
        groups = strongly_connected(nodes, edges)
        self.assertIn(["b", "d"], groups)
        self.assertIn(["a"], groups)
        self.assertIn(["c"], groups)

    def test_taint_propagation_witness_and_exact_sanitization(self):
        f = facts()
        f["taint_sources"] = [{"id": "http.body", "class": "untrusted"}]
        f["flows"] = [{"from": "http.body", "to": "command"}, {"from": "command", "to": "exec"}]
        f["sinks"] = [{"id": "exec", "risk": "shell"}]
        r = analyze(f)
        self.assertEqual(r[0]["rule"], "ORES-SEC-001")
        self.assertEqual(r[0]["witness"], ["http.body", "command", "exec"])
        f["flows"][1]["validated_for"] = ["file_path"]
        self.assertEqual(rules(f), ["ORES-SEC-001"], "wrong sanitizer type cannot bypass")
        f["flows"][1]["validated_for"] = ["shell"]
        self.assertEqual(rules(f), [])

    def test_secret_log_does_not_mix_with_untrusted(self):
        f = facts()
        f["taint_sources"] = [{"id": "token", "class": "secret"}, {"id": "http", "class": "untrusted"}]
        f["flows"] = [{"from": "token", "to": "log"}, {"from": "http", "to": "log"}]
        f["sinks"] = [{"id": "log", "risk": "secret_log"}]
        self.assertEqual(rules(f), ["ORES-SEC-001"])

    def test_ceiling_mismatch(self):
        f = facts()
        f["permission_checks"] = [{"id": "untrusted-child", "requested": ["ffi", "net"], "ceiling": ["net"]}]
        r = analyze(f)
        self.assertEqual(r[0]["rule"], "ORES-SEC-002")
        self.assertIn("ffi", r[0]["message"])

    def test_unknown_rule_fails_closed(self):
        f = facts()
        f["edges"] = [edge("main", "worker", "unsupported_dispatch")]
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_bad_proofs_and_non_integer_fanout_fail_closed(self):
        f = facts()
        f["edges"] = [edge("main", "worker", fanout=True)]
        with self.assertRaises(InvalidFacts):
            analyze(f)
        f["edges"] = [edge("main", "worker", guard="maybe_bounded")]
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_missing_or_extra_fields_fail_closed(self):
        f = facts()
        del f["sinks"]
        with self.assertRaises(InvalidFacts):
            analyze(f)
        f = facts()
        f["unrecognized_required_feature"] = "x"
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_diagnostics_are_stable(self):
        f = facts()
        f["edges"] = [edge("main", "worker"), edge("worker", "main")]
        self.assertEqual(analyze(copy.deepcopy(f)), analyze(copy.deepcopy(f)))


if __name__ == "__main__":
    unittest.main()
