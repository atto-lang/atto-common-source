"""Strict timing needs a termination proof; recursion alone is not one."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("effect_closure", ROOT / "effect_closure.py")
effect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effect)
ZERO = {key: "never" for key in effect.EFFECTS}


def sample(nodes):
    return {
        "schema_version": 1, "kind": "ores-effect-graph",
        "source_tree": "a" * 40,
        "producer": {"backend": "reference", "revision": "b" * 40},
        "entries": [nodes[0]["id"]], "functions": nodes,
    }


def node(name, calls):
    return {"id": name, "calls": calls, "effects": dict(ZERO)}


class RecursionGuardTests(unittest.TestCase):
    def test_mutual_recursion_rejected_for_hard_rt(self):
        graph = sample([node("entry", ["left"]), node("left", ["right"]),
                        node("right", ["left"])])
        result = effect.analyze(graph, ["hard_rt"])["assessments"]["hard_rt"]
        self.assertFalse(result["compatible_with_declared_facts"])
        self.assertTrue(any(x.get("reason") == "recursive_call_graph_requires_termination_proof"
                            for x in result["issues"]))

    def test_recursion_does_not_imply_a_gc_or_jit_requirement(self):
        graph = sample([node("entry", ["entry"])])
        result = effect.analyze(graph, ["zero_gc", "full_aot"])["assessments"]
        self.assertTrue(result["zero_gc"]["compatible_with_declared_facts"])
        self.assertTrue(result["full_aot"]["compatible_with_declared_facts"])

    def test_cli_rejects_oversized_file_before_parsing(self):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "oversize.json"
            path.write_bytes(b"x" * (effect.MAX_INPUT_BYTES + 4096))
            result = subprocess.run([sys.executable, str(ROOT / "effect_closure.py"),
                                     str(path), "--profile", "hard_rt"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 3)
            self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
