"""Static source audit only; not a substitute for guest compiler execution."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "modern-networking-v1.json"
SOURCE = ROOT / "stdlib" / "net" / "http_policy.atto"


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


class ModernNetworkingContractTest(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.data = SOURCE.read_bytes()

    def test_native_atto_pinned_source(self):
        source = self.contract["canonical_source"]
        self.assertEqual(source["path"], "stdlib/net/http_policy.atto")
        self.assertEqual(source["source_extension"], ".atto")
        self.assertEqual(source["scope"], "PURE_POLICY_ONLY")
        self.assertEqual(git_blob_sha(self.data), source["git_blob_sha"])
        self.assertTrue(self.data.endswith(b"\n"))
        self.assertNotIn(b"\r", self.data)
        self.assertNotIn(b"\xef\xbb\xbf", self.data[:3])
        self.assertNotIn(b"\0", self.data)

    def test_backends_not_claimed_executed(self):
        self.assertEqual(
            {e["backend"] for e in self.contract["backends"]},
            {"llvm", "java", "net", "rs", "wasm"},
        )
        for target in self.contract["backends"]:
            if target["backend"] == "rs":
                self.assertEqual(target["compile_execution"], "ATTO_GUEST_WASM_EXECUTED")
                evidence = target["execution_evidence"]
                self.assertEqual(evidence["compiler_source_commit"],
                                 "860137bcdc50684ab6cb6aa8f89932506b3beec4")
                self.assertEqual(evidence["compiler_source_slice_tree_sha"],
                                 "3a6eadd731418b979a5154b6d8b00739d23d883e")
                self.assertEqual(evidence["exhaustive_guest_source_blob_sha"],
                                 "113b450f4f6197223fd3bb948fb984c6d999dfbd")
                self.assertEqual(evidence["exhaustive_cases"], 48)
                self.assertEqual(evidence["expected_exit_code"], 42)
                self.assertEqual(evidence["scope"], "PURE_POLICY_GUEST_ONLY_NOT_HTTP3_NETWORK")
                self.assertIn("/actions/runs/43644258623", evidence["workflow_url"])
            else:
                self.assertEqual(target["compile_execution"], "NOT_EXECUTED")
                self.assertNotIn("execution_evidence", target)
            self.assertEqual(target["http3_network_execution"], "NOT_EXECUTED")
            self.assertFalse(target["native_aot_proven"])
            self.assertFalse(target["zero_gc_proven"])

    def test_no_host_language_stdlib_sources(self):
        for path in (ROOT / "stdlib").rglob("*"):
            if path.is_file():
                self.assertEqual(path.suffix, ".atto", str(path))

    def test_required_policy_functions_present(self):
        source = self.data.decode("utf-8")
        for function in (
            "http3_attempt_allowed",
            "http_version_preference",
            "quic_datagram_may_send",
            "http3_zero_rtt_candidate",
        ):
            self.assertIn("pub fnc " + function + "(", source)

    def test_source_mutation_changes_git_blob_identity(self):
        mutated = self.data.replace(b"return 30;", b"return 31;")
        self.assertNotEqual(mutated, self.data)
        self.assertNotEqual(git_blob_sha(mutated), self.contract["canonical_source"]["git_blob_sha"])


if __name__ == "__main__":
    unittest.main()
