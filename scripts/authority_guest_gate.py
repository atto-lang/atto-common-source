"""Offline source/manifest and supplied admission-evidence verifier.

This module does not run Oreslang compilers or prove report authenticity.
A passing manifest check proves only that pinned Git blobs are intact.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "fixtures/authority-guest-v1/cases.json"
SHA = re.compile(r"[0-9a-f]{40}\Z")


class GateError(ValueError):
    pass


def _fail(reason):
    raise GateError(reason)


def git_blob_sha(payload):
    return hashlib.sha1(b"blob " + str(len(payload)).encode("ascii")
                        + b"\0" + payload).hexdigest()


def verify_manifest(root=ROOT):
    root = Path(root)
    manifest = json.loads((root / "fixtures/authority-guest-v1/cases.json").read_text())
    if manifest.get("schema") != "oreslang.authority-guest-conformance.v1":
        _fail("unknown corpus schema")
    if manifest.get("status") != "candidate-fixtures-only":
        _fail("invalid unsupported-status declaration")
    if manifest.get("evidence") != "NOT_EXECUTED_GUEST_COMPILER":
        _fail("unverified compiler execution claim")
    if manifest.get("backend_status") != {"java": "pending", "llvm": "pending", "wasm": "pending"}:
        _fail("backend readiness cannot be asserted by a source-free corpus")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or len(cases) < 12:
        _fail("insufficient fixture coverage")
    by_id, paths, groups, outcomes = {}, set(), set(), set()
    for case in cases:
        if type(case) is not dict:
            _fail("malformed case")
        if set(case) != {"id", "path", "boundary", "expected",
                         "stage", "source_blob_sha", "candidate_reference"}:
            _fail("unknown or missing case fields")
        cid, path = case["id"], case["path"]
        if not (type(cid) is str and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", cid)):
            _fail("invalid case id")
        if cid in by_id or path in paths:
            _fail("duplicate fixture identity")
        if path != f"fixtures/authority-guest-v1/{cid}.ores":
            _fail("unsafe or noncanonical fixture path")
        if case["boundary"] not in ("types", "ownership", "effects", "capability"):
            _fail("unknown boundary")
        if case["expected"] not in ("accept", "reject"):
            _fail("invalid expectation")
        if case["stage"] not in ("parser", "typecheck", "capability"):
            _fail("unknown phase")
        if case["expected"] == "accept" and case["stage"] != "typecheck":
            _fail("unsupported accept stage")
        if type(case["source_blob_sha"]) is not str or not SHA.fullmatch(case["source_blob_sha"]):
            _fail("invalid blob digest")
        if type(case["candidate_reference"]) is not str or not case["candidate_reference"]:
            _fail("missing reference")
        src = (root / path).read_bytes()
        if not src or b"\x00" in src or not src.endswith(b"\n"):
            _fail("empty or non-text fixture")
        if git_blob_sha(src) != case["source_blob_sha"]:
            _fail("fixture Git blob SHA mismatch")
        by_id[cid] = case
        paths.add(path)
        groups.add(case["boundary"])
        outcomes.add(case["expected"])
    if groups != {"types", "ownership", "effects", "capability"} or outcomes != {"accept", "reject"}:
        _fail("incomplete coverage categories")
    return by_id


def verify_admission_report(report, root=ROOT):
    """Validates claimed compiler admission evidence, never authenticates it.

    Release proof additionally needs independent job/runner attestations,
    exact compiler tree/sha and command output. A rejection from an
    unavailable toolchain, parser crash or unknown phase must not pass.
    """
    cases = verify_manifest(root)
    if type(report) is not dict or set(report) != {
            "schema", "backend", "compiler_sha", "workflow",
            "status", "cases"}:
        _fail("malformed report")
    if report["schema"] != "oreslang.authority-guest-admission-report.v1":
        _fail("report schema")
    if report["backend"] not in ("java", "llvm"):
        _fail("unsupported backend")
    if type(report["compiler_sha"]) is not str or not SHA.fullmatch(report["compiler_sha"]):
        _fail("missing executable compiler revision")
    if report["status"] != "executed":
        _fail("not executed")
    workflow = report["workflow"]
    if not isinstance(workflow, dict) or set(workflow) != {"run_id", "step_count"}:
        _fail("missing workflow evidence fields")
    if type(workflow["run_id"]) is not int or workflow["run_id"] <= 0:
        _fail("invalid workflow run ID")
    if type(workflow["step_count"]) is not int or workflow["step_count"] < 1:
        _fail("zero-step execution")
    observed = report["cases"]
    if not isinstance(observed, list) or len(observed) != len(cases):
        _fail("incomplete executed corpus")
    seen = set()
    for item in observed:
        if type(item) is not dict or set(item) != {
                "id", "source_blob_sha", "result", "stage", "command",
                "tool_exit", "diagnostic"}:
            _fail("malformed result")
        cid = item["id"]
        if type(cid) is not str or cid not in cases or cid in seen:
            _fail("unknown or duplicate result")
        seen.add(cid)
        expected = cases[cid]
        if item["source_blob_sha"] != expected["source_blob_sha"]:
            _fail("stale or altered source fixture")
        if item["result"] != expected["expected"] or item["stage"] != expected["stage"]:
            _fail("unexpected compiler admission or phase")
        if type(item["command"]) is not str or not item["command"].strip():
            _fail("missing compiler command")
        if type(item["tool_exit"]) is not int or type(item["tool_exit"]) is bool:
            _fail("invalid tool exit")
        if item["result"] == "accept":
            if item["tool_exit"] != 0 or item["diagnostic"] is not None:
                _fail("accept case did not compile cleanly")
        else:
            if item["tool_exit"] != 1 or (type(item["diagnostic"]) is not str
                                         or not item["diagnostic"].strip()):
                _fail("rejection lacked a diagnostic")
            lowered = item["diagnostic"].casefold()
            if any(fragment in lowered for fragment in (
                    "traceback (most recent call last)", "filenotfounderror",
                    "command not found", "no such file or directory",
                    "compiler unavailable", "process timed out")):
                _fail("infrastructure failure is not guest rejection")
    return len(seen)
