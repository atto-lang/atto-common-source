"""Fail-closed *record* gate for executed dispatch parity.

This checks provenance and an exact result/return-signal oracle. It does not
run compilers itself; synthetic unit-test receipts are never CI guest evidence.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


class DispatchParityError(ValueError):
    pass


EXPECTED_DEST = {
    "match": "ARM_RESULT",
    "do match": "FUNCTION_RETURN",
    "switch": "ARM_RESULT",
    "do switch": "FUNCTION_RETURN",
}
SHA = re.compile(r"^[0-9a-f]{40}$")


def blob_sha(text: str) -> str:
    data = text.encode("utf-8")
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def oracle(path: str | Path) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("version") != "dispatch-return-v1" or not isinstance(data.get("cases"), list):
        raise DispatchParityError("invalid oracle version or cases")
    unique = set()
    unique_forms = set()
    for item in data["cases"]:
        if not isinstance(item, dict):
            raise DispatchParityError("invalid case")
        name = item.get("id")
        form = item.get("form")
        if not isinstance(name, str) or name in unique:
            raise DispatchParityError("duplicate or invalid oracle id")
        unique.add(name)
        if form not in EXPECTED_DEST or item.get("return_destination") != EXPECTED_DEST[form]:
            raise DispatchParityError("wrong destination in oracle")
        if form in unique_forms:
            raise DispatchParityError("duplicate dispatch form in oracle")
        unique_forms.add(form)
        result = item.get("expected_result")
        if type(result) is not int or not -(1 << 63) <= result < (1 << 63):
            raise DispatchParityError("expected result is not signed i64")
        if not isinstance(item.get("source"), str) or not item["source"].strip():
            raise DispatchParityError("missing source")
        support = item.get("support")
        if not isinstance(support, dict) or set(support) != {"llvm", "graal"}:
            raise DispatchParityError("unsupported backend declaration")
        if any(v not in ("candidate", "unsupported") for v in support.values()):
            raise DispatchParityError("invalid support status")
    if unique_forms != set(EXPECTED_DEST) or len(data["cases"]) != len(EXPECTED_DEST):
        raise DispatchParityError("exactly four dispatch forms required")
    return data


def _integer(value) -> bool:
    return type(value) is int and value > 0


def _record(record: dict, backend: str, included: list[dict]) -> None:
    if not isinstance(record, dict) or record.get("backend") != backend:
        raise DispatchParityError("wrong backend record")
    if any(not isinstance(record.get(x), str) or not SHA.fullmatch(record[x])
           for x in ("source_tree", "compiler_sha")):
        raise DispatchParityError("missing exact tree/compiler provenance")
    if any(not _integer(record.get(x)) for x in ("run_id", "job_id", "runner_id", "executed_tests")):
        raise DispatchParityError("no allocated runner or executed tests")
    if record.get("conclusion") != "success":
        raise DispatchParityError("no successful executable run")
    for x in ("skipped_tests", "failed_tests", "errored_tests"):
        if type(record.get(x)) is not int or record[x] != 0:
            raise DispatchParityError("skips, failures, or errors present")
    observed = record.get("observed")
    if not isinstance(observed, dict) or set(observed) != {x["id"] for x in included}:
        raise DispatchParityError("missing or unexpected executable case")
    if record["executed_tests"] < len(included):
        raise DispatchParityError("insufficient executed tests")
    if record.get("synthetic") is True:
        raise DispatchParityError("synthetic records cannot be execution evidence")
    for case in included:
        actual = observed[case["id"]]
        if not isinstance(actual, dict) or type(actual.get("result")) is not int:
            raise DispatchParityError("missing typed result")
        if actual["result"] != case["expected_result"]:
            raise DispatchParityError("wrong guest result")
        trace = (["ARM_RESULT", "FUNCTION_RETURN"]
                 if case["return_destination"] == "ARM_RESULT" else ["FUNCTION_RETURN"])
        if actual.get("return_trace") != trace:
            raise DispatchParityError("wrong lexical return destination")
        if actual.get("source_blob") != blob_sha(case["source"]):
            raise DispatchParityError("fixture blob mismatch")


def compare(graal: dict, llvm: dict, manifest: dict, *, require_full: bool = True) -> int:
    # This validates an externally acquired receipt's SHAPE and semantics.
    # It cannot independently authenticate GitHub runner status, compiler
    # identity, or actual guest execution. A release decision MUST separately
    # fetch immutable CI job evidence and verify the cited source Git trees.
    # The default rejects a partial four-form subset; callers requesting a
    # partial audit must explicitly opt in with require_full=False.
    common = [
        c for c in manifest["cases"]
        if c["support"]["graal"] == c["support"]["llvm"] == "candidate"
    ]
    if require_full and len(common) != len(manifest["cases"]):
        raise DispatchParityError("full four-form conformance is not supported")
    if not common:
        raise DispatchParityError("no common supported guest cases")
    _record(graal, "graal", common)
    _record(llvm, "llvm", common)
    return len(common)
