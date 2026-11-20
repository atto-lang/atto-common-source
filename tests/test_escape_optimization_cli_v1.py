"""Source-only reference assertions for escape optimization CLI contract v1.

Not executable evidence that any backend implements an optimization.
"""
import json
import unittest
from pathlib import Path

CONTRACT = (Path(__file__).resolve().parents[1] / "contracts" / "v1" /
            "escape-optimization-cli-v1.json")


def policy(case):
    escape, jit, report = case["escape"], case["jit"], case["report"]
    if escape == "speculative" and jit != "on":
        return "reject-requires-jit"
    if escape == "off" and jit == "off" and not report:
        return "accept-off"
    if escape == "off" and jit == "on" and not report:
        return "require-executable-jit"
    if escape == "off" and report and jit == "off":
        return "require-evidence-provider"
    if escape == "safe" and jit == "off":
        return "require-safe-implementation"
    if escape == "safe" and jit == "on":
        return "require-safe-and-executable-jit"
    if escape == "verify" and jit == "off":
        return ("require-verified-implementation-and-evidence" if report
                else "require-verified-implementation")
    if escape == "speculative" and jit == "on":
        return "require-deoptimization-and-executable-jit"
    raise AssertionError("unlisted combination in reference contract")


class EscapeOptimizationPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_policy_vectors_unique_and_complete(self):
        vectors = self.contract["admission_vectors"]
        self.assertEqual(len(vectors), 10)
        self.assertEqual(len({c["id"] for c in vectors}), len(vectors))
        for c in vectors:
            with self.subTest(c=c["id"]):
                self.assertEqual(c["expect"], policy(c))

    def test_unsafe_promotion_never_falls_back_as_success(self):
        c = next(c.copy() for c in self.contract["admission_vectors"]
                 if c["id"] == "speculative-no-jit")
        c["expect"] = "require-deoptimization-and-executable-jit"
        self.assertNotEqual(c["expect"], policy(c))

    def test_defaults_transport_and_capabilities(self):
        c = self.contract
        self.assertEqual(c["defaults"], {"escape": "off", "jit": "off", "report": False})
        self.assertEqual(c["flag_transport"]["adapter"], "flags-2-env")
        self.assertEqual(c["flag_transport"]["duplicate_cli_policy"], "reject")
        self.assertEqual(set(c["backend_admission"]), {"java", "llvm", "net", "wasm", "forge"})
        self.assertIn("closed-world-point-x86_64-safe-experimental", c["backend_admission"]["forge"])
        self.assertEqual(c["experimental_native_slice"]["command"], "emit-alloc-asm x86_64")
        self.assertIn("not yet verified", c["experimental_native_slice"]["proof_status"])
        self.assertEqual(set(c["escape_modes"]), {"off", "safe", "verify", "speculative"})

    def test_release_gate_does_not_confuse_models_with_execution(self):
        c = self.contract
        self.assertEqual(len(c["required_optimization_proofs"]), 10)
        self.assertEqual(set(c["promotion_gates"]),
                         {"admission", "execution", "sanitizers", "allocation",
                          "suspension", "jit", "provenance"})
        self.assertIn("real compiler", c["promotion_gates"]["admission"])
        self.assertIn("executed", c["promotion_gates"]["suspension"])
        self.assertIn("exact", c["promotion_gates"]["provenance"])


if __name__ == "__main__":
    unittest.main()
