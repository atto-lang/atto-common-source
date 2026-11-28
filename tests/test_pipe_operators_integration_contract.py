"""Static integrity only: this suite must never certify source execution."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "v1" / "pipe-operators"

class PipeOperatorIntegrationContractTest(unittest.TestCase):
    def test_registry_is_pending_until_same_source_executes(self):
        manifest = json.loads((ROOT / "cases.json").read_text())
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["status"], "pending-executable-source-conformance")
        self.assertEqual(manifest["targets"],
                         [".java", ".llvm", ".net", ".forge", ".wasm"])
        cases = manifest["cases"]
        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertEqual(case["expected"], "accept-execute")
        self.assertEqual(case["oracle"], {"stdout": "-5"})
        self.assertEqual(case["candidate_implementations"], [])
        self.assertEqual(case["pending"], manifest["targets"])
        self.assertTrue(case["require_exact_source"])
        self.assertTrue(case["require_authenticated_routing"])
        self.assertTrue(case["require_guest_execution"])
        path = ROOT / "fixtures" / case["fixture"]
        self.assertTrue(path.is_file())
        program = path.read_text()
        self.assertIn("spawn Source() pipe spawn Transform() pipe spawn Sink()", program)
        self.assertIn("fn1() |> fn2() |> fn3()", program)
        self.assertIn("await stream.get_done()", program)
        self.assertEqual(program.count("define actor "), 3)

if __name__ == "__main__":
    unittest.main()
