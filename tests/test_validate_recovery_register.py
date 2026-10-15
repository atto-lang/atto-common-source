#!/usr/bin/env python3
"""Adversarial, network-free tests of the fifty-task recovery inventory gate."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts/validate_recovery_register.py"
SPEC = importlib.util.spec_from_file_location("recovery_check", PATH)
assert SPEC and SPEC.loader
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def fixture() -> str:
    lines = ["# Recovery audit: 50 unfinished Oreslang tasks (October 6–15, 2026)", ""]
    for section_idx, heading in enumerate(CHECK.SECTIONS):
        lines.extend([f"## {heading}", ""])
        for idx in range(10):
            n = 1000 + section_idx * 10 + idx
            lines.append(
                f"- [ ] **Work item {n}** — "
                f"[repo#{n}](https://github.com/ores-truffle-oreslang/repo/issues/{n}). "
                "Next: Require an exact-head executable proof."
            )
        lines.append("")
    return "\n".join(lines)


class RecoveryRegisterTest(unittest.TestCase):
    def test_valid_fifty_item_inventory(self):
        self.assertEqual([], CHECK.verify_register(fixture()))

    def test_duplicate_issue_is_rejected(self):
        text = fixture().replace("repo/issues/1011", "repo/issues/1010")
        self.assertIn("duplicate issue", " ".join(CHECK.verify_register(text)))

    def test_missing_item_is_rejected(self):
        text = fixture().replace(
            next(line for line in fixture().splitlines() if "repo/issues/1034" in line),
            "")
        self.assertTrue(CHECK.verify_register(text))

    def test_pr_does_not_count_as_existing_issue(self):
        text = fixture().replace("repo/issues/1000", "repo/pull/1000")
        self.assertTrue(CHECK.verify_register(text))

    def test_checked_off_without_evidence_is_rejected(self):
        text = fixture().replace("- [ ] **Work item 1000**", "- [x] **Work item 1000**")
        self.assertTrue(CHECK.verify_register(text))

    def test_missing_action_is_rejected(self):
        text = fixture().replace(
            "repo/issues/1000). Next: Require an exact-head executable proof.",
            "repo/issues/1000). Next: ")
        self.assertTrue(CHECK.verify_register(text))

    def test_missing_or_reordered_section_is_rejected(self):
        text = fixture().replace("## CI / executable evidence", "## Different heading")
        self.assertTrue(CHECK.verify_register(text))

    def test_wrong_window_is_rejected(self):
        self.assertTrue(CHECK.verify_register(
            fixture().replace("October 6–15", "October 5–15")))


if __name__ == "__main__":
    unittest.main()
