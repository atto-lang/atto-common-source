#!/usr/bin/env python3
"""Source-only integrity check for the proposed AttoLang tilde-literal contract.

This script does NOT compile, type-check, execute, or certify AttoLang guests.
Run: python3 tools/check-tilde-aggregate-match-v1.py
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / "fixtures/tilde-aggregate-match-v1/manifest.json"
BACKENDS = {"java", "llvm", "wasm", "forge", "net"}
ALLOWED = {"accept", "reject"}


def main() -> int:
    errors = []
    data = json.loads(FILE.read_text(encoding="utf-8"))
    if data.get("schema") != "attolang.tilde-aggregate-and-structural-match.v1":
        errors.append("wrong schema")
    if data.get("status") != "SOURCE_CONTRACT_ONLY":
        errors.append("manifest claims unsupported execution")
    if data.get("certification") != "NOT_CERTIFIED":
        errors.append("manifest claims certification")
    if set(data.get("backends", [])) != BACKENDS:
        errors.append("backend set differs from the five-backend contract")
    evidence = data.get("evidence", {})
    if set(evidence) != BACKENDS or any(status != "NOT_EXECUTED" for status in evidence.values()):
        errors.append("fixture manifest must not claim guest evidence")
    spec = data.get("spec", "")
    if not spec or not (ROOT / spec).is_file():
        errors.append("missing or unresolved spec")
    cases = data.get("cases", [])
    if not isinstance(cases, list) or not cases:
        errors.append("empty case corpus")
        cases = []
    ids = []
    counts = {"accept": 0, "reject": 0}
    for i, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"case {i} not object")
            continue
        ident = case.get("id")
        if not isinstance(ident, str) or not ident or ident in ids:
            errors.append(f"missing or duplicated case id at {i}")
        ids.append(ident)
        expected = case.get("expected")
        if expected not in ALLOWED:
            errors.append(f"{ident}: invalid expected")
            continue
        counts[expected] += 1
        if not isinstance(case.get("source"), str) or not case["source"].strip():
            errors.append(f"{ident}: missing source")
        if not isinstance(case.get("reason"), str) or not case["reason"].strip():
            errors.append(f"{ident}: missing semantic rationale")
        if expected == "accept":
            if case.get("target_exit_code") != 42 or "no_guest_artifact_on_reject" in case:
                errors.append(f"{ident}: incorrect positive evidence expectation")
        elif case.get("no_guest_artifact_on_reject") is not True or "target_exit_code" in case:
            errors.append(f"{ident}: negative must require no guest artifact")
    if (counts["accept"] < 15 or counts["reject"] < 20 or
            data.get("counts") != {**counts, "total": len(cases)}):
        errors.append("case counts mismatch or insufficient matrix coverage")
    if errors:
        for error in errors:
            print("INVALID:", error, file=sys.stderr)
        return 1
    print(f"SOURCE_CONTRACT_ONLY: {len(cases)} cases; "
          f"{counts['accept']} accept targets, {counts['reject']} reject targets; "
          "guest execution NOT_EXECUTED; NOT_CERTIFIED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
