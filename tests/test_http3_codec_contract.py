"""Static native-Atto codec integrity audit, not a QUIC transport test."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/http3-codec-v1.json"
HOST_ABI = ROOT / "contracts/http3-host-abi-v1.json"


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


class Http3CodecContractTest(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.abi = json.loads(HOST_ABI.read_text(encoding="utf-8"))

    def test_module_blobs_are_exact_and_native_atto_only(self):
        self.assertEqual(len(self.contract["canonical_modules"]), 3)
        for module in self.contract["canonical_modules"]:
            path = module["path"]
            self.assertTrue(path.startswith("stdlib/net/") and path.endswith(".atto"))
            raw = (ROOT / path).read_bytes()
            self.assertEqual(git_blob_sha(raw), module["git_blob_sha"])
            self.assertNotIn(b"\0", raw)
            self.assertNotIn(b"\r", raw)
            self.assertTrue(raw.endswith(b"\n"))
        for file in (ROOT / "stdlib").rglob("*"):
            if file.is_file():
                self.assertEqual(file.suffix, ".atto", str(file))

    def test_executed_rust_guest_proof_is_explicitly_bounded(self):
        run = self.contract["run"]
        self.assertIn("/actions/runs/43645771501", run["url"])
        self.assertEqual(run["carrier_head_sha"], "20fa8c4e421d5a438c1db337868bd66bbeb7a184")
        self.assertEqual(run["pinned_compiler_source_commit"], "860137bcdc50684ab6cb6aa8f89932506b3beec4")
        self.assertEqual(run["compiler_source_slice_tree_sha"], "3a6eadd731418b979a5154b6d8b00739d23d883e")
        self.assertEqual(run["quic_varint"]["cases"], 308)
        self.assertEqual(run["http3_frames"]["cases"], 406)
        self.assertEqual(run["quic_varint"]["guest_exit_code"], 42)
        self.assertEqual(run["http3_frames"]["guest_exit_code"], 42)
        self.assertTrue(run["actual_guest_compiled"])
        self.assertTrue(run["actual_guest_executed"])
        self.assertEqual(run["host_import_count"], 0)
        self.assertFalse(run["includes_real_network_io"])
        self.assertFalse(run["native_machine_aot"])
        self.assertFalse(run["five_backend_parity"])

    def test_hardened_1255_cases_have_separate_exact_guest_evidence(self):
        r = self.contract["hardening_run"]
        self.assertEqual(r["status"], "PASS_RUST_FRONTEND_WASM_GUEST_ONLY")
        self.assertIn("/actions/runs/43647064377", r["url"])
        self.assertEqual(r["carrier_head"], "943f4186932bc9a49a1067e0f5535273cd0d2665")
        self.assertEqual(r["compiler_slice_tree"],
                         "3a6eadd731418b979a5154b6d8b00739d23d883e")
        self.assertEqual([x["cases"] for x in r["fixtures"]], [308, 435, 256, 256])
        self.assertEqual(sum(x["cases"] for x in r["fixtures"]), 1255)
        self.assertEqual(r["new_hardening_cases"], 541)
        self.assertEqual(r["fixtures"][1]["fixture_blob"],
                         "70f70bdfa037468e78496dc7637ce9851e1a66aa")
        self.assertEqual(r["guest_unit_tests_passed"], 4)
        self.assertEqual(r["host_imports"], 0)
        self.assertTrue(r["deterministic_artifacts"])
        self.assertEqual(r["invalid_guest"], "E_UNBOUND_FAIL_CLOSED")
        self.assertTrue(all(x["exit_code"] == 42 for x in r["fixtures"]))
        self.assertFalse(r["actual_quic_http3_network_io"])
        self.assertFalse(r["native_aot_proven"])
        self.assertFalse(r["other_backend_execution_proven"])
        self.assertEqual(self.contract["run"]["evidence_scope"],
                         "HISTORICAL_GUEST_RESULT_BEFORE_62_BIT_HARDENING")

    def test_protocols_and_unimplemented_backends_fail_closed(self):
        self.assertEqual(self.contract["protocol_engine_status"], "NOT_IMPLEMENTED")
        self.assertEqual(self.abi["status"], "SPECIFICATION_ONLY_NO_TRANSPORT_ENGINE_BOUND")
        self.assertEqual(len(self.abi["operations"]), 11)
        self.assertEqual({r["backend"] for r in self.contract["backend_evidence"]},
                         {"java", "llvm", "net", "rs", "wasm"})
        for row in self.contract["backend_evidence"]:
            self.assertTrue(row["native_atto_source_present"])
            self.assertEqual(row["http3_network"], "NOT_IMPLEMENTED")
            if row["backend"] == "rs":
                self.assertEqual(row["guest_execution"], "PASS_RUST_COMPILER_TO_WASM_PURE_PROTOCOL")
            elif row["backend"] == "llvm":
                self.assertEqual(row["guest_execution"], "PASS_LLVM_ELF64_SCALAR_NATIVE_AOT")
                self.assertTrue(row["native_machine_aot_scalar"])
                self.assertTrue(row["actor_runtime_executed"])
                self.assertEqual(row["actor_runtime_scope"],
                                 "PASS_LLVM_BOUNDED_NATIVE_LEGACY_DEFINE_ACTOR")
                self.assertFalse(row["sealed_state_enforced"])
                self.assertFalse(row["new_declare_mtd_executed"])
                self.assertFalse(row["supervisor_control_executed"])
                self.assertFalse(row["quic_tls_transport_executed"])
            else:
                self.assertEqual(row["guest_execution"], "NOT_EXECUTED")
        for row in self.abi["backend_status"]:
            self.assertEqual(row["host_transport_binding"], "NOT_IMPLEMENTED")
            self.assertEqual(row["guest_http3"], "NOT_EXECUTED")

    def test_native_llvm_receipt_is_exact_and_does_not_claim_http3_networking(self):
        evidence = self.contract["llvm_aot_evidence"]
        raw = (ROOT / evidence["receipt"]).read_bytes()
        self.assertEqual(git_blob_sha(raw), evidence["receipt_blob"])
        receipt = json.loads(raw)
        self.assertEqual(receipt["status"], "PASS_X86_64_ELF_SCALAR_GUEST_ONLY")
        self.assertEqual(receipt["runner"]["run"], evidence["runner"])
        self.assertEqual(receipt["source_snapshot"]["commit"],
                         evidence["verified_source_commit"])
        self.assertEqual(receipt["source_snapshot"]["full_tree"],
                         evidence["verified_exact_full_tree"])
        self.assertEqual(sum(row["cases"] for row in receipt["fixtures"]), 1255)
        self.assertEqual(receipt["execution"]["total_cases"], 1255)
        self.assertTrue(receipt["execution"]["direct_cli_native_elf_verified"])
        self.assertTrue(receipt["execution"]["checked_i64_add_sub_mul_neg_trap_passed"])
        self.assertTrue(receipt["execution"]["asan_ubsan_smoke_passed"])
        self.assertFalse(receipt["execution"]["runtime_guest_vm"])
        self.assertFalse(receipt["execution"]["guest_gc"])
        for field in ("real_quic_udp_tls", "http3_client_server_wire",
                      "actor_runtime", "native_aot_full_language",
                      "zero_gc_full_language", "other_backend_parity"):
            self.assertFalse(receipt["unsupported"][field])
        self.assertFalse(evidence["real_http3_wire"])
        self.assertFalse(evidence["complete_language_aot"])

    def test_llvm_output_hardening_receipt_is_sha_exact(self):
        ref = self.contract["llvm_aot_output_hardening"]
        source = ROOT / ref["source"]
        raw = source.read_bytes()
        self.assertEqual(git_blob_sha(raw), ref["source_git_blob_sha"])
        proof = json.loads(raw)
        self.assertEqual(proof["schema"], "atto.llvm.native-aot-atomic-publish.v1")
        self.assertEqual(proof["runner"]["run"], ref["verified_runner"])
        self.assertEqual(proof["audited_source_commit"],
                         ref["audited_source_commit"])
        self.assertEqual(proof["audited_full_tree"],
                         ref["audited_source_tree"])
        self.assertEqual(proof["runner"]["job_conclusion"], "success")
        self.assertTrue(proof["runner"]["sha_exact_local_mirror"])
        self.assertFalse(proof["runner"]["cross_org_checkout_credentials"])
        self.assertEqual(sum(x["cases"] for x in proof["generated_artifacts"]), 1255)
        for name, expected in proof["verification"].items():
            if isinstance(expected, bool):
                self.assertEqual(expected,
                                 name not in ("guest_vm_required",
                                              "guest_gc_required_for_scalar_subset"),
                                 name)
        self.assertFalse(proof["limitations"]["real_quic_tls_network"])
        self.assertFalse(proof["limitations"]["actor_runtime_implemented"])
        self.assertFalse(ref["http3_network_executed"])
        self.assertFalse(ref["full_language_aot"])
        self.assertFalse(ref["actor_runtime_executed"])

    def test_actual_llvm_native_actor_receipts_are_exact_and_scope_bounded(self):
        e = self.contract["llvm_actor_native_evidence"]
        raw1 = (ROOT / e["baseline_receipt"]).read_bytes()
        raw2 = (ROOT / e["capacity_receipt"]).read_bytes()
        self.assertEqual(git_blob_sha(raw1), e["baseline_git_blob_sha"])
        self.assertEqual(git_blob_sha(raw2), e["capacity_git_blob_sha"])
        initial = json.loads(raw1)
        later = json.loads(raw2)
        self.assertEqual(initial["carrier"]["run"], e["original_run"])
        self.assertEqual(initial["source"]["full_git_tree"],
                         e["original_exact_tree"])
        self.assertEqual(initial["status"],
                         "PASS_LINUX_X86_64_BOUNDED_LEGACY_ACTOR_AOT")
        self.assertEqual(later["runner"]["run"], e["capacity_run"])
        self.assertEqual(later["code_source"]["full_tree"],
                         e["capacity_exact_tree"])
        self.assertEqual(later["base_actor_receipt_blob"],
                         e["baseline_git_blob_sha"])
        self.assertEqual(later["verified"]["maximum_actor_instances"],
                         e["max_actor_instances_tested"])
        self.assertEqual(later["verified"]["actor_native_guest_executions"],
                         e["actor_guest_runs"])
        self.assertEqual(later["verified"]["abi_accepted_messages_total"],
                         e["abi_mailbox_messages"])
        self.assertTrue(later["verified"]["thirty_third_spawn_rejected"])
        self.assertTrue(e["real_atto_actor_native_executed"])
        self.assertFalse(e["production_actor_runtime"])
        self.assertFalse(e["new_declare_mtd_lowered"])
        self.assertFalse(e["http3_wire_network_executed"])
        self.assertFalse(initial["unsupported"]["supervisor_priority_control"])
        self.assertFalse(later["unsupported"]["critical_read_write_sealed_state"])

    def test_codec_guards_have_required_entrypoints(self):
        src = (ROOT / "stdlib/net/quic_varint.atto").read_text()
        for name in ("quic_varint_width", "quic_varint_min_width",
                     "quic_varint_decode_1", "quic_varint_decode_2",
                     "quic_varint_decode_4", "quic_varint_decode_8",
                     "quic_varint_can_read"):
            self.assertIn("pub fnc " + name + "(", src)
        frames = (ROOT / "stdlib/net/http3_frames.atto").read_text()
        for name in ("http3_control_frame_allowed",
                     "http3_request_frame_allowed",
                     "http3_push_frame_allowed",
                     "http3_frame_payload_fits",
                     "http3_settings_id_valid",
                     "http3_valid_wire_integer",
                     "http3_message_frame_allowed"):
            self.assertIn("pub fnc " + name + "(", frames)


if __name__ == "__main__":
    unittest.main()
