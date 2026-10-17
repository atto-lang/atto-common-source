"""Executable reference normalizer for the first Oreslang refinement subset.

This is a conformance oracle, NOT an Oreslang compiler or runtime.
Only string length and integer value comparisons are implemented.
Unknown syntax is rejected rather than ignored.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

MIN_I64 = -(1 << 63)
MAX_I64 = (1 << 63) - 1

OPS = {"eq": "==", "ne": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
       "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<="}
CMP = re.compile(r"\s*(length|value)\s*(eq|ne|gte|lte|gt|lt|==|!=|>=|<=|>|<)\s*(-?[0-9]+(?:_[0-9]+)*)\s*\Z")
DECL = re.compile(r"\s*type\s+([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(string|int)\s*(?:with\s+(.+))?\s*;\s*\Z", re.S)
NEW = re.compile(r"\s*define\s+newtype\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(\s*(string|int)\s*\)\s*(?:with\s+(.+))?\s*;\s*\Z", re.S)
ANN = re.compile(r"@(?P<name>Size|Length|MinLength|MaxLength|Min|Max|Range)\s*\((?P<args>[^()]*)\)\s*|@NotEmpty\s*")
ARG = re.compile(r"\s*(min|max|eq)\s*=\s*(-?[0-9]+(?:_[0-9]+)*)\s*\Z")
POSITIONAL = re.compile(r"\s*(-?[0-9]+(?:_[0-9]+)*)\s*\Z")


class ConstraintSyntaxError(ValueError):
    pass


@dataclass(frozen=True)
class Predicate:
    property: str
    op: str
    bound: int

    def holds(self, value: object) -> bool:
        actual = len(value) if self.property == "length" else value
        return {
            "==": lambda: actual == self.bound,
            "!=": lambda: actual != self.bound,
            ">": lambda: actual > self.bound,
            ">=": lambda: actual >= self.bound,
            "<": lambda: actual < self.bound,
            "<=": lambda: actual <= self.bound,
        }[self.op]()


@dataclass(frozen=True)
class Refined:
    name: str
    base: str
    nominal: bool
    predicates: tuple[Predicate, ...]

    def accepts(self, value: object) -> bool:
        if self.base == "string":
            if not isinstance(value, str):
                return False
            # A Unicode scalar sequence never contains an unpaired surrogate.
            # Python str can contain these even though valid Oreslang strings cannot.
            if any(0xD800 <= ord(ch) <= 0xDFFF for ch in value):
                return False
        elif type(value) is not int or not MIN_I64 <= value <= MAX_I64:
            return False
        return all(p.holds(value) for p in self.predicates)

    def entails(self, other: "Refined") -> bool:
        if self.base != other.base:
            return False
        # A nominal type cannot be silently erased or converted to another ID.
        if self.nominal or other.nominal:
            if not (self.nominal and other.nominal and self.name == other.name):
                return False
        lo, hi, excluded = _bounds(self.predicates)
        other_lo, other_hi, other_excluded = _bounds(other.predicates)
        if lo < other_lo or hi > other_hi:
            return False
        return all(not (lo <= n <= hi and n not in excluded) for n in other_excluded)


def _bounds(predicates: tuple[Predicate, ...]) -> tuple[float, float, frozenset[int]]:
    lo = 0 if predicates and predicates[0].property == "length" else MIN_I64
    hi = MAX_I64
    excluded = set()
    for p in predicates:
        n = p.bound
        if p.op == "==":
            lo, hi = max(lo, n), min(hi, n)
        elif p.op == "!=":
            excluded.add(n)
        elif p.op == ">":
            lo = max(lo, n + 1)
        elif p.op == ">=":
            lo = max(lo, n)
        elif p.op == "<":
            hi = min(hi, n - 1)
        elif p.op == "<=":
            hi = min(hi, n)
    if lo > hi or (lo == hi and lo in excluded):
        raise ConstraintSyntaxError("unsatisfiable refinement")
    # A finite excluded set can exhaust only a domain with at most that
    # many members. Avoid iterating huge ranges or allocating giant lists.
    if hi - lo + 1 <= len(excluded) and all(
        value in excluded for value in range(lo, hi + 1)
    ):
        raise ConstraintSyntaxError("unsatisfiable excluded interval")
    return lo, hi, frozenset(excluded)


def parse(source: str) -> Refined:
    """Parse one restricted declaration; reject all unimplemented syntax."""
    annotations: list[Predicate] = []
    source = source.strip()
    while source.startswith("@"):
        match = ANN.match(source)
        if not match:
            raise ConstraintSyntaxError("unsupported annotation")
        source = source[match.end():].lstrip()
        name = match.group("name")
        if name is None:
            annotations.append(Predicate("length", ">", 0))
            continue
        args = match.group("args")
        if not args.strip():
            raise ConstraintSyntaxError("empty constraint annotation")
        if name in ("MinLength", "MaxLength", "Min", "Max"):
            scalar = POSITIONAL.fullmatch(args)
            if not scalar:
                raise ConstraintSyntaxError("expected exactly one positional integer bound")
            bound = int(scalar.group(1).replace("_", ""))
            is_length = name in ("MinLength", "MaxLength")
            if is_length and bound < 0:
                raise ConstraintSyntaxError("negative annotation length")
            annotations.append(Predicate(
                "length" if is_length else "value",
                ">=" if name in ("MinLength", "Min") else "<=", bound,
            ))
            continue
        seen: set[str] = set()
        for item in args.split(","):
            a = ARG.fullmatch(item)
            if not a or a.group(1) in seen:
                raise ConstraintSyntaxError("invalid or repeated annotation argument")
            key, bound = a.group(1), int(a.group(2).replace("_", ""))
            if (name in ("Size", "Length") and bound < 0):
                raise ConstraintSyntaxError("negative annotation length")
            if name in ("Size", "Range") and key == "eq":
                raise ConstraintSyntaxError("annotation only supports min and max")
            seen.add(key)
            annotations.append(Predicate(
                "value" if name == "Range" else "length",
                {"min": ">=", "max": "<=", "eq": "=="}[key], bound,
            ))
    nominal = False
    m = DECL.fullmatch(source)
    if m is None:
        m = NEW.fullmatch(source)
        nominal = True
    if m is None:
        raise ConstraintSyntaxError("unsupported declaration")
    name, base, clause = m.groups()
    predicates = list(annotations)
    if clause:
        for term in re.split(r"\s+and\s+", clause.strip()):
            c = CMP.fullmatch(term)
            if c is None:
                raise ConstraintSyntaxError("unsupported with expression")
            prop, op, bound = c.groups()
            predicates.append(Predicate(prop, OPS[op], int(bound.replace("_", ""))))
    if not predicates:
        raise ConstraintSyntaxError("missing refinement")
    expected = "length" if base == "string" else "value"
    if any(p.property != expected for p in predicates):
        raise ConstraintSyntaxError("property incompatible with base type")
    if any(not MIN_I64 <= p.bound <= MAX_I64 for p in predicates):
        raise ConstraintSyntaxError("refinement bound outside signed int64")
    _bounds(tuple(predicates))
    return Refined(name, base, nominal, tuple(predicates))
