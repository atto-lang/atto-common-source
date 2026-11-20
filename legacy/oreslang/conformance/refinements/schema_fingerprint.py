"""Independent, source-free oracle for the compiler scalar schema ABI.

Uses the same documented versioned canonical encoding as Java
RefinementRules.descriptor(), but no Java code or runtime reflection.
Only the closed built-in integer/Unicode-length fragment is supported.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re

from conformance.refinements.reference import Refined, _bounds, ConstraintSyntaxError

QUALIFIED = re.compile(r"[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)+\Z")


@dataclass(frozen=True)
class ScalarSchema:
    version: int
    base: str
    property: str
    minimum: int
    maximum: int
    excluded: tuple[int, ...]
    nominal_identity: str
    fingerprint: str
    charset: str = "any"
    unicode_version: str = ""


def descriptor(refined: Refined, qualified_identity: str | None = None) -> ScalarSchema:
    if not refined.predicates and not refined.nominal and refined.charset == "any":
        raise ConstraintSyntaxError("scalar schema requires a refinement or nominal identity")
    if refined.base not in ("int", "string"):
        raise ConstraintSyntaxError("unsupported base type")
    identity = ""
    if refined.nominal:
        if qualified_identity is None or QUALIFIED.fullmatch(qualified_identity) is None:
            raise ConstraintSyntaxError("nominal schema requires a qualified identifier")
        identity = qualified_identity

    lo, hi, excluded = _bounds(refined.predicates, refined.base)
    sorted_excluded = tuple(sorted(excluded))
    property_name = "value" if refined.base == "int" else "length"
    # Java List<Long>.toString() is a bracketed, comma-space joined list.
    holes = "[" + ", ".join(map(str, sorted_excluded)) + "]"
    charset = refined.charset
    if refined.base != "string" and charset != "any":
        raise ConstraintSyntaxError("character policy requires string")
    is_v2 = charset != "any"
    unicode_version = "18.0.0" if charset in ("uppercase", "lowercase", "han") else ""
    canonical = (
        f"oreslang.refinement.v1\n{refined.base}\n{property_name}\n"
        f"{lo}\n{hi}\n{holes}\n{identity}"
    )
    if is_v2:
        # Version 1 fingerprint *must not* change for existing schema files.
        # Unicode policy semantics are tied to a pinned UCD version.
        canonical = (
            f"oreslang.refinement.v2\n{refined.base}\n{property_name}\n"
            f"{lo}\n{hi}\n{holes}\n{identity}\n{charset}\n{unicode_version}"
        )
    return ScalarSchema(
        version=2 if is_v2 else 1,
        base=refined.base,
        property=property_name,
        minimum=lo,
        maximum=hi,
        excluded=sorted_excluded,
        nominal_identity=identity,
        fingerprint=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        charset=charset,
        unicode_version=unicode_version,
    )
