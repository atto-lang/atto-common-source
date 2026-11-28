"""Static admission for candidate credit stream v1 contract; not backend proof."""
import json
from pathlib import Path
import unittest


MANIFEST = (Path(__file__).resolve().parents[1] /
            "contracts/v1/reactive-credit-stream.v1.json")


class CreditStreamContractInventory(unittest.TestCase):
    def test_no_unverified_backend_can_be_marked_implemented(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["status"], "draft_no_compiler_or_native_evidence")
        self.assertEqual(set(manifest["backends"]),
                         {"java", "llvm", "net", "wasm", "forge"})
        self.assertEqual(manifest["evidence"]["jvm"], "none")
        self.assertEqual(manifest["evidence"]["native"], "none")
        for backend, status in manifest["backends"].items():
            with self.subTest(backend=backend):
                self.assertTrue(status.startswith("pending") or
                                "must fail closed" in status,
                                f"backend {backend} improperly marked supported: {status}")

    def test_typed_four_state_protocol_and_unique_vectors(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
        self.assertEqual(manifest["consumer_type"], "Option<Result<Option<T>,E>>")
        events = manifest["protocol"]
        self.assertEqual([x["id"] for x in events],
                         ["next", "complete", "error", "cancelled"])
        self.assertEqual([x["terminal"] for x in events],
                         [False, True, True, True])
        self.assertEqual([x["frame"] for x in events],
                         ["Some(Ok(Some(value)))", "Some(Ok(None))",
                          "Some(Err(error))", "None"])
        cases = manifest["cases"]
        ids = [x["id"] for x in cases]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(cases), 20)
        for case in cases:
            with self.subTest(case=case["id"]):
                self.assertTrue(case["steps"])
                self.assertTrue(case["expect"])

    def test_actor_stream_and_raw_channel_are_not_conflated(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
        self.assertIn("routing", manifest["families"]["actor_stream"])
        self.assertIn("domain-local", manifest["families"]["channel"])
        self.assertIn("per next", manifest["families"]["async_iterator"])
        self.assertTrue(any("compile rejection" in case["expect"]
                            for case in manifest["cases"]))


if __name__ == "__main__":
    unittest.main()
