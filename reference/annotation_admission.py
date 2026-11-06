"""PROPOSED annotation admission reference, NOT a guest compiler or AOT implementation."""
from __future__ import annotations

import json
import re
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "annotation-targets-v2.json"
IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)+\Z")
TYPES = {"string", "type_ref", "positive_int", "enum", "bool"}


class AdmissionError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def load_contract():
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def validate_contract(spec):
    if spec.get("schema") != "atto.annotation-targets.v2":
        raise AdmissionError("CONTRACT_SCHEMA")
    if spec.get("status") != "PROPOSED_REFERENCE_CONTRACT_ONLY_NOT_GUEST_EXECUTED":
        raise AdmissionError("EVIDENCE_STATUS")
    targets, phases = spec["targets"], spec["phases"]
    if len(targets) != len(set(targets)) or len(phases) != len(set(phases)):
        raise AdmissionError("DUPLICATE_CONTRACT_ENTRY")
    names, covered = set(), set()
    for entry in spec["registry"]:
        name = entry["qualifiedName"]
        if not IDENT.fullmatch(name) or name in names:
            raise AdmissionError("ANNOTATION_IDENTITY")
        names.add(name)
        if entry["phase"] not in phases or not entry["allowedTargets"]:
            raise AdmissionError("ANNOTATION_PHASE")
        if set(entry["allowedTargets"]) - set(targets):
            raise AdmissionError("UNKNOWN_TARGET")
        if len(entry["allowedTargets"]) != len(set(entry["allowedTargets"])):
            raise AdmissionError("DUPLICATE_TARGET")
        covered.update(entry["allowedTargets"])
        args = entry["arguments"]
        if len(args) > spec["constraints"]["limits"]["maxArgumentsPerAnnotation"]:
            raise AdmissionError("ARGUMENT_LIMIT")
        if len({a["name"] for a in args}) != len(args):
            raise AdmissionError("DUPLICATE_SCHEMA_ARGUMENT")
        for a in args:
            if a["type"] not in TYPES:
                raise AdmissionError("ARGUMENT_TYPE")
            if a["type"] == "enum" and not a.get("values"):
                raise AdmissionError("ENUM_DOMAIN")
    if covered != set(targets):
        raise AdmissionError("UNCOVERED_TARGET")
    if any(v != "NOT_EXECUTED_THIS_CONTRACT" for v in spec["backendStatus"].values()):
        raise AdmissionError("EVIDENCE_STATUS")
    if any(name.split(".")[-1] in {"Trusted", "Unsafe", "AllowAll", "Untrusted"} for name in names):
        raise AdmissionError("SPOOFED_AUTHORITY")
    return True


def _check_value(field, value, max_bytes):
    kind = field["type"]
    if kind in {"string", "type_ref", "enum"}:
        if type(value) is not str or len(value.encode("utf-8")) > max_bytes:
            raise AdmissionError("ARGUMENT_TYPE")
        if kind == "type_ref" and not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*", value):
            raise AdmissionError("TYPE_IDENTITY")
        if kind == "enum" and value not in field["values"]:
            raise AdmissionError("ENUM_VALUE")
    elif kind == "positive_int":
        if type(value) is not int or value <= 0 or value > 2**63 - 1:
            raise AdmissionError("ARGUMENT_TYPE")
    elif kind == "bool":
        if type(value) is not bool:
            raise AdmissionError("ARGUMENT_TYPE")
    else:
        raise AdmissionError("ARGUMENT_TYPE")


def admit_use(spec, use):
    """Check an already-resolved annotation use; does not parse source or lower code."""
    if use.get("target") not in spec["targets"]:
        raise AdmissionError("UNKNOWN_TARGET")
    entries = {e["qualifiedName"]: e for e in spec["registry"]}
    entry = entries.get(use.get("annotation"))
    if entry is None:
        raise AdmissionError("UNKNOWN_ANNOTATION")
    if use["target"] not in entry["allowedTargets"]:
        raise AdmissionError("WRONG_TARGET")
    schema = entry["arguments"]
    positional, named = use.get("positional", []), use.get("named", [])
    if type(positional) is not list or type(named) is not list:
        raise AdmissionError("ARGUMENT_SHAPE")
    if len(positional) + len(named) > spec["constraints"]["limits"]["maxArgumentsPerAnnotation"]:
        raise AdmissionError("ARGUMENT_LIMIT")
    if len(positional) > len(schema):
        raise AdmissionError("EXCESS_POSITIONAL_ARGUMENTS")
    provided = {}
    for i, value in enumerate(positional):
        field = schema[i]
        provided[field["name"]] = value
    by_name = {field["name"]: field for field in schema}
    for pair in named:
        if type(pair) is not list or len(pair) != 2 or type(pair[0]) is not str:
            raise AdmissionError("ARGUMENT_SHAPE")
        name, value = pair
        if name not in by_name:
            raise AdmissionError("UNKNOWN_ARGUMENT")
        if name in provided:
            raise AdmissionError("DUPLICATE_ARGUMENT")
        provided[name] = value
    for field in schema:
        name = field["name"]
        if field["required"] and name not in provided:
            raise AdmissionError("MISSING_ARGUMENT")
        if name in provided:
            _check_value(field, provided[name], spec["constraints"]["limits"]["maxArgumentStringBytes"])
    return entry


def admit_declaration(spec, uses):
    """Check placement, duplicate policy and budgets for a single declaration."""
    if len(uses) > spec["constraints"]["limits"]["maxAnnotationsPerDeclaration"]:
        raise AdmissionError("ANNOTATION_LIMIT")
    seen = set()
    for use in uses:
        entry = admit_use(spec, use)
        name = entry["qualifiedName"]
        if name in seen and not entry["repeatable"]:
            raise AdmissionError("DUPLICATE_ANNOTATION")
        seen.add(name)
    return True


def require_executable_lowering(spec, uses, backend):
    """Fail closed: never confuse reference-model admission with real backend support."""
    if backend not in spec["backendStatus"]:
        raise AdmissionError("UNKNOWN_BACKEND")
    admit_declaration(spec, uses)
    if uses:
        raise AdmissionError("ANNOTATION_UNLOWERED")
    return True
