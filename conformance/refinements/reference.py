"""Closed-world exact scalar Oreslang refinement reference for Zorde conformance.

This is an independent source-free oracle, NOT compiler or runtime admission.
The Zorde bridge consumes its canonical predicates; never mint Valid<T,S> here.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

MIN_I64, MAX_I64 = -(1 << 63), (1 << 63) - 1


class ConstraintSyntaxError(ValueError):
    pass


@dataclass(frozen=True)
class Predicate:
    property: str
    op: str
    bound: int


@dataclass(frozen=True)
class Refined:
    name: str
    base: str
    nominal: bool
    predicates: tuple[Predicate, ...]
    charset: str = "any"

    def accepts(self, value: object) -> bool:
        if self.base == "int":
            if type(value) is not int or not (MIN_I64 <= value <= MAX_I64):
                return False
            actual = value
        elif self.base == "string":
            if not isinstance(value, str):
                return False
            if any(0xD800 <= ord(ch) <= 0xDFFF for ch in value):
                return False
            actual = len(value)
            if self.charset in ("uppercase", "lowercase"):
                # Unicode property profiles require version-pinned generated
                # UCD 18.0 tables. No host-dependent fallback is authoritative.
                raise ConstraintSyntaxError("Unicode uppercase/lowercase property tables not yet verified")
            if not _chars_accept(value, self.charset):
                return False
        else:
            return False
        return all(_test(actual, p) for p in self.predicates)

    def entails(self, other: "Refined") -> bool:
        if self.base != other.base:
            return False
        if self.charset != other.charset and other.charset != "any":
            return False
        if (self.nominal or other.nominal) and not (
            self.nominal and other.nominal and self.name == other.name
        ):
            return False
        low, high, excluded = _bounds(self.predicates, self.base)
        lo2, hi2, holes2 = _bounds(other.predicates, other.base)
        return (low >= lo2 and high <= hi2
                and all(x not in range(low, high + 1) or x in excluded
                        for x in holes2))


OPS = {
    "eq": "eq", "==": "eq", "ne": "ne", "!=": "ne",
    "gt": "gt", ">": "gt", "gte": "gte", ">=": "gte",
    "lt": "lt", "<": "lt", "lte": "lte", "<=": "lte",
}
INTEGER = r"-?[0-9]+(?:_[0-9]+)*"
IDENT = r"[A-Za-z_][A-Za-z_0-9]*"
DECL = re.compile(
    rf"\s*(?:(?:define\s+(?:pub\s+)?)|(?:pub\s+define\s+))?"
    rf"type\s+({IDENT})\s*=\s*(int|string)\b"
    rf"(?:\s+with\s+(.+?))?\s*;\s*\Z",
    re.DOTALL,
)
NEWTYPE = re.compile(
    rf"\s*define\s+newtype\s+({IDENT})\s*\(\s*(int|string)\s*\)"
    rf"(?:\s+with\s+(.+?))?\s*;\s*\Z",
    re.DOTALL,
)
COMPARISON = re.compile(
    rf"\s*(length|value)\s*(eq|ne|gte|lte|gt|lt|==|!=|>=|<=|>|<)"
    rf"\s*({INTEGER})\s*\Z"
)
SHORTHAND = re.compile(rf"\s*(min|max)\s+({INTEGER})\s*\Z")
LENGTH_SHORTHAND = re.compile(rf"\s*(min_length|max_length)\s+({INTEGER})\s*\Z")
CHAR_POLICY = re.compile(
    r"\s*chars\s+(ascii_letters|ascii_uppercase|ascii_lowercase|uppercase|lowercase|han)\s*\Z"
)
ANNOTATION = re.compile(
    rf"\s*@([A-Za-z_][A-Za-z_0-9]*)(?:\s*\(([^()]*)\))?"
)
POS_ARG = re.compile(rf"\s*({INTEGER})\s*\Z")
NAMED_ARG = re.compile(rf"\s*(min|max|eq)\s*=\s*({INTEGER})\s*\Z")


# Exact Unicode 18.0.0 Script=Han property from Scripts.txt, 2026-06-29.
# Source: https://www.unicode.org/Public/18.0.0/ucd/Scripts.txt
# 25 disjoint ranges; 103352 code points. Not a Chinese language classifier.
HAN_UCD_18 = (
    (11904, 11929),
    (11931, 12019),
    (12032, 12245),
    (12293, 12293),
    (12295, 12295),
    (12321, 12329),
    (12344, 12346),
    (12347, 12347),
    (13312, 19903),
    (19968, 40959),
    (63744, 64109),
    (64112, 64217),
    (94178, 94178),
    (94179, 94179),
    (94192, 94193),
    (94194, 94195),
    (94196, 94198),
    (131072, 173791),
    (173824, 178206),
    (178208, 183981),
    (183984, 191456),
    (191472, 192093),
    (194560, 195101),
    (196608, 201546),
    (201552, 210041),
)


def _han18(codepoint: int) -> bool:
    return any(start <= codepoint <= stop for start, stop in HAN_UCD_18)


def _chars_accept(value: str, charset: str) -> bool:
    if charset == "any":
        return True
    if charset == "ascii_letters":
        return all(("A" <= ch <= "Z") or ("a" <= ch <= "z") for ch in value)
    if charset == "ascii_uppercase":
        return all("A" <= ch <= "Z" for ch in value)
    if charset == "ascii_lowercase":
        return all("a" <= ch <= "z" for ch in value)
    if charset == "han":
        return all(_han18(ord(ch)) for ch in value)
    raise ConstraintSyntaxError("unverified Unicode uppercase/lowercase policy")


def _number(raw: str) -> int:
    if re.fullmatch(INTEGER, raw) is None:
        raise ConstraintSyntaxError("invalid integer constant")
    number = int(raw.replace("_", ""))
    if not MIN_I64 <= number <= MAX_I64:
        raise ConstraintSyntaxError("refinement bound outside signed int64")
    return number


def _test(actual: int, predicate: Predicate) -> bool:
    n = predicate.bound
    return {
        "eq": actual == n, "ne": actual != n,
        "gt": actual > n, "gte": actual >= n,
        "lt": actual < n, "lte": actual <= n,
    }[predicate.op]


def _bounds(predicates: tuple[Predicate, ...], base: str) -> tuple[int, int, set[int]]:
    if base not in ("int", "string"):
        raise ConstraintSyntaxError("unsupported base")
    low = 0 if base == "string" else MIN_I64
    high = MAX_I64
    holes: set[int] = set()
    for p in predicates:
        if p.property != ("value" if base == "int" else "length"):
            raise ConstraintSyntaxError("constraint property incompatible with base")
        n = p.bound
        if not MIN_I64 <= n <= MAX_I64:
            raise ConstraintSyntaxError("refinement bound outside signed int64")
        if p.op == "eq":
            low, high = max(low, n), min(high, n)
        elif p.op == "gte":
            low = max(low, n)
        elif p.op == "gt":
            low = max(low, n + 1)
        elif p.op == "lte":
            high = min(high, n)
        elif p.op == "lt":
            high = min(high, n - 1)
        elif p.op == "ne":
            holes.add(n)
    if low > high:
        raise ConstraintSyntaxError("unsatisfiable refinement interval")
    holes = {n for n in holes if low <= n <= high}
    if len(holes) >= high - low + 1:
        raise ConstraintSyntaxError("unsatisfiable excluded interval")
    return low, high, holes


def _annotations(head: str) -> tuple[list[tuple[str, object]], str]:
    result: list[tuple[str, object]] = []
    while head.lstrip().startswith("@"):
        m = ANNOTATION.match(head)
        if not m:
            raise ConstraintSyntaxError("invalid constraint annotation")
        name, raw = m.groups()
        if name == "NotEmpty":
            if raw is not None:
                raise ConstraintSyntaxError("@NotEmpty takes no arguments")
            result.append((name, None))
        elif name in ("Min", "Max", "MinLength", "MaxLength"):
            if raw is None or POS_ARG.fullmatch(raw) is None:
                raise ConstraintSyntaxError("annotation requires one integer bound")
            result.append((name, _number(raw.strip())))
        elif name in ("Size", "Length", "Range"):
            if raw is None or not raw.strip():
                raise ConstraintSyntaxError("empty constraint annotation")
            values: dict[str, int] = {}
            for item in raw.split(","):
                arg = NAMED_ARG.fullmatch(item)
                if not arg or arg[1] in values:
                    raise ConstraintSyntaxError("invalid/repeated named annotation argument")
                values[arg[1]] = _number(arg[2])
            allowed = {"min", "max", "eq"} if name == "Length" else {"min", "max"}
            if not values.keys() <= allowed:
                raise ConstraintSyntaxError("unsupported annotation argument")
            result.append((name, values))
        else:
            raise ConstraintSyntaxError("unknown constraint annotation")
        head = head[m.end():]
    return result, head


def parse(source: str) -> Refined:
    if not isinstance(source, str) or len(source) > 32768:
        raise ConstraintSyntaxError("invalid/oversized refinement source")
    annotations, body = _annotations(source)
    m = DECL.fullmatch(body)
    nominal = False
    if m is None:
        m = NEWTYPE.fullmatch(body)
        nominal = True
    if m is None:
        raise ConstraintSyntaxError("unsupported refinement declaration")
    name, base, with_clause = m.groups()
    predicates: list[Predicate] = []
    charset = "any"
    expected = "value" if base == "int" else "length"
    for ann, args in annotations:
        if ann == "NotEmpty":
            if base != "string":
                raise ConstraintSyntaxError("@NotEmpty only supports string")
            predicates.append(Predicate("length", "gt", 0))
        elif ann in ("MinLength", "MaxLength", "Min", "Max"):
            wanted_base = "string" if ann.endswith("Length") else "int"
            if base != wanted_base:
                raise ConstraintSyntaxError("annotation base mismatch")
            assert isinstance(args, int)
            predicates.append(Predicate(expected,
                                        "gte" if ann.startswith("Min") else "lte", args))
        elif ann in ("Size", "Length", "Range"):
            wanted_base = "int" if ann == "Range" else "string"
            if base != wanted_base:
                raise ConstraintSyntaxError("annotation base mismatch")
            assert isinstance(args, dict)
            for key, value in args.items():
                predicates.append(Predicate(expected,
                                            {"min": "gte", "max": "lte", "eq": "eq"}[key],
                                            value))
    if with_clause is not None:
        for clause in re.split(r"\s+and\s+", with_clause.strip()):
            c = COMPARISON.fullmatch(clause)
            if c is not None:
                prop, op, number = c.groups()
                predicates.append(Predicate(prop, OPS[op], _number(number)))
                continue
            c = SHORTHAND.fullmatch(clause)
            if c is not None and base == "int":
                boundary, number = c.groups()
                predicates.append(Predicate("value",
                                            "gte" if boundary == "min" else "lte",
                                            _number(number)))
                continue
            c = LENGTH_SHORTHAND.fullmatch(clause)
            if c is not None and base == "string":
                boundary, number = c.groups()
                predicates.append(Predicate("length",
                                            "gte" if boundary == "min_length" else "lte",
                                            _number(number)))
                continue
            c = CHAR_POLICY.fullmatch(clause)
            if c is not None and base == "string":
                if charset != "any":
                    raise ConstraintSyntaxError("duplicate character policy")
                charset = c[1]
                continue
            raise ConstraintSyntaxError("unsupported with expression")
    if not predicates and not nominal and charset == "any":
        raise ConstraintSyntaxError("missing refinement")
    frozen = tuple(predicates)
    _bounds(frozen, base)
    return Refined(name, base, nominal, frozen, charset)
