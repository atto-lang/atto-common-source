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


def descriptor(refined: Refined, qualified_identity: str | None = None) -> ScalarSchema:
    if not refined.predicates:
        raise ConstraintSyntaxError("scalar schema requires explicit built-in refinement")
    if refined.base not in ("int", "string"):
        raise ConstraintSyntaxError("unsupported base type")
    identity = ""
    if refined.nominal:
        if qualified_identity is None or QUALIFIED.fullmatch(qualified_identity) is None:
            raise ConstraintSyntaxError("nominal schema requires a qualified identifier")
        identity = qualified_identity

    lo, hi, excluded = _bounds(refined.predicates)
    sorted_excluded = tuple(sorted(excluded))
    property_name = "value" if refined.base == "int" else "length"
    # Java List<Long>.toString() is a bracketed, comma-space joined list.
    holes = "[" + ", ".join(map(str, sorted_excluded)) + "]"
    canonical = (
        f"oreslang.refinement.v1\n{refined.base}\n{property_name}\n"
        f"{lo}\n{hi}\n{holes}\n{identity}"
    )
    return ScalarSchema(
        version=1,
        base=refined.base,
        property=property_name,
        minimum=lo,
        maximum=hi,
        excluded=sorted_excluded,
        nominal_identity=identity,
        fingerprint=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )
