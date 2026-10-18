#!/usr/bin/env python3
"""Verify the frozen portable signed-i64 source corpus; NOT backend execution evidence."""
from __future__ import annotations
import ast
import hashlib
import json
from pathlib import Path
import re
import sys

CORPUS = Path(__file__).resolve().parents[1] / "contracts/v1/source-i64/portable-i64.v1.json"
MAX_BYTES = 8192
GIT_BLOB_SHA1 = "bbc319c19ecd007109d33592e210091eb267e5a2"
BYTES_SHA256 = "39bddbe558ad1c336271f91e6403c4555f2f16a7ed33a3355ee897721b6ab02a"
I64_MIN, I64_MAX = -(1 << 63), (1 << 63) - 1
EXPECTED_CASES = (
    "precedence", "grouping", "signed-multiplication", "subtraction",
    "negative-result", "max-minus-one", "signed-minimum"
)
ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")

class ContractError(ValueError):
    pass

def no_duplicate_keys(pairs):
    obj = {}
    for k, v in pairs:
        if k in obj:
            raise ContractError("duplicate JSON field: " + k)
        obj[k] = v
    return obj

def bad_constant(v):
    raise ContractError("non-JSON constant: " + v)

def _checked(value: int) -> int:
    if type(value) is not int or not (I64_MIN <= value <= I64_MAX):
        raise ContractError("signed-i64 value or intermediate overflow")
    return value

def oracle(expression: str) -> int:
    """Independent bounded arithmetic oracle, never eval(source)."""
    if type(expression) is not str or len(expression) > 256:
        raise ContractError("invalid source expression length")
    if not re.fullmatch(r"[0-9+*()\- \t]+", expression, re.ASCII):
        raise ContractError("unsupported token in portable expression")
    try:
        node = ast.parse(expression, mode="eval").body
    except (SyntaxError, ValueError, RecursionError) as exc:
        raise ContractError("invalid expression syntax") from exc
    def interpret(expr, depth=0):
        if depth > 40:
            raise ContractError("expression exceeds depth budget")
        if isinstance(expr, ast.Constant) and type(expr.value) is int:
            return expr.value  # unary sign is applied before the i64 range check
        if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, (ast.UAdd, ast.USub)):
            operand = interpret(expr.operand, depth+1)
            result = -operand if isinstance(expr.op, ast.USub) else operand
            return _checked(result)
        if isinstance(expr, ast.BinOp) and type(expr.op) in (ast.Add, ast.Sub, ast.Mult):
            left = _checked(interpret(expr.left, depth+1))
            right = _checked(interpret(expr.right, depth+1))
            return _checked({ast.Add: lambda: left+right,
                             ast.Sub: lambda: left-right,
                             ast.Mult: lambda: left*right}[type(expr.op)]())
        raise ContractError("unsupported portable expression AST")
    return _checked(interpret(node))

def validate_bytes(raw: bytes):
    if not 0 < len(raw) <= MAX_BYTES:
        raise ContractError("empty or oversized corpus")
    blob = b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
    if hashlib.sha1(blob).hexdigest() != GIT_BLOB_SHA1:
        raise ContractError("corpus differs from reviewed Git blob")
    if hashlib.sha256(raw).hexdigest() != BYTES_SHA256:
        raise ContractError("corpus differs from independent SHA-256 pin")
    try:
        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicate_keys,
                            parse_constant=bad_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ContractError("invalid JSON or UTF-8") from exc
    if type(parsed) is not dict or set(parsed) != {"schema_version","status","scope","cases"}:
        raise ContractError("unexpected corpus fields")
    if parsed["schema_version"] != "1.0.0" or parsed["status"] != "reference-only-not-compiled-execution":
        raise ContractError("unsupported corpus version/status")
    if type(parsed["scope"]) is not str or "every intermediate value is representable as i64" not in parsed["scope"]:
        raise ContractError("portable i64 scope mismatch")
    cases = parsed["cases"]
    if type(cases) is not list or len(cases) != len(EXPECTED_CASES):
        raise ContractError("missing or extra portable cases")
    for index, case in enumerate(cases):
        if type(case) is not dict or set(case) != {"id","expression","expected"}:
            raise ContractError("case shape mismatch")
        if type(case["id"]) is not str or case["id"] != EXPECTED_CASES[index] or not ID.fullmatch(case["id"]):
            raise ContractError("case ID or ordering mismatch")
        if type(case["expected"]) is not str or not re.fullmatch(r"-?(0|[1-9][0-9]*)",case["expected"]):
            raise ContractError("noncanonical expected i64 decimal")
        if oracle(case["expression"]) != int(case["expected"]):
            raise ContractError("independent i64 oracle does not agree with case expectation")
    return parsed

if __name__ == "__main__":
    try:
        c = validate_bytes(CORPUS.read_bytes())
        print(f"source-i64 reviewed contract valid: {len(c['cases'])} cases; execution NOT attested")
    except (OSError, ContractError) as exc:
        print(f"source-i64 contract DENIED: {exc}",file=sys.stderr)
        sys.exit(1)
