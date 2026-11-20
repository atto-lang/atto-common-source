"""Negative and positive controls for compiler-fact static analysis prototype."""
import copy
import unittest

from scripts.static_facts_analyzer import InvalidFacts, analyze, strongly_connected, reject_duplicate_keys


def facts():
    return {
        "version": "ores-static-facts/v0",
        "unit": "sha256:" + "0"*64,
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

    def test_schema_and_consumer_share_restricted_limits(self):
        import json
        from pathlib import Path
        schema = json.loads((Path(__file__).resolve().parents[1] /
            "contracts/analysis/static-facts.v0.schema.json").read_text())
        self.assertEqual(schema["properties"]["procedures"]["maxItems"], 512)
        self.assertEqual(schema["properties"]["edges"]["maxItems"], 8192)
        self.assertEqual(schema["properties"]["procedures"]["items"]
            ["properties"]["loops"]["maxItems"], 256)
        self.assertEqual(schema["properties"]["unit"]["pattern"],
            r"^sha256:[0-9a-f]{64}$")

    def test_bad_source_hash_and_duplicate_call_edge_rejected(self):
        f = facts()
        f["unit"] = "free-form-unreviewed"
        with self.assertRaises(InvalidFacts):
            analyze(f)
        f["unit"] = "sha256:" + "A"*64
        with self.assertRaises(InvalidFacts):
            analyze(f)
        f["unit"] = "sha256:" + "0"*64
        f["edges"] = [edge("main", "worker"), edge("main", "worker")]
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_per_function_and_global_loop_budget_enforced(self):
        f = facts()
        f["procedures"][0]["loops"] = [
            {"id": f"L{i}", "exit": "unknown", "safepoint": False}
            for i in range(257)]
        with self.assertRaises(InvalidFacts):
            analyze(f)
        f = facts()
        f["procedures"] = [
            {"id": f"f{i}", "loops": [
                {"id": f"L{j}", "exit": "unknown", "safepoint": False}
                for j in range(256)]}
            for i in range(17)]
        with self.assertRaises(InvalidFacts):
            analyze(f)

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
        self.assertEqual(results[0]["witness"], ["main", "worker", "main"])

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

    def test_mixed_timing_publish_before_register_is_zalgo(self):
        f = facts()
        f["callback_orderings"] = [{
            "id": "example", "emitter": "randie", "event": "done",
            "publisher": "doMore", "invocation_timing": "mixed",
            "order": "publish_first", "registration_continuation": "same_uninterrupted_turn", "registration_completion": "proved_sync_install",
        }]
        self.assertEqual(rules(f), ["ORES-CB-002"])

    def test_safe_registration_first_and_true_after_turn(self):
        f = facts()
        e = {"id": "example", "emitter": "randie", "event": "done",
             "publisher": "doMore", "invocation_timing": "mixed",
             "order": "register_first", "registration_continuation": "same_uninterrupted_turn", "registration_completion": "proved_sync_install"}
        f["callback_orderings"] = [e]
        self.assertEqual(rules(f), [])
        e["order"] = "publish_first"
        e["invocation_timing"] = "deferred_after_turn"
        self.assertEqual(rules(f), [])
        e["registration_continuation"] = "may_suspend"
        self.assertEqual(rules(f), ["ORES-CB-002"])

    def test_requested_registration_is_not_proven_installation(self):
        f = facts()
        e = {"id": "x", "emitter": "randie", "event": "done",
             "publisher": "doMore", "invocation_timing": "mixed",
             "order": "register_first", "registration_continuation": "same_uninterrupted_turn",
             "registration_completion": "unproved"}
        f["callback_orderings"] = [e]
        self.assertEqual(rules(f), ["ORES-CB-006"])

    def test_unknown_order_or_concurrent_callback_warns(self):
        f = facts()
        e = {"id": "example", "emitter": "stream", "event": "ready",
             "publisher": "start", "invocation_timing": "concurrent",
             "order": "unknown", "registration_continuation": "unknown", "registration_completion": "unproved"}
        f["callback_orderings"] = [e]
        self.assertEqual(rules(f), ["ORES-CB-002"])
        e["order"] = "publish_first"
        self.assertEqual(rules(f), ["ORES-CB-002"])

    def test_bad_callback_facts_fail_closed(self):
        f = facts()
        f["callback_orderings"] = [{
            "id": "example", "emitter": "stream", "event": "ready",
            "publisher": "start", "invocation_timing": "definitely_safe",
            "order": "publish_first", "registration_continuation": "unknown", "registration_completion": "unproved",
        }]
        with self.assertRaises(InvalidFacts):
            analyze(f)

    def test_duplicate_json_key_rejected(self):
        with self.assertRaises(InvalidFacts):
            reject_duplicate_keys([("version", "good"), ("version", "bad")])

    def test_many_taint_sources_one_witness_per_sink(self):
        f = facts()
        f["taint_sources"] = [
            {"id": "first", "class": "untrusted"},
            {"id": "second", "class": "untrusted"},
        ]
        f["flows"] = [
            {"from": "first", "to": "mid"},
            {"from": "mid", "to": "exec"},
            {"from": "second", "to": "exec"},
        ]
        f["sinks"] = [{"id": "exec", "risk": "shell"}]
        result = analyze(f)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["witness"], ["second", "exec"])

    def test_diagnostics_are_stable(self):
        f = facts()
        f["edges"] = [edge("main", "worker"), edge("worker", "main")]
        self.assertEqual(analyze(copy.deepcopy(f)), analyze(copy.deepcopy(f)))


if __name__ == "__main__":
    unittest.main()
