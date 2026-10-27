"""Reference-only integrity tests for typed allocation MIR candidate decisions.

Do not confuse the reference model with Forge source lowering or full JIT.
"""
import json
import unittest
from pathlib import Path

FILE = (Path(__file__).resolve().parents[1] / "contracts" / "v1" /
        "escape-allocation-mir-v1.json")
ESCAPING_USES = {
    "Return", "Capture", "ActorSend", "ChannelSend", "Ffi",
    "UnknownCall", "Suspend", "IdentityObserve", "StoreGlobal",
    "UnsafePointer", "Transfer",
}


def candidate(case):
    if not case["complete"]:
        return "preserve-allocation"
    if (case.get("allocator_effect_observable", False) or
            case.get("custom_drop", False) or
            case.get("dynamic_extent", False) or
            case.get("volatile_or_atomic", False) or
            case.get("value_type", "NominalRecord") not in ("NominalRecord", "FixedArray")):
        return "preserve-allocation"
    effects = set(case["effects"])
    if effects & ESCAPING_USES:
        return "preserve-allocation"
    if "LocalBorrow" not in effects:
        return "scalar-candidate"
    if not case.get("lifetime_proven", False):
        return "preserve-allocation"
    if (case.get("alignment", 8) > 64 or
            case.get("size_bytes", 16) > case.get("stack_budget_bytes", 4096)):
        return "preserve-allocation"
    return "stack-candidate"


class TypedAllocationMirContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(FILE.read_text(encoding="utf-8"))

    def test_contract_policy_and_closed_world(self):
        data = self.data
        self.assertEqual(data["contract"], "oreslang.escape-allocation-mir.v1")
        self.assertIn("not source lowering", data["status"])
        self.assertIn("independent verifier", data["producer_requirement"])
        self.assertEqual(data["default_stack_budget_bytes"], 4096)
        self.assertEqual(data["max_stack_alignment_bytes"], 64)
        self.assertIn("deoptimization", data["excluded_until_proven"])
        self.assertEqual(set(data["classifications"]),
                         {"scalar-candidate", "stack-candidate", "preserve-allocation"})

    def test_vectors_have_distinct_id_and_consistent_result(self):
        cases = self.data["cases"]
        self.assertEqual(len(cases), 22)
        self.assertEqual(len(cases), len({c["id"] for c in cases}))
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertEqual(candidate(case), case["expected"])

    def test_escape_boundaries_all_reject(self):
        cases = self.data["cases"]
        exercised = set()
        for case in cases:
            exercised |= set(case["effects"]) & ESCAPING_USES
        self.assertEqual(exercised, ESCAPING_USES)
        self.assertEqual({c["expected"] for c in cases if
                          set(c["effects"]) & ESCAPING_USES},
                         {"preserve-allocation"})

    def test_mutation_detected(self):
        case = next(dict(c) for c in self.data["cases"]
                    if c["id"] == "escape-actorsend")
        case["expected"] = "scalar-candidate"
        self.assertNotEqual(case["expected"], candidate(case))

    def test_release_gates_are_executable_not_models(self):
        gates = self.data["release_gates"]
        self.assertIn("Emit executable", gates["compiler-lowering"])
        self.assertIn("actual compiled workloads", gates["sanitizers"])
        self.assertIn("independently executed", gates["cross-backend"])
        self.assertEqual(self.data["source_fixture"]["status"],
                         "illustrative only, not accepted by Forge scalar parser")


if __name__ == "__main__":
    unittest.main()
