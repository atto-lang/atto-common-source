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
            else:
                self.assertEqual(row["guest_execution"], "NOT_EXECUTED")
        for row in self.abi["backend_status"]:
            self.assertEqual(row["host_transport_binding"], "NOT_IMPLEMENTED")
            self.assertEqual(row["guest_http3"], "NOT_EXECUTED")

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
                     "http3_settings_id_valid"):
            self.assertIn("pub fnc " + name + "(", frames)


if __name__ == "__main__":
    unittest.main()
