#!/usr/bin/env python3
"""Fail-closed, source-only integrity check for AttoLang tilde proposal fixtures.

This is NOT a parser, type checker, compiled AttoLang guest, or runner certification.
Usage: python3 tools/check-tilde-aggregate-match-v1.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / "fixtures/tilde-aggregate-match-v1/manifest.json"
SPEC = "contracts/v1/ATTO_TILDE_AGGREGATE_LITERALS_AND_STRUCTURAL_MATCH_V1.md"
BACKENDS = ("java", "llvm", "wasm", "forge", "net")
EXPECTED_CASES = {"accept": 22, "reject": 25}
CASE_FIELDS = {"id", "kind", "expected", "source", "reason",
               "target_exit_code", "no_guest_artifact_on_reject"}
CASE_KINDS = {"record", "map", "match", "syntax", "type", "compat", "ownership", "proof"}


def validate(data: Any, *, check_spec: bool = True) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["top-level manifest must be a JSON object"]
    if data.get("schema") != "attolang.tilde-aggregate-and-structural-match.v1":
        errors.append("incorrect versioned schema")
    if data.get("status") != "SOURCE_CONTRACT_ONLY":
        errors.append("source-only status changed")
    if data.get("certification") != "NOT_CERTIFIED":
        errors.append("certification must be NOT_CERTIFIED")
    if data.get("feature") != "tilde-literals-match-over-on-structural":
        errors.append("feature identity changed")
    if data.get("source_extension") != ".atto":
        errors.append("source extension changed")
    if data.get("spec") != SPEC or (check_spec and not (ROOT / SPEC).is_file()):
        errors.append("normative spec path invalid or missing")
    backends = data.get("backends")
    if backends != list(BACKENDS):
        errors.append("five-backend list must be exact and ordered")
    if data.get("evidence") != dict.fromkeys(BACKENDS, "NOT_EXECUTED"):
        errors.append("all five evidence statuses must be NOT_EXECUTED")
    cases = data.get("cases")
    if not isinstance(cases, list):
        return errors + ["cases must be an array"]
    seen: set[str] = set()
    counts = {"accept": 0, "reject": 0}
    for i, case in enumerate(cases):
        label = f"case[{i}]"
        if not isinstance(case, dict):
            errors.append(f"{label}: case must be object")
            continue
        identifier = case.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[pn][0-9]{2}_[a-z0-9_]+", identifier):
            errors.append(f"{label}: invalid or absent case id")
        elif identifier in seen:
            errors.append(f"{label}: duplicate id {identifier}")
        else:
            seen.add(identifier)
        if set(case) - CASE_FIELDS:
            errors.append(f"{label}: unsupported case metadata fields")
        if case.get("kind") not in CASE_KINDS:
            errors.append(f"{label}: unknown case kind")
        expected = case.get("expected")
        if expected not in counts:
            errors.append(f"{label}: invalid expected result")
        else:
            counts[expected] += 1
            if isinstance(identifier, str) and identifier[:1] != ("p" if expected == "accept" else "n"):
                errors.append(f"{label}: id prefix contradicts result")
        source = case.get("source")
        if not isinstance(source, str) or not source.strip():
            errors.append(f"{label}: source must be nonempty UTF-8 string")
        elif (len(source.encode("utf-8", "surrogatepass")) > 65536 or
              "\x00" in source or "\r" in source or
              any(0xD800 <= ord(ch) <= 0xDFFF for ch in source)):
            errors.append(f"{label}: source encoding or length invalid")
        reason = case.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"{label}: missing expected-semantics rationale")
        if expected == "accept":
            if case.get("target_exit_code") != 42 or isinstance(case.get("target_exit_code"), bool):
                errors.append(f"{label}: positive exit target must be exactly 42")
            if "no_guest_artifact_on_reject" in case:
                errors.append(f"{label}: positive carries negative-only metadata")
        elif expected == "reject":
            if case.get("no_guest_artifact_on_reject") is not True:
                errors.append(f"{label}: negative must forbid artifact emission")
            if "target_exit_code" in case:
                errors.append(f"{label}: negative carries positive-only metadata")
    if counts != EXPECTED_CASES or len(cases) != sum(EXPECTED_CASES.values()):
        errors.append("fixed expected 22 accept and 25 reject cases changed")
    if data.get("counts") != {**EXPECTED_CASES, "total": sum(EXPECTED_CASES.values())}:
        errors.append("declared counts changed")
    return errors


def main() -> int:
    try:
        raw = FILE.read_bytes()
        if len(raw) > 1024 * 1024:
            raise ValueError("manifest exceeds 1 MiB")
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_json_keys)
        errors = validate(data)
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        print(f"INVALID: unreadable or malformed JSON manifest: {error}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print("INVALID:", error, file=sys.stderr)
        return 1
    print("SOURCE_CONTRACT_ONLY: 47 targets (22 accept, 25 reject). "
          "Guest execution NOT_EXECUTED; NOT_CERTIFIED.")
    return 0


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    obj: dict[str, Any] = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError(f"duplicate JSON object member {key!r}")
        obj[key] = value
    return obj


if __name__ == "__main__":
    sys.exit(main())
