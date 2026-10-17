"""Executable reference normalizer for the first Oreslang refinement subset.

This is a conformance oracle, NOT an Oreslang compiler or runtime.
Only string length and integer value comparisons are implemented.
Unknown syntax is rejected rather than ignored.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

OPS = {"eq": "==", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<=",
       "==": "==", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<="}
CMP = re.compile(r"\s*(length|value)\s*(eq|ne|gt|ge|lt|le|==|!=|>=|<=|>|<)\s*(-?\d+)\s*\Z")
DECL = re.compile(r"\s*type\s+(\w+)\s*=\s*(string|int)\s*(?:with\s+(.+))?\s*;\s*\Z", re.S)
NEW = re.compile(r"\s*define\s+newtype\s+(\w+)\s*\(\s*(string|int)\s*\)\s*(?:with\s+(.+))?\s*;\s*\Z", re.S)
ANN = re.compile(r"@(?P<name>Size|Length)\s*\((?P<args>[^()]*)\)\s*|@NotEmpty\s*")
ARG = re.compile(r"\s*(min|max|eq)\s*=\s*(\d+)\s*\Z")


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
        elif type(value) is not int:
            return False
        return all(p.holds(value) for p in self.predicates)

    def entails(self, other: "Refined") -> bool:
        if self.base != other.base or self.nominal or other.nominal:
            return False
        # Integer interval/equality entailment, including excluded points.
        lo, hi, excluded = _bounds(self.predicates)
        other_lo, other_hi, other_excluded = _bounds(other.predicates)
        if lo < other_lo or hi > other_hi:
            return False
        return all(not (lo <= n <= hi and n not in excluded) for n in other_excluded)


def _bounds(predicates: tuple[Predicate, ...]) -> tuple[float, float, frozenset[int]]:
    lo = 0 if predicates and predicates[0].property == "length" else float("-inf")
    hi = float("inf")
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
        seen: set[str] = set()
        for item in args.split(","):
            a = ARG.fullmatch(item)
            if not a or a.group(1) in seen:
                raise ConstraintSyntaxError("invalid or repeated annotation argument")
            key, bound = a.group(1), int(a.group(2))
            seen.add(key)
            annotations.append(Predicate("length", {"min": ">=", "max": "<=", "eq": "=="}[key], bound))
        if name == "Size" and "eq" in seen:
            raise ConstraintSyntaxError("@Size only supports min and max")
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
            predicates.append(Predicate(prop, OPS[op], int(bound)))
    if not predicates:
        raise ConstraintSyntaxError("missing refinement")
    expected = "length" if base == "string" else "value"
    if any(p.property != expected for p in predicates):
        raise ConstraintSyntaxError("property incompatible with base type")
    _bounds(tuple(predicates))
    return Refined(name, base, nominal, tuple(predicates))
