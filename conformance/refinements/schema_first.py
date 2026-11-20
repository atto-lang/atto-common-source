"""Independent *restricted* Zorde schema-first source conformance oracle.

The public Oreslang design uses a compile-time constant builder expression:
    const PortSchema = Zorde.int().min(1).max(65535);
    type Port = Zorde.infer<PortSchema>;

This oracle does not run Oreslang, Java, callbacks, user functions or dynamic
schema code. It translates the closed scalar builder subset to the SAME
reference.parse() refinement model used by annotation/with expressions.
"""
from __future__ import annotations

import re
from conformance.refinements.reference import ConstraintSyntaxError, Refined, parse

_NAME = re.compile(r"[A-Za-z_][A-Za-z_0-9]*\Z")
_BASE = re.compile(r"Zorde\.(int|string)\(\)")
_STEP = re.compile(
    r"\.(minLength|maxLength|exactLength|excludeLength|"
    r"min|max|gt|lt|exact|exclude)\((-?[0-9]+(?:_[0-9]+)*)\)"
)
_OPERATORS = {
    "min": "gte", "max": "lte", "gt": "gt", "lt": "lt",
    "exact": "eq", "exclude": "ne",
    "minLength": "gte", "maxLength": "lte",
    "exactLength": "eq", "excludeLength": "ne",
}


def infer_schema(type_name: str, source: str) -> Refined:
    """Return the inferred structural type for a closed static builder chain."""
    if not _NAME.fullmatch(type_name):
        raise ConstraintSyntaxError("invalid statically inferred type name")
    m = _BASE.match(source)
    if not m:
        raise ConstraintSyntaxError("only compiler-owned Zorde.int/string builders are inferable")
    base = m.group(1)
    offset = m.end()
    clauses: list[str] = []
    while offset < len(source):
        step = _STEP.match(source, offset)
        if not step:
            raise ConstraintSyntaxError("unsupported or nonconstant Zorde schema operation")
        method, bound = step.groups()
        string_operation = method.endswith("Length")
        if string_operation != (base == "string"):
            raise ConstraintSyntaxError("wrong Zorde operation for scalar base")
        number = int(bound.replace("_", ""))
        if string_operation and number < 0:
            raise ConstraintSyntaxError("negative string length constraint")
        property_name = "length" if string_operation else "value"
        clauses.append(f"{property_name} {_OPERATORS[method]} {number}")
        offset = step.end()

    if clauses:
        source_alias = f"type {type_name} = {base} with {' and '.join(clauses)};"
        return parse(source_alias)
    # The empty primitive builder infers the base type; it must not
    # fabricate a refinement. Represent it with a semantically inert bound
    # only for the descriptor oracle, not as an Oreslang static refined type.
    identity_bound = "-9223372036854775808" if base == "int" else "0"
    prop = "value" if base == "int" else "length"
    return parse(f"type {type_name} = {base} with {prop} gte {identity_bound};")
