#!/usr/bin/env python3
"""Fail-closed *offline* native-guest execution record comparison.

NOT a CI attestor: verify GitHub job/runner/checkout and binary provenance
independently. A passing unit test or self-reported record is NOT native AOT.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
PROFILES = {"llvm-native-aot", "graal-jvm-guest", "graal-native-guest-aot"}
STAGES = {"llvm-native-aot": "native-execute", "graal-jvm-guest": "guest-execute",
          "graal-native-guest-aot": "native-execute"}


class ContractError(ValueError):
    pass


def require(test: bool, explanation: str) -> None:
    if not test:
        raise ContractError(explanation)


def json_load(raw: bytes):
    def unique(pairs):
        output = {}
        for key, value in pairs:
            require(key not in output, f"duplicate JSON field: {key}")
            output[key] = value
        return output

    def bad_number(value):
        raise ContractError(f"non-JSON constant: {value}")

    return json.loads(raw, object_pairs_hook=unique, parse_constant=bad_number)


def load_manifest(root: Path):
    raw = (root / "fixtures/native-guest-v1/manifest.json").read_bytes()
    require(len(raw) <= 65536, "oversized manifest")
    manifest = json_load(raw)
    require(type(manifest) is dict and set(manifest) ==
            {"schema_version", "suite", "evidence_status", "profiles", "cases"},
            "invalid manifest keys")
    require(manifest["schema_version"] == 1 and
            manifest["suite"] == "native-guest-parity-v1" and
            manifest["evidence_status"] == "contract-only-not-executed",
            "unsupported suite version/status")
    require(type(manifest["profiles"]) is list and
            set(manifest["profiles"]) == PROFILES and len(manifest["profiles"]) == 3,
            "invalid profile list")
    cases = manifest["cases"]
    require(type(cases) is list and len(cases) == 3, "missing or extra suite cases")
    expected_ids = {"scalar-main", "owned-array-main", "private-array-negative"}
    checked = {}
    for case in cases:
        require(type(case) is dict and set(case) ==
                {"id", "path", "sha256", "expectation", "readiness"},
                "unexpected case keys")
        name, path, digest = case["id"], case["path"], case["sha256"]
        require(type(name) is str and name in expected_ids and name not in checked,
                "duplicate/unknown case")
        require(type(path) is str and path == f"fixtures/native-guest-v1/{name}.ores",
                "unsafe or incorrect fixture path")
        require(type(digest) is str and HEX64.fullmatch(digest) is not None,
                "invalid fixture digest")
        source = root / path
        require(source.is_file() and not source.is_symlink() and
                hashlib.sha256(source.read_bytes()).hexdigest() == digest,
                f"fixture bytes not pinned: {name}")
        expectation = case["expectation"]
        require(type(expectation) is dict, "invalid expected result")
        if name == "private-array-negative":
            require(expectation == {"kind": "reject", "diagnostic": "private class field"},
                    "invalid negative oracle")
        else:
            require(expectation == {"kind": "return", "exit_code": 42},
                    "invalid exit oracle")
        readiness = case["readiness"]
        require(type(readiness) is dict and set(readiness) == PROFILES and
                all(value in ("required", "pending") for value in readiness.values()),
                "invalid readiness")
        # Do not let a repository PR self-promote an unproved Graal guest AOT path.
        require(readiness["graal-native-guest-aot"] == "pending",
                "Graal guest-native AOT requires a separately reviewed suite revision")
        require(readiness["llvm-native-aot"] == "required" and
                readiness["graal-jvm-guest"] == ("required" if name == "scalar-main" else "pending"),
                "v1 readiness unexpectedly changed")
        checked[name] = case
    require(set(checked) == expected_ids, "case inventory mismatch")
    return hashlib.sha256(raw).hexdigest(), checked


def validate(report: dict, manifest_digest: str, cases: dict) -> dict:
    require(type(report) is dict and set(report) ==
            {"schema_version", "profile", "manifest_sha256", "source_tree", "compiler_sha",
             "run_id", "job_id", "run_attempt", "runner_id", "compiler_artifact_sha256",
             "artifact_kind", "guest_lowering", "fallback", "conclusion", "observed"},
            "invalid execution report keys")
    profile = report["profile"]
    require(profile in PROFILES, "unsupported profile")
    require(report["schema_version"] == 1 and
            report["manifest_sha256"] == manifest_digest, "manifest identity mismatch")
    for k in ("source_tree", "compiler_sha"):
        require(type(report[k]) is str and HEX40.fullmatch(report[k]) is not None,
                f"invalid source identity: {k}")
    require(type(report["compiler_artifact_sha256"]) is str and
            HEX64.fullmatch(report["artifact_sha256"]) is not None,
            "invalid compiler executable digest")
    for k in ("run_id", "job_id", "run_attempt", "runner_id"):
        require(type(report[k]) is int and report[k] > 0, f"invalid positive provenance: {k}")
    require(report["conclusion"] == "success" and report["fallback"] == "none",
            "failed run or runtime fallback")
    if profile == "llvm-native-aot":
        require(report["artifact_kind"] == "llvm-native-compiler" and
                report["guest_lowering"] == "llvm-ir", "not compiled native LLVM guest")
    elif profile == "graal-native-guest-aot":
        require(report["artifact_kind"] == "graal-guest-aot-compiler" and
                report["guest_lowering"] == "compiled-guest-methods",
                "Native Image of interpreter is not compiled guest AOT")
    else:
        require(report["artifact_kind"] == "jvm-guest-launcher" and
                report["guest_lowering"] == "truffle-guest", "not a JVM guest execution")
    observations = report["observed"]
    require(type(observations) is dict, "missing observations")
    required = {key for key, case in cases.items()
                if case["readiness"][profile] == "required"}
    require(bool(required), "no required executed cases for this profile")
    require(set(observations) == required,
            f"missing required cases or unearned pending passes for {profile}")
    for key, obs in observations.items():
        expectation = cases[key]["expectation"]
        require(type(obs) is dict and obs.get("fixture_sha256") == cases[key]["sha256"],
                f"wrong fixture for {key}")
        if expectation["kind"] == "return":
            fields = {"fixture_sha256", "stage", "exit_code", "linked_guest"}
            if profile != "graal-jvm-guest":
                fields |= {"guest_ir_sha256", "native_binary_sha256_before", "native_binary_sha256_after"}
                for digest_field in ("guest_ir_sha256", "native_binary_sha256_before", "native_binary_sha256_after"):
                    require(type(obs.get(digest_field)) is str and HEX64.fullmatch(obs[digest_field]) is not None,
                            f"missing per-program native provenance: {key}.{digest_field}")
                require(obs["native_binary_sha256_before"] == obs["native_binary_sha256_after"],
                        f"native executable mutated during test: {key}")
            require(set(obs) == fields and
                    obs["stage"] == STAGES[profile] and
                    type(obs["exit_code"]) is int and obs["exit_code"] == 42 and
                    obs["linked_guest"] is True, f"wrong native guest result for {key}")
        else:
            require(set(obs) == {"fixture_sha256", "stage", "diagnostic", "compiler_rc", "emitted_ir_bytes"} and
                    obs["stage"] == "compiler-reject" and
                    obs["diagnostic"] == expectation["diagnostic"] and
                    type(obs["compiler_rc"]) is int and obs["compiler_rc"] > 0 and
                    type(obs["emitted_ir_bytes"]) is int and obs["emitted_ir_bytes"] == 0,
                    f"invalid rejection evidence for {key}")
    return observations


def compare(left: dict, right: dict, cases: dict):
    # Do not conflate JVM guest execution with native guest-AOT evidence.
    a, b = left["profile"], right["profile"]
    require(a != b, "cannot compare a profile to itself")
    common = {name for name, case in cases.items()
              if case["readiness"][a] == "required" and
              case["readiness"][b] == "required"}
    require(bool(common), "no certified common execution obligations for these profiles")
    require(common <= set(left["observed"]) and common <= set(right["observed"]),
            "missing common executed source cases")
    for name in common:
        x, y = left["observed"][name], right["observed"][name]
        # Stages and artifact kind differ; compare only actual observable exit/reject.
        expectation = cases[name]["expectation"]
        field = "exit_code" if expectation["kind"] == "return" else "diagnostic"
        require(x[field] == y[field], f"cross-backend divergence: {name}")
    return len(common)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--report", type=Path, action="append", required=True)
    args = ap.parse_args()
    try:
        digest, cases = load_manifest(args.root)
        reports = [json_load(path.read_bytes()) for path in args.report]
        require(1 <= len(reports) <= 2, "expect one or two distinct reports")
        for report in reports:
            validate(report, digest, cases)
        number = compare(reports[0], reports[1], cases) if len(reports) == 2 else 0
        print(f"OFFLINE_RECORD_CHECK_PASS reports={len(reports)} common_cases={number}")
        print("NOT ATTESTED: independently inspect exact Git trees, CI steps, native binaries and logs")
        return 0
    except (ContractError, OSError, ValueError, TypeError, KeyError) as exc:
        print("NATIVE_GUEST_PARITY_DENIED: " + str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
