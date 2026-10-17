"""Reference mapping from normalized refinements to Zorde runtime descriptors.

This is a conformance oracle, not compiler/runtime code. Unsupported mappings
raise instead of silently dropping predicates.
"""
from __future__ import annotations

from conformance.refinements.reference import Refined, ConstraintSyntaxError, _bounds


def to_zorde_descriptor(refined: Refined) -> dict:
    # A forbidden value outside the normalized admissible interval has
    # no runtime effect. Never reject an equivalent schema for inert metadata.
    _, _, effective_exclusions = _bounds(refined.predicates, refined.base)
    if effective_exclusions:
        raise ConstraintSyntaxError("Zorde runtime exclusion rules are not implemented")
    if refined.base == "string":
        lo = 0
        hi = None
        excluded = []
        for predicate in refined.predicates:
            if predicate.property != "length":
                raise ConstraintSyntaxError("unsupported Zorde string property")
            n = predicate.bound
            if predicate.op == "==":
                lo = max(lo, n)
                hi = n if hi is None else min(hi, n)
            elif predicate.op == ">":
                lo = max(lo, n + 1)
            elif predicate.op == ">=":
                lo = max(lo, n)
            elif predicate.op == "<":
                value = n - 1
                hi = value if hi is None else min(hi, value)
            elif predicate.op == "<=":
                hi = n if hi is None else min(hi, n)
            elif predicate.op == "!=":
                excluded.append(n)
            else:
                raise ConstraintSyntaxError("unsupported Zorde comparator")
        if hi is not None and lo > hi:
            raise ConstraintSyntaxError("unsatisfiable Zorde descriptor")
        return {
            "schema": "zorde.refinement/v1",
            "base": "string",
            "nominal": refined.nominal,
            "nominal_id": refined.name if refined.nominal else None,
            "min_length": lo,
            "max_length": hi,
            "length_semantics": "unicode_scalar_values",
        }

    if refined.base == "int":
        lower = None
        lower_exclusive = False
        upper = None
        upper_exclusive = False

        def tighten_lower(bound: int, exclusive: bool) -> None:
            nonlocal lower, lower_exclusive
            if lower is None or bound > lower:
                lower = bound
                lower_exclusive = exclusive
            elif bound == lower:
                lower_exclusive = lower_exclusive or exclusive

        def tighten_upper(bound: int, exclusive: bool) -> None:
            nonlocal upper, upper_exclusive
            if upper is None or bound < upper:
                upper = bound
                upper_exclusive = exclusive
            elif bound == upper:
                upper_exclusive = upper_exclusive or exclusive

        for predicate in refined.predicates:
            if predicate.property != "value":
                raise ConstraintSyntaxError("unsupported Zorde numeric property")
            n = predicate.bound
            if predicate.op == "==":
                tighten_lower(n, False)
                tighten_upper(n, False)
            elif predicate.op == ">":
                tighten_lower(n, True)
            elif predicate.op == ">=":
                tighten_lower(n, False)
            elif predicate.op == "<":
                tighten_upper(n, True)
            elif predicate.op == "<=":
                tighten_upper(n, False)
            elif predicate.op == "!=":
                pass  # normalized away if excluded value is out of range
            else:
                raise ConstraintSyntaxError("unsupported Zorde comparator")
        return {
            "schema": "zorde.refinement/v1",
            "base": "int",
            "nominal": refined.nominal,
            "nominal_id": refined.name if refined.nominal else None,
            "runtime_supported": False,  # generic Zorde number checks use float
            "requires": "signed_int64_exact_validator",
            "min": lower,
            "min_exclusive": lower_exclusive,
            "max": upper,
            "max_exclusive": upper_exclusive,
        }

    raise ConstraintSyntaxError("base type has no Zorde descriptor mapping")
