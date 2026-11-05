"""Source-only adversarial regressions for the AttoLang library identity ledger."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from verify_atto_library_sources import PINNED_GIT_BLOBS, git_blob_sha, verify


class CanonicalLibraryIdentityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        dest = self.root / "library/atto-library-source-v1.json"
        dest.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "library/atto-library-source-v1.json", dest)
        self.manifest = json.loads(dest.read_text(encoding="utf-8"))
        self.pins = {row["path"]: row["git_blob_sha"] for row in self.manifest["modules"]}
        for row in self.manifest["modules"]:
            target = self.root / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / row["path"], target)
        shutil.copy2(ROOT / "library/ores.core/numeric.ores",
                     self.root / "library/ores.core/numeric.ores")

    def check(self):
        return verify(self.root, pins=self.pins)

    def overwrite_manifest(self):
        (self.root / "library/atto-library-source-v1.json").write_text(json.dumps(self.manifest))

    def test_pinned_source_passes(self):
        self.assertEqual([], self.check())

    def test_repository_v1_pins_match_independent_anchor(self):
        self.assertEqual(PINNED_GIT_BLOBS, self.pins)
        self.assertEqual([], verify(ROOT))

    def test_exact_blob_mutation_fails(self):
        source = self.root / self.manifest["modules"][0]["path"]
        contents = source.read_bytes()
        source.write_bytes(bytes([contents[0] ^ 1]) + contents[1:])
        self.assertTrue(any("blob mismatch" in issue for issue in self.check()))

    def test_manifest_self_repin_is_rejected(self):
        row = self.manifest["modules"][1]
        source = self.root / row["path"]
        source.write_bytes(source.read_bytes() + b"\n")
        row["git_blob_sha"] = git_blob_sha(source.read_bytes())
        self.overwrite_manifest()
        self.assertTrue(any("independently pinned" in issue for issue in self.check()))

    def test_unmanifested_atto_rejected(self):
        (self.root / "library/ores.std/shadow.atto").write_text("define module shadow as end\n")
        self.assertTrue(any("unmanifested" in issue for issue in self.check()))

    def test_legacy_numeric_drift_rejected(self):
        (self.root / "library/ores.core/numeric.ores").write_text("different\n")
        self.assertTrue(any("differs" in issue for issue in self.check()))

    def test_missing_legacy_numeric_rejected(self):
        (self.root / "library/ores.core/numeric.ores").unlink()
        self.assertTrue(any("legacy numeric source missing" in issue for issue in self.check()))

    def test_java_guest_source_rejected(self):
        (self.root / "library/ores.std/Unexpected.java").write_text("class Unexpected {}\n")
        self.assertTrue(any("Java source" in issue for issue in self.check()))

    def test_duplicate_manifest_rejected(self):
        self.manifest["modules"].append(self.manifest["modules"][0])
        self.overwrite_manifest()
        self.assertTrue(any("module count" in issue for issue in self.check()))

    def test_missing_source_rejected(self):
        (self.root / self.manifest["modules"][0]["path"]).unlink()
        self.assertTrue(any("source missing" in issue for issue in self.check()))

    def test_invalid_utf8_rejected(self):
        source = self.root / self.manifest["modules"][1]["path"]
        source.write_bytes(b"\xff")
        self.assertTrue(any("invalid UTF-8" in issue for issue in self.check()))

    def test_over_quota_rejected(self):
        source = self.root / self.manifest["modules"][1]["path"]
        source.write_bytes(b"a" * (1024 * 1024 + 1))
        self.assertTrue(any("quota exceeded" in issue for issue in self.check()))

    def test_unapproved_legacy_copy_rejected(self):
        (self.root / "library/ores.std/core.ores").write_text("unsupported\n")
        self.assertTrue(any("unapproved legacy" in issue for issue in self.check()))

    def test_symlink_atto_rejected(self):
        source = self.root / self.manifest["modules"][1]["path"]
        backup = self.root / "outside.txt"
        backup.write_bytes(source.read_bytes())
        source.unlink()
        source.symlink_to(backup)
        self.assertTrue(any("symlink" in issue for issue in self.check()))

    def test_manifest_nonobject_rejected(self):
        (self.root / "library/atto-library-source-v1.json").write_text("[]")
        self.assertTrue(any("must be object" in issue for issue in self.check()))

    def test_incorrect_source_suffix_rejected(self):
        self.manifest["modules"][1]["path"] = "library/ores.std/core.java"
        self.overwrite_manifest()
        self.assertTrue(any("unexpected canonical path" in issue for issue in self.check()))


    def test_hardlinked_guest_source_rejected(self):
        source = self.root / self.manifest["modules"][1]["path"]
        alias = self.root / "outside.atto"
        alias.hardlink_to(source)
        self.assertTrue(any("uniquely linked" in issue for issue in self.check()))

    def test_hardlinked_manifest_rejected(self):
        source = self.root / "library/atto-library-source-v1.json"
        alias = self.root / "manifest-second-link.json"
        alias.hardlink_to(source)
        self.assertTrue(any("manifest must be" in issue for issue in self.check()))

    def test_hardlinked_numeric_legacy_alias_rejected(self):
        legacy = self.root / "library/ores.core/numeric.ores"
        old = legacy.read_bytes()
        legacy.unlink()
        legacy.hardlink_to(self.root / "library/ores.core/numeric.atto")
        self.assertEqual(old, legacy.read_bytes())
        self.assertTrue(any("hardlink" in issue for issue in self.check()))


if __name__ == "__main__":
    unittest.main()
