"""Thin CLI for experimental Oreslang HIR/MIR v1 verification and execution."""
import argparse
import json
from pathlib import Path
import sys

from . import IRRuntimeError, IRValidationError, execute, load_json, lower, validate_hir, validate_mir


def main(argv=None):
    parser = argparse.ArgumentParser(description="Experimental HIR/MIR v1: not a production compiler")
    parser.add_argument("operation", choices=["verify-hir", "verify-mir", "lower", "run"])
    parser.add_argument("file", type=Path)
    parser.add_argument("--function", help="Function for 'run'")
    parser.add_argument("--args-json", default="[]", help="JSON array of arguments for 'run'")
    ns = parser.parse_args(argv)
    try:
        document = load_json(ns.file.read_bytes())
        if ns.operation == "verify-hir":
            validate_hir(document)
            print("HIR verified (experimental subset)")
        elif ns.operation == "verify-mir":
            validate_mir(document)
            print("MIR verified (experimental subset)")
        elif ns.operation == "lower":
            transformed = lower(document)
            print(json.dumps(transformed, indent=2, ensure_ascii=False))
        else:
            if not ns.function:
                parser.error("--function is required with run")
            args = load_json(ns.args_json)
            value = execute(document, ns.function, args)
            print(json.dumps(value, allow_nan=False))
        return 0
    except (IRValidationError, IRRuntimeError, OSError) as exc:
        print(f"IR error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
