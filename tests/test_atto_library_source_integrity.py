"""Source-only adversarial regressions for the Atto library identity ledger."""
from __future__ import annotations
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_atto_library_sources import verify

class CanonicalLibraryIdentityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        path = self.root / "library/atto-library-source-v1.json"
        path.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "library/atto-library-source-v1.json", path)
        self.manifest = json.loads(path.read_text(encoding="utf-8"))
        for row in self.manifest["modules"]:
            target = self.root / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / row["path"], target)
        shutil.copy2(ROOT / "library/ores.core/numeric.ores",
                     self.root / "library/ores.core/numeric.ores")

    def test_pinned_source_passes(self):
        self.assertEqual([], verify(self.root))

    def test_exact_blob_mutation_fails(self):
        path = self.root / self.manifest["modules"][0]["path"]
        original = path.read_bytes()
        path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
        self.assertTrue(any("blob mismatch" in x for x in verify(self.root)))

    def test_added_guest_file_fails(self):
        (self.root / "library/ores.std/shadow.atto").write_text("module shadow\n")
        self.assertTrue(any("unmanifested" in x for x in verify(self.root)))

    def test_legacy_numeric_drift_fails(self):
        (self.root / "library/ores.core/numeric.ores").write_text("different\n")
        self.assertTrue(any("differs" in x for x in verify(self.root)))

    def test_java_guest_file_fails(self):
        (self.root / "library/ores.std/Unexpected.java").write_text("class Unexpected {}\n")
        self.assertTrue(any("Java source" in x for x in verify(self.root)))

    def test_duplicate_manifest_entry_fails(self):
        self.manifest["modules"].append(self.manifest["modules"][0])
        (self.root / "library/atto-library-source-v1.json").write_text(json.dumps(self.manifest))
        self.assertTrue(any("duplicate" in x for x in verify(self.root)))

    def test_missing_source_fails(self):
        (self.root / self.manifest["modules"][0]["path"]).unlink()
        self.assertTrue(any("missing" in x for x in verify(self.root)))

if __name__ == "__main__":
    unittest.main()
