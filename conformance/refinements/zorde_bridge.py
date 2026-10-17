"""Reference mapping from normalized refinements to Zorde runtime descriptors.

This is a conformance oracle, not compiler/runtime code. Unsupported mappings
raise instead of silently dropping predicates.
"""
from __future__ import annotations

from conformance.refinements.reference import Refined, ConstraintSyntaxError


def to_zorde_descriptor(refined: Refined) -> dict:
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
        if excluded:
            raise ConstraintSyntaxError("Zorde runtime exclusion rules are not implemented")
        if hi is not None and lo > hi:
            raise ConstraintSyntaxError("unsatisfiable Zorde descriptor")
        return {
            "schema": "zorde.refinement/v1",
            "base": "string",
            "nominal": refined.nominal,
            "min_length": lo,
            "max_length": hi,
            "length_semantics": "unicode_scalar_values",
        }

    if refined.base == "int":
        lower = None
        lower_exclusive = False
        upper = None
        upper_exclusive = False
        for predicate in refined.predicates:
            if predicate.property != "value":
                raise ConstraintSyntaxError("unsupported Zorde numeric property")
            n = predicate.bound
            if predicate.op == "==":
                lower = n
                upper = n
                lower_exclusive = False
                upper_exclusive = False
            elif predicate.op == ">":
                if lower is None or n >= lower:
                    lower = n
                    lower_exclusive = True
            elif predicate.op == ">=":
                if lower is None or n > lower or (n == lower and lower_exclusive):
                    lower = n
                    lower_exclusive = False
            elif predicate.op == "<":
                if upper is None or n <= upper:
                    upper = n
                    upper_exclusive = True
            elif predicate.op == "<=":
                if upper is None or n < upper or (n == upper and upper_exclusive):
                    upper = n
                    upper_exclusive = False
            elif predicate.op == "!=":
                raise ConstraintSyntaxError("Zorde runtime exclusion rules are not implemented")
            else:
                raise ConstraintSyntaxError("unsupported Zorde comparator")
        return {
            "schema": "zorde.refinement/v1",
            "base": "int",
            "nominal": refined.nominal,
            "min": lower,
            "min_exclusive": lower_exclusive,
            "max": upper,
            "max_exclusive": upper_exclusive,
        }

    raise ConstraintSyntaxError("base type has no Zorde descriptor mapping")
