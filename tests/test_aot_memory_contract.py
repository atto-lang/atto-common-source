"""Source-free structural invariants, NOT a compiled AttoLang AOT test."""
import copy
import json
import pathlib
import unittest

SPEC = pathlib.Path(__file__).resolve().parents[1] / "contracts/aot-memory-isolation-v1.json"
CONTRACT = json.loads(SPEC.read_text())


def validate(c):
    assert c["schema"] == "atto.aot-memory-isolation.v1"
    assert c["status"] == "SPECIFICATION_ONLY_NOT_EXECUTED"
    modes = c["profiles"]
    required = {
        "llvm-native-aot", "graal-native-epsilon-aot", "graal-native-managed-aot",
        "java-jvm-low-gc", "wasm-precompiled-aot", "forge-native-aot",
        "net-native-aot",
    }
    assert set(modes) == required
    aot = modes["llvm-native-aot"]
    assert aot["native_machine_aot"] is True
    assert aot["runtime_jit"] is False and aot["tracing_gc"] == "forbidden"
    eps = modes["graal-native-epsilon-aot"]
    assert eps["native_machine_aot"] is True and eps["runtime_jit"] is False
    assert eps["selected_gc"] == "epsilon" and eps["tracing_gc"] == "forbidden"
    assert "non-reclaiming" in eps["memory"]
    managed = modes["graal-native-managed-aot"]
    assert managed["native_machine_aot"] is True and managed["runtime_jit"] is False
    assert managed["tracing_gc"] == "allowed"
    assert modes["java-jvm-low-gc"]["native_machine_aot"] is False
    assert modes["java-jvm-low-gc"]["tracing_gc"] == "allowed"
    assert "not memory reclamation" in c["guarantees"]["no_gc"]
    assert "not a hardware-enforced" in c["guarantees"]["tenant_isolation"]
    assert c["measurement"]["min_actor_operations"] >= 100000
    assert c["measurement"]["min_tenant_restarts"] >= 100
    assert c["measurement"]["heap_samples_min"] >= 10
    fields = c["measurement"]["required_fields"]
    assert len(fields) == len(set(fields))
    for name in (
        "source_head_sha", "artifact_sha256", "guest_fixture_sha256",
        "guest_executed", "runtime_jit_used", "allocation_bytes",
        "gc_collections_before", "gc_collections_after",
        "managed_heap_start_bytes", "managed_heap_end_bytes",
        "peak_rss_bytes", "arena_bytes_before", "arena_bytes_after",
        "actor_operations", "tenant_restarts", "heap_samples",
        "runner_url", "evidence_kind",
    ):
        assert name in fields, name
    assert set(c["backend_status"]) == {"java", "llvm", "wasm", "forge", "net"}
    assert all(status == "NOT_EXECUTED" for status in c["backend_status"].values())
    return True


class ContractTests(unittest.TestCase):
    def test_canonical_contract(self):
        self.assertTrue(validate(CONTRACT))

    def rejects(self, mutation):
        c = copy.deepcopy(CONTRACT)
        mutation(c)
        with self.assertRaises((AssertionError, KeyError, TypeError)):
            validate(c)

    def test_epsilon_cannot_become_default_java_gc(self):
        self.rejects(lambda c: c["profiles"]["graal-native-managed-aot"].update(tracing_gc="forbidden"))

    def test_epsilon_cannot_be_renamed_serial(self):
        self.rejects(lambda c: c["profiles"]["graal-native-epsilon-aot"].update(selected_gc="serial"))

    def test_epsilon_cannot_reenable_jit(self):
        self.rejects(lambda c: c["profiles"]["graal-native-epsilon-aot"].update(runtime_jit=True))

    def test_zero_collection_cannot_claim_reclamation(self):
        self.rejects(lambda c: c["profiles"]["graal-native-epsilon-aot"].update(memory="managed heap reclaimed"))

    def test_llvm_requires_real_full_aot(self):
        self.rejects(lambda c: c["profiles"]["llvm-native-aot"].update(native_machine_aot=False))

    def test_jvm_bytecode_is_not_mislabeled_native_aot(self):
        self.rejects(lambda c: c["profiles"]["java-jvm-low-gc"].update(native_machine_aot=True))

    def test_measurements_cannot_be_downgraded(self):
        self.rejects(lambda c: c["measurement"].update(min_actor_operations=1))

    def test_no_evidence_field_can_be_silently_dropped(self):
        self.rejects(lambda c: c["measurement"]["required_fields"].remove("peak_rss_bytes"))

    def test_backend_status_never_pretends_executed(self):
        self.rejects(lambda c: c["backend_status"].update(llvm="PASSED"))


if __name__ == "__main__":
    unittest.main()
