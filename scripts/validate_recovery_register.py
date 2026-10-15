#!/usr/bin/env python3
"""Offline integrity gate for the 50-item Oreslang recovery register.

Checks inventory structure and identifiers, NOT GitHub state or test execution.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

DOCUMENT = Path(__file__).resolve().parents[1] / "docs/UNFINISHED_WORK_RECOVERY_2026-10-15.md"
SECTIONS = (
    "Security / provenance",
    "CI / executable evidence",
    "Actors / runtime concurrency",
    "Language / types / native",
    "CLI / contracts / orphan work",
)
ISSUE_ROW = re.compile(
    r"^- \[ \] \*\*(?P<title>.+?)\*\* — "
    r"\[[^\]\n]+\]\(https://github\.com/ores-truffle-oreslang/"
    r"(?P<repo>[a-zA-Z0-9._-]+)/issues/(?P<number>[1-9]\d*)\)"
    r"\. Next: (?P<next>.+)$"
)


def verify_register(document: str) -> list[str]:
    """Return a list of problems; never claim the remote issues are still open."""
    problems: list[str] = []
    if "October 6–15, 2026" not in document.splitlines()[0]:
        problems.append("register heading must describe the October 6–15 window")
    if document.count("\n## ") < len(SECTIONS):
        problems.append("missing recovery sections")
    identifiers: set[str] = set()
    all_rows = 0
    previous = -1

    for heading in SECTIONS:
        marker = f"\n## {heading}\n"
        if document.count(marker) != 1:
            problems.append(f"missing or repeated section: {heading}")
            continue
        start = document.index(marker)
        if start <= previous:
            problems.append(f"incorrect section order: {heading}")
        previous = start
        remaining = document[start + len(marker):]
        body = remaining.split("\n## ", 1)[0]
        rows = [line for line in body.splitlines()
                if line.startswith("- [ ]") or line.startswith("- [x]")
                or line.startswith("- [X]")]
        if len(rows) != 10:
            problems.append(f"{heading}: expected 10 open issue rows, found {len(rows)}")
        all_rows += len(rows)
        for row in rows:
            match = ISSUE_ROW.fullmatch(row)
            if match is None:
                problems.append(f"{heading}: invalid/open-task row: {row[:120]}")
                continue
            if not match["title"].strip() or not match["next"].strip():
                problems.append(f"{heading}: empty title or next action")
            ref = match["repo"] + "#" + match["number"]
            if ref in identifiers:
                problems.append(f"duplicate issue reference: {ref}")
            identifiers.add(ref)
    if all_rows != 50:
        problems.append(f"expected exactly 50 checklist rows, found {all_rows}")
    if len(identifiers) != 50:
        problems.append(f"expected 50 unique GitHub issue references, found {len(identifiers)}")
    return problems


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) == 2 else DOCUMENT
    if len(sys.argv) > 2:
        print("usage: validate_recovery_register.py [register.md]", file=sys.stderr)
        return 2
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        print(f"cannot read register: {exc}", file=sys.stderr)
        return 2
    failures = verify_register(content)
    for problem in failures:
        print(problem, file=sys.stderr)
    if failures:
        return 1
    print("50 unique open-task references; five sections x 10; integrity OK")
    print("(live GitHub issue state and executable test evidence NOT checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
