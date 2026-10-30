#!/usr/bin/env python3
"""Fail-closed OFFLINE consistency check of proposed five-backend G0 receipts.

This checks untrusted JSON records, not authenticity of GitHub's run/job APIs.
A passing result MUST NOT be represented as verified guest execution until
an independent verifier fetches exact Git tree, runner, steps and artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

BACKENDS = frozenset(("java", "llvm", "net", "wasm", "forge"))
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
SCHEMA = "oreslang.unsafe-g0-offline-receipts.v1"
REQUIRED_STEPS = frozenset(("Verify exact source head and tree", "Execute G0 source compiler fixtures"))
MAX_BYTES = 4 * 1024 * 1024


class GateError(ValueError):
    pass


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise GateError(reason)


def load(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    require(len(raw) <= MAX_BYTES, "input exceeds 4 MiB")

    def unique(pairs):
        d = {}
        for key, val in pairs:
            require(key not in d, f"duplicate JSON key {key!r}")
            d[key] = val
        return d

    def constant(value):
        raise GateError(f"invalid JSON constant {value}")

    obj = json.loads(raw, object_pairs_hook=unique, parse_constant=constant)
    require(type(obj) is dict, "root must be a JSON object")
    return obj, raw


def sha(value, *, size=40) -> bool:
    return type(value) is str and (HEX40 if size == 40 else HEX64).fullmatch(value) is not None


def pos(value) -> bool:
    return type(value) is int and value > 0


def nonnegative(value) -> bool:
    return type(value) is int and value >= 0


def verify_contract(contract: dict) -> dict[str, str]:
    require(contract.get("schema") == "oreslang.unsafe-boundary.v1", "wrong contract schema")
    require(contract.get("schema_version") == 1, "wrong contract version")
    require(contract.get("status") == "contract-only" and
            contract.get("is_guest_implementation") is False, "G0 contract must remain non-certifying")
    require(contract.get("backends") == dict.fromkeys(BACKENDS, "pending"),
            "G0 contract must not silently promote backend status")
    cases = contract.get("cases")
    require(type(cases) is list and cases, "missing contract cases")
    expected = {}
    for case in cases:
        require(type(case) is dict and type(case.get("id")) is str, "invalid case")
        key = case["id"]
        require(key not in expected and key, "duplicate or empty case ID")
        value = case.get("expected")
        require(value in ("accept", "reject", "accept_after_g2"), "unknown case expectation")
        if value != "accept_after_g2":
            expected[key] = value
    require("ordinary-safe-code" in expected and expected["ordinary-safe-code"] == "accept",
            "missing positive control")
    require(any(v == "reject" for v in expected.values()), "empty negative matrix")
    return expected


def verify_job(run: dict, job: dict, head: str, tree: str) -> None:
    require(type(run) is dict and type(job) is dict, "missing run/job")
    require(pos(run.get("id")) and pos(run.get("run_attempt")), "missing run provenance")
    require(run.get("head_sha") == head and run.get("status") == "completed" and
            run.get("conclusion") == "success", "run not successful at exact head")
    require(pos(job.get("id")) and job.get("run_id") == run["id"] and
            job.get("run_attempt") == run["run_attempt"] and
            job.get("head_sha") == head, "job not bound to exact run attempt/head")
    require(pos(job.get("runner_id")) and
            type(job.get("runner_name")) is str and job["runner_name"].strip(),
            "job never assigned a runner")
    require(job.get("status") == "completed" and job.get("conclusion") == "success",
            "job not completed successfully")
    steps = job.get("steps")
    require(type(steps) is list and len(steps) >= 2, "zero-step/incomplete CI job")
    seen = set()
    for step in steps:
        require(type(step) is dict and type(step.get("name")) is str,
                "invalid workflow step")
        name = step["name"]
        require(name not in seen, "duplicate workflow step")
        seen.add(name)
        require(step.get("status") == "completed" and step.get("conclusion") == "success",
                "skipped, failed or unexecuted workflow step")
    require(REQUIRED_STEPS <= seen, "missing exact-tree or executed compiler test step")
    # A self-reported checkout observation is NOT a remote Git-object attestation.
    require(job.get("observed_source_tree") == tree, "checkout Git tree mismatch")


def verify(contract: dict, contract_bytes: bytes, receipt: dict) -> tuple[int, int]:
    expected = verify_contract(contract)
    require(set(receipt) == {"schema", "contract_sha256", "profiles"}, "invalid receipt top-level keys")
    require(receipt["schema"] == SCHEMA, "unsupported receipt schema")
    require(receipt["contract_sha256"] == hashlib.sha256(contract_bytes).hexdigest(),
            "contract bytes not pinned")
    profiles = receipt["profiles"]
    require(type(profiles) is list and len(profiles) == len(BACKENDS),
            "requires five distinct backend profiles")
    seen = set()
    total = 0
    for profile in profiles:
        require(type(profile) is dict and set(profile) == {
            "backend", "source_head", "source_tree", "compiler_sha256", "run", "job", "observations"
        }, "invalid backend profile keys")
        backend = profile["backend"]
        require(backend in BACKENDS and backend not in seen, "duplicate or unknown backend")
        seen.add(backend)
        head, tree = profile["source_head"], profile["source_tree"]
        require(sha(head) and sha(tree) and sha(profile["compiler_sha256"], size=64),
                f"{backend}: invalid head/tree/compiler digest")
        verify_job(profile["run"], profile["job"], head, tree)
        observations = profile["observations"]
        require(type(observations) is list and len(observations) == len(expected),
                f"{backend}: incomplete G0 case inventory")
        present = set()
        for obs in observations:
            require(type(obs) is dict and set(obs) == {
                "case_id", "source", "source_sha256", "outcome", "compiler_rc",
                "diagnostic", "emitted_ir_bytes", "emitted_binary_bytes"
            }, f"{backend}: malformed observation")
            case = obs["case_id"]
            require(type(case) is str and case in expected and case not in present,
                    f"{backend}: unrecognized or duplicate case")
            present.add(case)
            source = obs["source"]
            require(type(source) is str and 0 < len(source.encode("utf-8")) <= 65536 and
                    hashlib.sha256(source.encode("utf-8")).hexdigest() == obs["source_sha256"],
                    f"{backend}:{case}: fixture digest mismatch")
            require(nonnegative(obs["emitted_ir_bytes"]) and
                    nonnegative(obs["emitted_binary_bytes"]),
                    f"{backend}:{case}: invalid emitted artifact sizes")
            if expected[case] == "reject":
                require(obs["outcome"] == "rejected" and pos(obs["compiler_rc"]) and
                        type(obs["diagnostic"]) is str and obs["diagnostic"].strip() and
                        obs["emitted_ir_bytes"] == obs["emitted_binary_bytes"] == 0,
                        f"{backend}:{case}: rejection, diagnostic and zero artifact required")
            else:
                require(obs["outcome"] == "accepted" and obs["compiler_rc"] == 0 and
                        obs["diagnostic"] == "" and
                        (obs["emitted_ir_bytes"] > 0 or obs["emitted_binary_bytes"] > 0),
                        f"{backend}:{case}: compiled positive control artifact required")
            total += 1
        require(present == set(expected), f"{backend}: missing required G0 cases")
    require(seen == BACKENDS, "missing backend")
    return len(seen), total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        contract, raw = load(args.contract)
        receipt, _ = load(args.receipt)
        backends, tests = verify(contract, raw, receipt)
    except (GateError, OSError, ValueError, UnicodeError, TypeError, OverflowError) as exc:
        print("REJECT_UNVERIFIED_G0: " + str(exc), file=sys.stderr)
        return 1
    print(f"OFFLINE_RECORD_CONSISTENT_NOT_ATTESTED backends={backends} observations={tests}")
    print("Authenticity of GitHub run/job/checkout/binary provenance must be verified independently.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
