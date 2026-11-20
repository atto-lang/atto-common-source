"""Conformance tests for the independent reference effect graph analyzer."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("effect_closure", HERE / "effect_closure.py")
effect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effect)

NONE = {k: "never" for k in effect.EFFECTS}


def graph(*nodes, entries=None):
    return {
        "schema_version": 1, "kind": "ores-effect-graph",
        "source_tree": "a" * 40,
        "producer": {"backend": "reference", "revision": "b" * 40},
        "entries": entries or [nodes[0]["id"]], "functions": list(nodes),
    }


def node(name, calls=(), **effects):
    return {"id": name, "calls": list(calls), "effects": dict(NONE, **effects)}


class EffectTests(unittest.TestCase):
    def check(self, payload, profile="hard_rt"):
        return effect.analyze(effect.parse_bytes(json.dumps(payload).encode()), [profile])["assessments"][profile]

    def test_bounded_pure_chain_and_canonical_hash(self):
        data = graph(node("entry", ["step"]), node("step", unbounded_work="bounded"))
        result = self.check(data)
        self.assertTrue(result["compatible_with_declared_facts"])
        self.assertEqual(result["entry_summaries"]["entry"]["unbounded_work"], "bounded")
        self.assertEqual(effect.analyze(data, ["hard_rt"])["canonical_input_sha256"],
                         effect.analyze(dict(reversed(list(data.items()))), ["hard_rt"])["canonical_input_sha256"])

    def test_transitive_indirect_allocation_witness(self):
        data = graph(node("entry", ["middle"]), node("middle", ["alloc"]), node("alloc", heap_alloc="bounded"))
        result = self.check(data)
        self.assertFalse(result["compatible_with_declared_facts"])
        self.assertEqual(result["issues"][0]["path"], ["entry", "middle", "alloc"])

    def test_cycles_converge(self):
        data = graph(node("a", ["b"]), node("b", ["a"], gc="unknown"))
        result = self.check(data, "zero_gc")
        self.assertFalse(result["compatible_with_declared_facts"])
        self.assertEqual(result["entry_summaries"]["a"]["gc"], "unknown")

    def test_unreachable_unsafe_code_does_not_affect_entry(self):
        data = graph(node("entry"), node("unused", runtime_codegen="unbounded"))
        self.assertTrue(self.check(data, "full_aot")["compatible_with_declared_facts"])

    def test_aot_gc_profiles_are_independent(self):
        data = graph(node("entry", gc="bounded", runtime_codegen="never"))
        self.assertTrue(self.check(data, "full_aot")["compatible_with_declared_facts"])
        self.assertFalse(self.check(data, "zero_gc")["compatible_with_declared_facts"])

    def test_unknown_is_never_silently_safe(self):
        data = graph(node("entry", blocking_io="unknown"))
        self.assertFalse(self.check(data)["compatible_with_declared_facts"])

    def test_every_effect_required(self):
        data = graph(node("entry"))
        del data["functions"][0]["effects"]["ffi"]
        with self.assertRaises(effect.InvalidGraph):
            self.check(data)

    def test_duplicate_json_key_rejected(self):
        data = b'{"schema_version":1,"schema_version":1}'
        with self.assertRaises(effect.InvalidGraph):
            effect.parse_bytes(data)

    def test_dangling_edge_rejected(self):
        data = graph(node("entry", ["not_found"]))
        with self.assertRaisesRegex(effect.InvalidGraph, "unresolved call"):
            self.check(data)

    def test_unknown_fields_rejected(self):
        data = graph(node("entry"))
        data["functions"][0]["trusted"] = True
        with self.assertRaises(effect.InvalidGraph):
            self.check(data)

    def test_duplicate_symbols_rejected(self):
        data = graph(node("entry"), node("entry"))
        with self.assertRaisesRegex(effect.InvalidGraph, "duplicate symbol"):
            self.check(data)

    def test_duplicate_calls_rejected(self):
        data = graph(node("entry", ["child", "child"]), node("child"))
        with self.assertRaisesRegex(effect.InvalidGraph, "duplicate callee"):
            self.check(data)

    def test_binary_input_size_bound(self):
        with self.assertRaises(effect.InvalidGraph):
            effect.parse_bytes(b"x" * (effect.MAX_INPUT_BYTES + 1))

    def test_depth_and_cycle_stress_iterative(self):
        nodes = [node(f"n{i}", [f"n{i+1}"] if i < 999 else ["n0"]) for i in range(1000)]
        nodes[852]["effects"]["ffi"] = "unknown"
        result = self.check(graph(*nodes), "full_aot")
        self.assertFalse(result["compatible_with_declared_facts"])
        self.assertEqual(result["entry_summaries"]["n0"]["ffi"], "unknown")

    def test_long_failure_path_is_explicitly_truncated(self):
        nodes = [node(f"n{i}", [f"n{i+1}"] if i < 70 else [],
                      **({"gc": "unknown"} if i == 70 else {})) for i in range(71)]
        result = self.check(graph(*nodes), "zero_gc")
        issue = result["issues"][0]
        self.assertEqual(issue["path_omitted_count"], 39)
        self.assertEqual(issue["path"][0], "n0")
        self.assertEqual(issue["path"][-1], "n70")

    def test_seeded_graph_closure_matches_independent_oracle(self):
        import random
        rng = random.Random(9817)
        for _ in range(200):
            n = rng.randint(1, 30)
            nodes = []
            for i in range(n):
                edges = sorted(rng.sample(range(n), rng.randint(0, min(n, 4))))
                attrs = {k: rng.choice(effect.LEVELS) for k in effect.EFFECTS}
                nodes.append(node(f"n{i}", [f"n{j}" for j in edges], **attrs))
            data = graph(*nodes)
            result = self.check(data, "hard_rt")
            # Independent brute-force reachability per entry, not effect fixed point.
            found, pending = set(), ["n0"]
            while pending:
                symbol = pending.pop()
                if symbol in found:
                    continue
                found.add(symbol)
                pending.extend(nodes[int(symbol[1:])]["calls"])
            for k in effect.EFFECTS:
                expected = max((nodes[int(x[1:])]["effects"][k] for x in found),
                               key=lambda value: effect.RANK[value])
                self.assertEqual(result["entry_summaries"]["n0"][k], expected)

    def test_malformed_revision_rejected(self):
        data = graph(node("entry"))
        data["producer"]["revision"] = "not_a_sha"
        with self.assertRaises(effect.InvalidGraph):
            self.check(data)

    def test_result_does_not_claim_certification(self):
        data = graph(node("entry"))
        result = effect.analyze(data, ["hard_rt"])
        self.assertIn("UNVERIFIED", result["status"])
        self.assertNotIn("certified", result)

    def test_cli_returns_incompatibility_code(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "graph.json"
            p.write_text(json.dumps(graph(node("entry", gc="unknown"))))
            proc = subprocess.run([sys.executable, str(HERE / "effect_closure.py"), str(p),
                                   "--profile", "zero_gc"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 2)
            self.assertFalse(json.loads(proc.stdout)["assessments"]["zero_gc"]["compatible_with_declared_facts"])

    def test_invalid_cli_never_returns_success(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "broken.json"
            p.write_text('{"bad":"payload"}')
            proc = subprocess.run([sys.executable, str(HERE / "effect_closure.py"), str(p),
                                   "--profile", "hard_rt"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 3)
            self.assertEqual(proc.stdout, "")


if __name__ == "__main__":
    unittest.main()
