#!/usr/bin/env python3
"""Structural offline guard for portable Oreslang memory-profile evidence.

IMPORTANT: Input is self-reported. Passing this checker NEVER authenticates
GitHub CI runs, binaries, sanitizer results, or runtime observations.
Those must be independently inspected at pinned exact heads.
"""
import argparse
import json
import re
import sys
from pathlib import Path

SHA = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_GUEST = {
    "llvm-native", "desktop-native", "wasm32-core", "embedded-freestanding",
    "graal-jvm", "graal-native-image",
}
ALLOWED_METRIC_RULES = {"zero", "measured"}
ALLOWED_GUEST_GC = {
    "forbidden", "not-required-for-guest-resource-correctness",
}


class MemoryEvidenceError(ValueError):
    pass


def _positive_int(value, field):
    if type(value) is not int or value < 1:
        raise MemoryEvidenceError(f"{field}: expected positive integer")


def _nonnegative_number(value, field):
    if type(value) not in (int, float) or not (0 <= value < float("inf")):
        raise MemoryEvidenceError(f"{field}: expected finite nonnegative number")


def validate_manifest(manifest):
    if type(manifest) is not dict or manifest.get("schema_version") != 1:
        raise MemoryEvidenceError("manifest: unsupported schema_version")
    shared = manifest.get("shared_proofs")
    if type(shared) is not list or not shared or any(type(x) is not str or not x for x in shared):
        raise MemoryEvidenceError("manifest: invalid shared_proofs")
    if len(shared) != len(set(shared)):
        raise MemoryEvidenceError("manifest: duplicate shared_proofs")
    profiles = manifest.get("profiles")
    if type(profiles) is not dict or set(profiles) != EXPECTED_GUEST:
        raise MemoryEvidenceError("manifest: missing or unknown target profiles")
    for name, profile in profiles.items():
        if type(profile) is not dict or profile.get("guest_gc") not in ALLOWED_GUEST_GC:
            raise MemoryEvidenceError(f"{name}: invalid guest GC policy")
        if not profile.get("host_gc") or not profile.get("delivery"):
            raise MemoryEvidenceError(f"{name}: host GC / delivery missing")
        proofs, metrics = profile.get("proofs"), profile.get("metrics")
        if type(proofs) is not list or not proofs or any(type(p) is not str or not p for p in proofs):
            raise MemoryEvidenceError(f"{name}: invalid proofs")
        if len(proofs) != len(set(proofs)) or set(proofs) & set(shared):
            raise MemoryEvidenceError(f"{name}: duplicate / overlapping proofs")
        if type(metrics) is not dict or not metrics or any(
            rule not in ALLOWED_METRIC_RULES for rule in metrics.values()
        ):
            raise MemoryEvidenceError(f"{name}: invalid metric rules")
        if profile["guest_gc"] == "forbidden" and not any(
            "gc_invocations" in key for key in metrics
        ):
            raise MemoryEvidenceError(f"{name}: missing guest/no-tracing GC counter")
    return profiles


def check_record(manifest, record):
    profiles = validate_manifest(manifest)
    if type(record) is not dict or record.get("schema_version") != 1:
        raise MemoryEvidenceError("record: unsupported schema_version")
    name = record.get("profile")
    if name not in profiles:
        raise MemoryEvidenceError("record: unknown profile")
    profile = profiles[name]
    if record.get("delivery") != profile["delivery"]:
        raise MemoryEvidenceError("record: delivery mismatch (no fallback allowed)")
    for field in ("source_tree_sha", "fixture_blob_sha", "binary_sha256"):
        value = record.get(field)
        expected = 64 if field == "binary_sha256" else 40
        if type(value) is not str or not re.fullmatch(r"[0-9a-f]{" + str(expected) + r"}", value):
            raise MemoryEvidenceError(f"record: invalid {field}")
    for field in ("run_id", "job_id", "executed_steps", "executed_guest_tests"):
        _positive_int(record.get(field), field)
    for field in ("failed_tests", "skipped_tests", "errored_tests"):
        value = record.get(field)
        if type(value) is not int or value != 0:
            raise MemoryEvidenceError(f"{field}: must be exactly zero")
    if record.get("run_conclusion") != "success" or record.get("execution_kind") != "compiled-guest":
        raise MemoryEvidenceError("record: missing successful compiled-guest execution")
    if record.get("host_gc_policy") != profile["host_gc"]:
        raise MemoryEvidenceError("record: missing host GC boundary disclosure")
    if record.get("guest_gc_policy") != profile["guest_gc"]:
        raise MemoryEvidenceError("record: guest GC policy mismatch")
    evidence = record.get("proofs")
    needed = manifest["shared_proofs"] + profile["proofs"]
    if type(evidence) is not dict or any(evidence.get(p) is not True for p in needed):
        raise MemoryEvidenceError("record: missing/failed mandatory ownership/GC proof")
    metrics = record.get("metrics")
    if type(metrics) is not dict:
        raise MemoryEvidenceError("record: missing metrics")
    for metric, rule in profile["metrics"].items():
        val = metrics.get(metric)
        _nonnegative_number(val, metric)
        if rule == "zero" and val != 0:
            raise MemoryEvidenceError(f"record: nonzero counter {metric}")
    return name


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path,
        default=Path(__file__).resolve().parents[1] / "contracts/v1/memory-runtime-profiles.json")
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        target = check_record(manifest, evidence)
    except (MemoryEvidenceError, ValueError, OSError, UnicodeError) as error:
        print("MEMORY_EVIDENCE_REJECTED: " + str(error), file=sys.stderr)
        return 1
    print("MEMORY_EVIDENCE_STRUCTURALLY_VALID_ONLY profile=" + target)
    print("NOT CERTIFIED: independently verify pinned code, binary, steps and observed measurements")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
