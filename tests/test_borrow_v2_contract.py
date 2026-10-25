"""Offline borrow v2 verifier tests. Passing says nothing about guest execution."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_borrow_v2_contract import ContractError, check


class BorrowV2ContractTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory(prefix="borrow-v2-contract-")
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        target = self.root / "fixtures/borrow-ownership-v2"
        target.mkdir(parents=True)
        for file in (ROOT / "fixtures/borrow-ownership-v2").iterdir():
            shutil.copyfile(file, target / file.name)

    def manifest(self):
        return self.root / "fixtures/borrow-ownership-v2/manifest.json"

    def edit_manifest(self, mutator):
        path = self.manifest()
        data = json.loads(path.read_text(encoding="utf-8"))
        mutator(data)
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_frozen_contract_is_valid_but_not_executed(self):
        self.assertEqual(check(self.root), 3)

    def test_tampered_source_denied(self):
        path = self.root / "fixtures/borrow-ownership-v2/borrow-mut-scalar.ores"
        path.write_text(path.read_text().replace("42;", "43;"))
        with self.assertRaisesRegex(ContractError, "source bytes"):
            check(self.root)

    def test_premature_backend_claim_denied(self):
        self.edit_manifest(lambda data: data["cases"][0]["readiness"].update(
            {"graal-native-guest-aot": "required"}))
        with self.assertRaisesRegex(ContractError, "readiness"):
            check(self.root)

    def test_failure_path_must_emit_zero_ir(self):
        self.edit_manifest(lambda data: data["cases"][1]["expectation"].update(
            {"emitted_ir_bytes": 18}))
        with self.assertRaisesRegex(ContractError, "rejection oracle"):
            check(self.root)

    def test_duplicate_or_missing_cases_denied(self):
        self.edit_manifest(lambda data: data["cases"].pop())
        with self.assertRaisesRegex(ContractError, "missing or extra"):
            check(self.root)

    def test_malformed_json_keys_denied(self):
        self.manifest().write_text('{"schema_version":2,"schema_version":3}')
        with self.assertRaisesRegex(ContractError, "duplicate JSON"):
            check(self.root)


if __name__ == "__main__":
    unittest.main()
