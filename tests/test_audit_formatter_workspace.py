"""Offline tests: no Rust toolchain or source repositories are needed."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_formatter_workspace.py"
spec = importlib.util.spec_from_file_location("formatter_audit", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorkspaceAuditTests(unittest.TestCase):
    def make_workspace(self, base: Path, code: str):
        roots = {}
        for repo in module.REPOSITORIES:
            root = base / repo
            root.mkdir()
            (root / "test.ores").write_bytes(b"original\n")
            roots[repo] = root
        binary = base / "formatter"
        binary.write_text("#!/usr/bin/python3\n" + code)
        binary.chmod(0o755)
        return roots, binary

    def test_runs_only_against_temporary_copies_and_reports_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots, binary = self.make_workspace(Path(tmp),
                "import pathlib,sys\n"
                "path=pathlib.Path(sys.argv[-1])\n"
                "data=path.read_bytes()\n"
                "sys.stdout.buffer.write(data.replace(b'original',b'formatted'))\n")
            report = module.audit(roots, binary)
            self.assertEqual(report["total"], 7)
            self.assertEqual(report["counts"]["formatted"], 7)
            self.assertEqual(report["would_change"], 7)
            for root in roots.values():
                self.assertEqual((root / "test.ores").read_bytes(), b"original\n")

    def test_detects_non_idempotent_formatter(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots, binary = self.make_workspace(Path(tmp),
                "import pathlib,sys\n"
                "sys.stdout.buffer.write(pathlib.Path(sys.argv[-1]).read_bytes()+b'!')\n")
            report = module.audit(roots, binary)
            self.assertEqual(report["counts"]["unstable"], 7)

    def test_detects_formatter_mutating_temporary_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots, binary = self.make_workspace(Path(tmp),
                "import pathlib,sys\n"
                "path=pathlib.Path(sys.argv[-1])\n"
                "path.write_bytes(b'corrupt')\n"
                "sys.stdout.buffer.write(b'corrupt')\n")
            report = module.audit(roots, binary)
            self.assertEqual(report["counts"]["unsafe_temp_write"], 7)
            for root in roots.values():
                self.assertEqual((root / "test.ores").read_bytes(), b"original\n")

    def test_rejects_missing_roots_and_ignores_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots, binary = self.make_workspace(Path(tmp),
                "import pathlib,sys\n"
                "sys.stdout.buffer.write(pathlib.Path(sys.argv[-1]).read_bytes())\n")
            source = roots[module.REPOSITORIES[0]] / "test.ores"
            source.with_name("alias.ores").symlink_to(source)
            self.assertEqual(len(module.discover(source.parent)), 1)
            del roots[module.REPOSITORIES[-1]]
            with self.assertRaisesRegex(ValueError, "missing repository root"):
                module.audit(roots, binary)


if __name__ == "__main__":
    unittest.main()
