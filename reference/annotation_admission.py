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
    if (type(targets) is not list or type(phases) is not list
            or any(type(v) is not str or not v for v in targets + phases)):
        raise AdmissionError("CONTRACT_SCHEMA")
    if len(targets) != len(set(targets)) or len(phases) != len(set(phases)):
        raise AdmissionError("DUPLICATE_CONTRACT_ENTRY")
    # A contract file is input, not permission to increase compiler budgets.
    ceilings = {"maxAnnotationsPerDeclaration": 64, "maxArgumentsPerAnnotation": 8,
                "maxArgumentStringBytes": 4096, "maxExpansionDepth": 32,
                "maxExpansionNodes": 10000, "maxConstEvalSteps": 100000}
    limits = spec.get("constraints", {}).get("limits", {})
    for key, ceiling in ceilings.items():
        value = limits.get(key)
        if type(value) is not int or value < 1 or value > ceiling:
            raise AdmissionError("CONTRACT_LIMIT")
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
        if type(entry.get("repeatable")) is not bool:
            raise AdmissionError("CONTRACT_SCHEMA")
        args = entry["arguments"]
        if type(args) is not list:
            raise AdmissionError("CONTRACT_SCHEMA")
        if len(args) > limits["maxArgumentsPerAnnotation"]:
            raise AdmissionError("ARGUMENT_LIMIT")
        if any(type(a) is not dict or type(a.get("name")) is not str
               or not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", a["name"])
               or type(a.get("required")) is not bool for a in args):
            raise AdmissionError("CONTRACT_SCHEMA")
        if len({a["name"] for a in args}) != len(args):
            raise AdmissionError("DUPLICATE_SCHEMA_ARGUMENT")
        for a in args:
            if a["type"] not in TYPES:
                raise AdmissionError("ARGUMENT_TYPE")
            if a["type"] == "enum":
                values = a.get("values")
                if (type(values) is not list or not values
                        or any(type(v) is not str or not v for v in values)
                        or len(values) != len(set(values))):
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
    if type(use) is not dict:
        raise AdmissionError("ARGUMENT_SHAPE")
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
    declaration_target = uses[0].get("target") if uses else None
    for use in uses:
        if use.get("target") != declaration_target:
            raise AdmissionError("MIXED_DECLARATION_TARGET")
        entry = admit_use(spec, use)
        name = entry["qualifiedName"]
        if name in seen and not entry["repeatable"]:
            raise AdmissionError("DUPLICATE_ANNOTATION")
        seen.add(name)
    return True


def admit_scoped_declaration(spec, uses, declaration):
    """Reference-only contextual checks for a class, method or free function.

    All facts must come from a real compiler's resolved inheritance/type/effect
    analysis; boolean declarations supplied by source text are not proof.
    This helper is neither an AttoLang parser nor executable backend admission.
    """
    if type(declaration) is not dict or type(uses) is not list:
        raise AdmissionError("DECLARATION_SHAPE")
    target = declaration.get("target")
    if target not in ("class", "method", "function"):
        raise AdmissionError("DECLARATION_TARGET")
    if any(type(use) is not dict for use in uses):
        raise AdmissionError("ARGUMENT_SHAPE")
    if any(use.get("target") != target for use in uses):
        raise AdmissionError("MIXED_DECLARATION_TARGET")
    admit_declaration(spec, uses)
    for use in uses:
        annotation = use["annotation"]
        if annotation == "atto.core.Override":
            if (target != "method" or declaration.get("owner_kind") != "class"
                    or declaration.get("is_static") is not False
                    or declaration.get("is_constructor") is not False):
                raise AdmissionError("OVERRIDE_CONTEXT")
            if declaration.get("legacy_override") is True:
                raise AdmissionError("DUPLICATE_ANNOTATION")
            if declaration.get("inherited_concrete") is not True:
                raise AdmissionError("OVERRIDE_MISSING_BASE")
            if (declaration.get("inherited_final") is not False
                    or declaration.get("inherited_sealed") is not False):
                raise AdmissionError("OVERRIDE_FINAL")
            if declaration.get("override_signature_matches") is not True:
                raise AdmissionError("OVERRIDE_SIGNATURE")
            if declaration.get("override_visibility_preserved") is not True:
                raise AdmissionError("OVERRIDE_VISIBILITY")
        elif annotation == "atto.core.Ret":
            named = dict(use.get("named", []))
            annotation_type = (use.get("positional") or [named.get("type")])[0]
            if type(declaration.get("resolved_return_type")) is not str:
                raise AdmissionError("RETURN_PROOF_MISSING")
            if annotation_type != declaration["resolved_return_type"]:
                raise AdmissionError("RETURN_TYPE_MISMATCH")
        elif annotation == "atto.core.Pure":
            if (declaration.get("effect_proof_complete") is not True
                    or type(declaration.get("proven_effects")) is not list):
                raise AdmissionError("EFFECT_PROOF_MISSING")
            if declaration["proven_effects"]:
                raise AdmissionError("PURE_EFFECT_VIOLATION")
    return True


def require_executable_lowering(spec, uses, backend):
    """Fail closed: never confuse reference-model admission with real backend support."""
    if backend not in spec["backendStatus"]:
        raise AdmissionError("UNKNOWN_BACKEND")
    admit_declaration(spec, uses)
    if uses:
        raise AdmissionError("ANNOTATION_UNLOWERED")
    return True
