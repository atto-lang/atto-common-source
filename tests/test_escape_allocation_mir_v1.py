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


# A complete-effect-graph bit is a verifier assertion, not a license to
# default omitted typing, allocation effects, or unrecognized uses to safety.
USE_KINDS = {"FieldRead", "FieldWrite", "LocalBorrow"} | ESCAPING_USES
CASE_FIELDS = {
    "id", "complete", "effects", "expected", "value_type", "size_bytes",
    "alignment", "stack_budget_bytes", "allocator_effect_observable",
    "custom_drop", "dynamic_extent", "volatile_or_atomic", "lifetime_proven",
}


def candidate(case):
    preserve = "preserve-allocation"
    if not isinstance(case, dict) or set(case) - CASE_FIELDS:
        return preserve
    if case.get("complete") is not True:
        return preserve
    if case.get("value_type") not in ("NominalRecord", "FixedArray"):
        return preserve
    # The MIR allocation model says allocator effects are observable by
    # default. Only a verifier's explicit False can enable optimization.
    if case.get("allocator_effect_observable") is not False:
        return preserve
    if any(case.get(flag, False) is not False for flag in (
            "custom_drop", "dynamic_extent", "volatile_or_atomic")):
        return preserve
    effects = case.get("effects")
    if (not isinstance(effects, list) or
            any(not isinstance(effect, str) or effect not in USE_KINDS
                for effect in effects)):
        return preserve
    size = case.get("size_bytes")
    alignment = case.get("alignment")
    if (type(size) is not int or size <= 0 or type(alignment) is not int or
            alignment <= 0 or alignment > 64 or
            (alignment & (alignment - 1)) != 0):
        return preserve
    if set(effects) & ESCAPING_USES:
        return preserve
    if "LocalBorrow" not in effects:
        return "scalar-candidate"
    if case.get("lifetime_proven") is not True:
        return preserve
    budget = case.get("stack_budget_bytes", 4096)
    if type(budget) is not int or budget <= 0:
        return preserve
    # Round one slot's footprint. Multiple concurrent candidates require
    # cumulative frame accounting in a real verified MIR pass, not this model.
    rounded = (size + alignment - 1) & ~(alignment - 1)
    if rounded > budget:
        return preserve
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

    def test_missing_and_corrupt_mir_metadata_fail_closed(self):
        base = next(dict(c) for c in self.data["cases"]
                    if c["id"] == "local-record-scalar")
        for change in (
            {"allocator_effect_observable": None},
            {"complete": "true"},
            {"effects": ["FieldRead", "FutureUnknownEffect"]},
            {"effects": ["FieldRead", 42]},
            {"value_type": "Unknown"},
            {"size_bytes": 0},
            {"size_bytes": True},
            {"alignment": 3},
            {"alignment": 128},
            {"unexpected_ffi_capture": True},
            {"custom_drop": "false"},
        ):
            with self.subTest(change=change):
                self.assertEqual(candidate({**base, **change}),
                                 "preserve-allocation")
        for missing in ("complete", "value_type", "size_bytes",
                        "alignment", "allocator_effect_observable", "effects"):
            with self.subTest(missing=missing):
                damaged = dict(base)
                damaged.pop(missing)
                self.assertEqual(candidate(damaged), "preserve-allocation")

    def test_rounded_stack_slot_not_raw_payload(self):
        base = next(dict(c) for c in self.data["cases"]
                    if c["id"] == "proven-local-borrow-stack")
        # 17 payload bytes at 16-byte alignment cost 32 stack bytes.
        self.assertEqual(candidate({**base, "size_bytes": 17,
                                    "alignment": 16,
                                    "stack_budget_bytes": 31}),
                         "preserve-allocation")
        self.assertEqual(candidate({**base, "size_bytes": 17,
                                    "alignment": 16,
                                    "stack_budget_bytes": 32}),
                         "stack-candidate")

    def test_mutation_detected(self):
        case = next(dict(c) for c in self.data["cases"]
                    if c["id"] == "escape-actorsend")
        case["expected"] = "scalar-candidate"
        self.assertNotEqual(case["expected"], candidate(case))

    def test_native_slice_is_distinct_from_general_backend_parity(self):
        fixture = self.data["source_fixture"]["text"]
        self.assertIn("define struct Point as\n", fixture)
        self.assertIn("return p.x + p.y;", fixture)
        scope = self.data["forge_experiment"]
        self.assertIn("exact-head", scope["status"])
        self.assertEqual(scope["subcommands"],
                         ["ir-alloc", "emit-alloc-asm x86_64"])
        self.assertEqual(len(scope["ctests"]), 2)
        self.assertIn("general source MIR", scope["excluded"])
        self.assertIn("observable allocator hooks", scope["excluded"])

    def test_release_gates_are_executable_not_models(self):
        gates = self.data["release_gates"]
        self.assertIn("Emit executable", gates["compiler-lowering"])
        self.assertIn("actual compiled workloads", gates["sanitizers"])
        self.assertIn("independently executed", gates["cross-backend"])
        self.assertEqual(self.data["source_fixture"]["status"],
                         "illustrative only, not accepted by Forge scalar parser")


if __name__ == "__main__":
    unittest.main()
