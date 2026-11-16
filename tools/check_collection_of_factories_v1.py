#!/usr/bin/env python3
"""Validate source-expectation metadata ONLY. Never report guest execution."""
import json
import pathlib
import re
import sys

FAMILIES = frozenset("map entry pair tuple array list vector set record".split())
BACKENDS = frozenset("java llvm wasm forge net cranelift js rs hdl".split())
PHASES = frozenset("parser type ownership runtime guest".split())
ID = re.compile(r"^[a-z][a-z0-9-]{2,80}$")
ALLOWED_EXPECTED = frozenset(("ACCEPT", "REJECT"))
REMOVED_TILDE = re.compile(r"~(?:map|entry|pair|tuple|array|list|vector|set|record)\s*(?:<|\()")


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON authority key: " + key)
        result[key] = value
    return result


def check(path):
    path = pathlib.Path(path)
    raw = path.read_bytes()
    if len(raw) > 131072:
        raise ValueError("collection factory manifest is over 128 KiB")
    document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
    if document.get("schema") != "atto.collection-of-factories.v1":
        raise ValueError("unknown schema revision")
    if document.get("status") != "SOURCE_EXPECTATIONS_ONLY":
        raise ValueError("manifest cannot claim executed/verified status")
    if document.get("contract") != "contracts/v1/ATTO_CORE_COLLECTION_OF_FACTORIES_V1.md":
        raise ValueError("unknown contract authority path")
    backend_status = document.get("backend_status")
    if not isinstance(backend_status, dict) or set(backend_status) != BACKENDS:
        raise ValueError("all nine backend targets are required")
    if any(s != "NOT_CERTIFIED" for s in backend_status.values()):
        raise ValueError("manifest is not an execution/provenance receipt")
    cases = document.get("cases")
    if not isinstance(cases, list) or not 30 <= len(cases) <= 256:
        raise ValueError("insufficient/excessive bounded candidate cases")
    seen = set()
    coverage = {kind: set() for kind in FAMILIES}
    legacy = 0
    for case in cases:
        if not isinstance(case, dict) or set(case) != {
            "id", "family", "expected", "phase", "source", "status"
        }:
            raise ValueError("invalid case field set")
        ident, family = case["id"], case["family"]
        if not isinstance(ident, str) or ID.fullmatch(ident) is None or ident in seen:
            raise ValueError("duplicate or malformed case id")
        seen.add(ident)
        if family not in FAMILIES | {"legacy"}:
            raise ValueError("unsupported family: " + str(family))
        if case["expected"] not in ALLOWED_EXPECTED or case["phase"] not in PHASES:
            raise ValueError("invalid expected result or phase")
        if case["status"] != "TARGET_NOT_EXECUTED":
            raise ValueError("a source target is not an executed guest proof")
        source = case["source"]
        if not isinstance(source, str) or not (8 <= len(source) <= 4096):
            raise ValueError("source candidate is empty/overlarge")
        if family == "legacy":
            legacy += 1
            continue
        coverage[family].add(case["expected"])
        if case["expected"] == "ACCEPT":
            if f"{family.capitalize()}.of" not in source or REMOVED_TILDE.search(source):
                raise ValueError("positive case does not exercise canonical Type.of factory")
        if REMOVED_TILDE.search(source) and (case["expected"] != "REJECT"
                                             or case["phase"] != "parser"):
            raise ValueError("removed tilde constructor must be a parser rejection")
    for family in FAMILIES:
        named = [c for c in cases if c["family"] == family
                 and c["id"] in (family + "-tilde", "map-explicit-tilde")]
        if len(named) != 1 or named[0]["expected"] != "REJECT" or named[0]["phase"] != "parser":
            raise ValueError("missing negative tilde constructor coverage: " + family)
        if not REMOVED_TILDE.search(named[0]["source"]):
            raise ValueError("negative tilde fixture no longer exercises removed constructor")
    for family, expected in coverage.items():
        if expected != ALLOWED_EXPECTED:
            raise ValueError(f"missing positive/negative coverage: {family}")
    if legacy < 6:
        raise ValueError("legacy tuple/array/vector shape safeguards are missing")
    return len(cases)


def main():
    path = (pathlib.Path(__file__).resolve().parents[1]
            / "fixtures/collection-of-factories-v1/manifest.json")
    try:
        count = check(path)
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        print("COLLECTION_FACTORY_MANIFEST_INVALID:", exc, file=sys.stderr)
        return 1
    print(f"SOURCE_EXPECTATIONS_ONLY cases={count} backends=9 executableParityCertified=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
