"""Canonical source-free bridge from refinements to Zorde scalar descriptors.

This module deliberately does NOT report backend implementation status. It
normalizes syntax through the same versioned scalar ABI fingerprint oracle used
by compiler conformance. Runtime backends either consume this descriptor shape
exactly or fail closed.
"""
from __future__ import annotations

from conformance.refinements.reference import Refined, ConstraintSyntaxError
from conformance.refinements.schema_fingerprint import descriptor


def to_zorde_descriptor(
    refined: Refined,
    qualified_identity: str | None = None,
) -> dict:
    schema = descriptor(refined, qualified_identity)
    result = {
        "schema": "zorde.scalar/v1",
        "version": schema.version,
        "base": schema.base,
        "property": schema.property,
        "minimum": schema.minimum,
        "maximum": schema.maximum,
        "excluded": list(schema.excluded),
        "nominal_identity": schema.nominal_identity or None,
        "fingerprint": schema.fingerprint,
    }
    if schema.base == "string":
        result["length_semantics"] = "unicode_scalar_values"
        result["runtime_requirements"] = [
            "valid_utf8_or_language_string",
            "unicode_scalar_count",
            "inclusive_signed_int64_interval",
            "sorted_unique_exclusions",
        ]
        if schema.version == 2:
            result["schema"] = "zorde.scalar/v2"
            result["charset"] = schema.charset
            result["unicode_version"] = schema.unicode_version or None
            result["runtime_requirements"].append("per_scalar_character_policy")
            if schema.charset in ("uppercase", "lowercase", "han"):
                # Matching a host runtime's native Unicode tables is
                # insufficient to claim the pinned Unicode 18 contract.
                result["runtime_requirements"].append("verified_ucd_18_0_0_tables")

    elif schema.base == "int":
        result["runtime_requirements"] = [
            "exact_signed_int64",
            "inclusive_signed_int64_interval",
            "sorted_unique_exclusions",
            "no_float_coercion",
        ]
    else:  # descriptor() is closed, retain a defensive fail-closed boundary.
        raise ConstraintSyntaxError("base type has no Zorde descriptor mapping")
    return result
