#!/usr/bin/env python3
"""Experimental HIR v1 EXACT-SOURCE front-end parity probe.

Runs the ACTUAL Java and LLVM source frontends on the same source file. This
compares HIR output, NOT executed Java/LLVM binaries or production AOT/JIT.
The frontends must already be built explicitly by the caller.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys

from experiments.ir_v1 import (
    IRValidationError, canonical_bytes, execute, load_json, lower, validate_hir,
)


def compare_hir(java_raw: bytes, llvm_raw: bytes, *, entry=None, expected=None) -> dict:
    """Validate each emitted HIR independently before comparing semantics."""
    java_hir = validate_hir(load_json(java_raw))
    llvm_hir = validate_hir(load_json(llvm_raw))
    if canonical_bytes(java_hir) != canonical_bytes(llvm_hir):
        raise IRValidationError("Java and LLVM exported HIR differ")
    mir = lower(java_hir)
    evidence = {
        "contract": "ores-hir/1.0.0-experimental",
        "hir_sha256": sha256(canonical_bytes(java_hir)).hexdigest(),
        "mir_sha256": sha256(canonical_bytes(mir)).hexdigest(),
        "frontends_equal": True,
        "executed_backends": False,
    }
    if entry is not None:
        value = execute(mir, entry, [])
        if expected is not None and (type(value) is not int or value != expected):
            raise IRValidationError("reference MIR interpreter returned unexpected value")
        evidence["reference_interpreter_result"] = value
    return evidence


def run_exact(argv: list[str], timeout: int) -> bytes:
    try:
        process = subprocess.run(
            argv, stdin=subprocess.DEVNULL, capture_output=True,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IRValidationError("frontend binary unavailable or timed out: "
                                + argv[0]) from exc
    if process.returncode != 0:
        raise IRValidationError(
            "frontend command failed (" + str(process.returncode) + "): "
            + argv[0] + " stderr=" + process.stderr[:2048].decode("utf-8", "replace")
        )
    if not process.stdout or len(process.stdout) > 1_048_576:
        raise IRValidationError("missing/oversized emitted HIR: " + argv[0])
    return process.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--java-classpath", required=True)
    parser.add_argument("--java-binary", default="java")
    parser.add_argument("--llvm-binary", required=True)
    parser.add_argument("--entry")
    parser.add_argument("--expected-i64", type=int)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)
    if args.expected_i64 is not None and args.entry is None:
        parser.error("--expected-i64 requires --entry")
    if not 1 <= args.timeout <= 120:
        parser.error("--timeout must be between 1 and 120 seconds")
    try:
        source = args.source.read_bytes()
        if len(source) > 1_048_576:
            raise IRValidationError("source exceeds 1 MiB")
        # The exact same file path is passed to both real parser entrypoints.
        java = run_exact([args.java_binary, "-cp", args.java_classpath,
                          "dev.oreslang.compiler.ExperimentalHirV1Exporter",
                          str(args.source)], args.timeout)
        llvm = run_exact([args.llvm_binary, "--experimental-emit-hir-v1",
                          str(args.source)], args.timeout)
        evidence = compare_hir(java, llvm, entry=args.entry, expected=args.expected_i64)
        evidence["source_sha256"] = sha256(source).hexdigest()
        # Externally supplied binaries are not cryptographically attested here.
        evidence["compiler_revision_verified"] = False
        print(json.dumps(evidence, sort_keys=True, separators=(",", ":")))
        return 0
    except (IRValidationError, OSError) as exc:
        print("experimental HIR parity FAILED: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
