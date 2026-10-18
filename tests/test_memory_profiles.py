"""Adversarial, source-free tests of the memory evidence consistency checker.

These use synthetic records, not runtime or compiler evidence.
"""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "memory_gate", ROOT / "scripts" / "verify_memory_release_evidence.py"
)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
MANIFEST = json.loads(
    (ROOT / "contracts/v1/memory-runtime-profiles.json").read_text(encoding="utf-8")
)


def synthetic_record(name):
    profile = MANIFEST["profiles"][name]
    return {
        "schema_version": 1, "profile": name, "delivery": profile["delivery"],
        "source_tree_sha": "a" * 40, "fixture_blob_sha": "b" * 40,
        "binary_sha256": "c" * 64, "run_id": 12, "job_id": 13,
        "executed_steps": 4, "executed_guest_tests": 22,
        "failed_tests": 0, "skipped_tests": 0, "errored_tests": 0,
        "run_conclusion": "success", "execution_kind": "compiled-guest",
        "host_gc_policy": profile["host_gc"], "guest_gc_policy": profile["guest_gc"],
        "proofs": {key: True for key in MANIFEST["shared_proofs"] + profile["proofs"]},
        "metrics": {key: 0 for key in profile["metrics"]},
    }


class MemoryProfileEvidenceTest(unittest.TestCase):
    def test_manifest_covers_six_target_modes(self):
        self.assertEqual(len(gate.validate_manifest(MANIFEST)), 6)

    def test_synthetic_structure_only_not_a_proof(self):
        for name in MANIFEST["profiles"]:
            with self.subTest(name=name):
                self.assertEqual(gate.check_record(MANIFEST, synthetic_record(name)), name)

    def reject(self, name, mutator):
        data = synthetic_record(name)
        mutator(data)
        with self.assertRaises(gate.MemoryEvidenceError):
            gate.check_record(MANIFEST, data)

    def test_no_zero_step_or_empty_guest_run(self):
        self.reject("llvm-native", lambda r: r.update(executed_steps=0))
        self.reject("llvm-native", lambda r: r.update(executed_guest_tests=0))
        self.reject("llvm-native", lambda r: r.update(execution_kind="host-model"))

    def test_no_failed_skipped_errored_or_false_success(self):
        for field in ("failed_tests", "skipped_tests", "errored_tests"):
            self.reject("llvm-native", lambda r: r.update({field: 1}))
            self.reject("llvm-native", lambda r: r.update({field: False}))
        self.reject("llvm-native", lambda r: r.update(run_conclusion="cancelled"))

    def test_no_missing_or_false_borrow_proofs(self):
        p = MANIFEST["shared_proofs"][0]
        self.reject("wasm32-core", lambda r: r["proofs"].pop(p))
        self.reject("wasm32-core", lambda r: r["proofs"].update({p: False}))
        self.reject("wasm32-core", lambda r: r["proofs"].update({p: 1}))

    def test_no_retirement_claim_without_abandoned_frame_cleanup_ack(self):
        proof = "abandoned_frame_cleanup_ack_before_retirement"
        self.assertIn(proof, MANIFEST["shared_proofs"])
        for name in MANIFEST["profiles"]:
            with self.subTest(profile=name):
                self.reject(name, lambda r: r["proofs"].pop(proof))
                self.reject(name, lambda r: r["proofs"].update({proof: False}))
                self.reject(name, lambda r: r["proofs"].update({proof: 1}))

    def test_no_nonzero_strict_gc_or_wasm_gc(self):
        self.reject("llvm-native", lambda r: r["metrics"].update(tracing_gc_invocations=1))
        self.reject("wasm32-core", lambda r: r["metrics"].update(wasm_gc_opcode_count=1))
        self.reject("embedded-freestanding",
                    lambda r: r["metrics"].update(post_init_heap_alloc_bytes_in_no_alloc_region=1))

    def test_no_hidden_allocations_in_graal_hot_path(self):
        for name in ("graal-jvm", "graal-native-image"):
            metric = "steady_state_guest_hot_loop_alloc_bytes_per_op"
            self.reject(name, lambda r: r["metrics"].update({metric: 0.01}))

    def test_no_fake_aot_or_host_gc_boundary(self):
        self.reject("llvm-native", lambda r: r.update(delivery="jvm-jit"))
        self.reject("graal-native-image", lambda r: r.update(delivery="jvm-jit"))
        self.reject("wasm32-core", lambda r: r.update(host_gc_policy="forbidden"))
        self.reject("graal-jvm", lambda r: r.update(guest_gc_policy="forbidden"))

    def test_invalid_provenance_and_metrics(self):
        self.reject("desktop-native", lambda r: r.update(source_tree_sha="abc"))
        self.reject("desktop-native", lambda r: r.update(binary_sha256="x" * 64))
        self.reject("desktop-native", lambda r: r["metrics"].update(alloc_bytes_per_operation=-1))
        self.reject("desktop-native", lambda r: r["metrics"].update(alloc_bytes_per_operation=True))
        self.reject("desktop-native", lambda r: r["metrics"].update(alloc_bytes_per_operation=float("nan")))

    def test_schema_and_unhashable_profile_fail_closed(self):
        for name in ("llvm-native", "graal-jvm"):
            self.reject(name, lambda r: r.update(schema_version=True))
            self.reject(name, lambda r: r.update(profile=["invalid"]))
        manifest = copy.deepcopy(MANIFEST)
        manifest["schema_version"] = True
        with self.assertRaises(gate.MemoryEvidenceError):
            gate.validate_manifest(manifest)

    def test_duplicate_evidence_json_keys_rejected(self):
        with self.assertRaisesRegex(gate.MemoryEvidenceError, "duplicate JSON field"):
            gate.parse_json('{"run_id":1, "run_id":2}')
        with self.assertRaisesRegex(gate.MemoryEvidenceError, "duplicate JSON field"):
            gate.parse_json('{"metrics":{"tracing_gc_invocations":0,"tracing_gc_invocations":1}}')

    def test_extra_manifest_proof_not_silently_ignored(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["shared_proofs"].append("new_mandatory_borrow_boundary")
        with self.assertRaises(gate.MemoryEvidenceError):
            gate.check_record(manifest, synthetic_record("llvm-native"))


if __name__ == "__main__":
    unittest.main()
