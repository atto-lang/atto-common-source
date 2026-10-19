#!/usr/bin/env python3
"""Offline, fail-closed validation of the immutable borrow v2 source corpus.

This validates source bytes and obligations, NOT compiler execution or
ownership/Result/AOT conformance. Do not synthesize successful CI receipts.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
BASE = "fixtures/borrow-ownership-v2/"
ALLOWED_PROFILES = {"llvm-native-aot", "graal-jvm-guest", "graal-native-guest-aot"}
SHA = re.compile(r"[0-9a-f]{64}\Z")
CASES = {
    "borrow-mut-scalar": ("360e5cd946d1a9a55abe5db711b723b96ddb6e64fc303efe7a7ed71505ba0c2d", "return"),
    "borrow-overlap-reject": ("ddc2d0088d95390a7df4ec35a7feb3c81003c55fe335714780ef99ac7aa6e7e1", "reject"),
    "borrow-shared-write-reject": ("9e8a882482c607af20922c93eb00b1e4624b6b3da4ae6352770edd76b89f1109", "reject"),
}


class ContractError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON object field")
        result[key] = value
    return result


def check(root: Path = ROOT) -> int:
    root = root.resolve(strict=True)
    manifest = root / BASE / "manifest.json"
    require(manifest.is_file() and not manifest.is_symlink(), "manifest is absent or symlinked")
    raw = manifest.read_bytes()
    require(0 < len(raw) <= 65536, "manifest exceeds size budget")
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
    require(type(data) is dict and set(data) ==
            {"schema_version", "suite", "evidence_status", "cases"},
            "invalid manifest shape")
    require(data["schema_version"] == 2 and data["suite"] == "borrow-ownership-v2"
            and data["evidence_status"] == "contract-only-not-executed",
            "unsupported suite revision or execution claim")
    cases = data["cases"]
    require(type(cases) is list and len(cases) == len(CASES),
            "missing or extra v2 cases")
    observed = set()
    for case in cases:
        require(type(case) is dict and set(case) ==
                {"id", "path", "sha256", "expectation", "readiness"}, "invalid case keys")
        name = case["id"]
        require(type(name) is str and name in CASES and name not in observed,
                "duplicate or unknown case")
        observed.add(name)
        digest, kind = CASES[name]
        require(case["path"] == BASE + name + ".ores" and
                case["sha256"] == digest and SHA.fullmatch(case["sha256"]) is not None,
                "invalid source fixture path/digest")
        source = root / case["path"]
        require(source.is_file() and not source.is_symlink() and
                hashlib.sha256(source.read_bytes()).hexdigest() == digest,
                "source bytes do not match reviewed source SHA")
        expected = case["expectation"]
        if kind == "return":
            require(expected == {"kind": "return", "exit_code": 42},
                    "wrong executable oracle")
        else:
            category = ("conflicting-loan" if name == "borrow-overlap-reject"
                        else "shared-loan-write")
            require(expected == {"kind": "reject", "category": category,
                                  "emitted_ir_bytes": 0},
                    "wrong rejection oracle")
        readiness = case["readiness"]
        require(type(readiness) is dict and set(readiness) == ALLOWED_PROFILES
                and readiness["llvm-native-aot"] == "required"
                and readiness["graal-jvm-guest"] == "pending"
                and readiness["graal-native-guest-aot"] == "pending",
                "readiness falsely promotes unexecuted backend")
    require(observed == set(CASES), "incomplete fixture coverage")
    return len(observed)


if __name__ == "__main__":
    try:
        print("BORROW_V2_CONTRACT_VALID cases=" + str(check()) +
              " execution=NOT-ATTESTED")
    except (ContractError, OSError, UnicodeError, ValueError, TypeError) as error:
        print("BORROW_V2_DENIED: " + str(error), file=sys.stderr)
        sys.exit(1)
