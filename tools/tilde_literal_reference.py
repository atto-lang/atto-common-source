#!/usr/bin/env python3
"""Small *host-side syntax reference*, NOT an AttoLang compiler or guest evaluator.

Recognizes only the v2 tilde aggregate literal and a shallow match-arm reference
subset. Does NOT assert semantic typing, runtime ownership, exhaustiveness,
effect safety, codegen, or five-backend conformance.
"""
from __future__ import annotations

from dataclasses import dataclass
import re


class SyntaxRejection(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    value: str
    kind: str
    start: int
    end: int


_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
_NUMBER = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_PUNCT = ("...", "=>", "->", "(", ")", "[", "]", "{", "}", "<", ">",
          ":", ",", ".", ";", "~", "=", "+", "-", "!", "?", "|", "*", "/")


def lex(source: str) -> list[Token]:
    if len(source.encode("utf-8", "surrogatepass")) > 65536 or "\x00" in source:
        raise SyntaxRejection("source exceeds bounds or contains NUL")
    tokens: list[Token] = []
    i = 0
    while i < len(source):
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if source.startswith("//", i):
            e = source.find("\n", i + 2)
            i = len(source) if e < 0 else e
            continue
        if source.startswith("/*", i):
            e = source.find("*/", i + 2)
            if e < 0:
                raise SyntaxRejection("unterminated block comment")
            i = e + 2
            continue
        if ch in ("'", '"'):
            quote = ch
            start = i
            i += 1
            while i < len(source):
                c = source[i]
                if c == "\\":
                    if i + 1 >= len(source) or source[i + 1] in ("\r", "\n"):
                        raise SyntaxRejection("invalid string escape")
                    i += 2
                    continue
                if c == quote:
                    i += 1
                    tokens.append(Token(source[start:i], "string", start, i))
                    break
                if c in ("\r", "\n") or 0xD800 <= ord(c) <= 0xDFFF:
                    raise SyntaxRejection("newline/surrogate in quoted literal")
                i += 1
            else:
                raise SyntaxRejection("unterminated quoted literal")
            continue
        if ch == "#":
            start = i
            m = _IDENTIFIER.match(source, i + 1)
            if not m:
                raise SyntaxRejection("bad Symbol spelling")
            i = m.end()
            tokens.append(Token(source[start:i], "symbol", start, i))
            continue
        m = _IDENTIFIER.match(source, i)
        if m:
            tokens.append(Token(m.group(), "name", i, m.end()))
            i = m.end()
            continue
        m = _NUMBER.match(source, i)
        if m:
            tokens.append(Token(m.group(), "number", i, m.end()))
            i = m.end()
            continue
        found = next((p for p in _PUNCT if source.startswith(p, i)), None)
        if found is None:
            raise SyntaxRejection(f"unknown token at offset {i}")
        tokens.append(Token(found, "punct", i, i + len(found)))
        i += len(found)
    return tokens


def _segments(tokens: list[Token]) -> list[list[Token]]:
    """Split top-level comma-separated items without splitting nested values."""
    items: list[list[Token]] = []
    item: list[Token] = []
    brackets = {"(": ")", "[": "]", "{": "}"}
    stack: list[str] = []
    for t in tokens:
        if t.value in brackets:
            stack.append(brackets[t.value])
        elif t.value in (")", "]", "}"):
            if not stack or stack.pop() != t.value:
                raise SyntaxRejection("unbalanced nested expression")
        if t.value == "," and not stack:
            if not item:
                raise SyntaxRejection("empty comma-separated item")
            items.append(item)
            item = []
        else:
            item.append(t)
    if stack:
        raise SyntaxRejection("unclosed nested expression")
    if item:
        items.append(item)
    return items


def _find_sep(tokens: list[Token]) -> tuple[int, str] | None:
    stack: list[str] = []
    brackets = {"(": ")", "[": "]", "{": "}"}
    found: list[tuple[int, str]] = []
    for i, t in enumerate(tokens):
        if t.value in brackets:
            stack.append(brackets[t.value])
        elif t.value in (")", "]", "}"):
            if not stack or stack.pop() != t.value:
                raise SyntaxRejection("unbalanced expression")
        elif not stack and t.value in (":", "=>"):
            found.append((i, t.value))
    if len(found) > 1:
        raise SyntaxRejection("multiple or mixed entry separators")
    return found[0] if found else None


def _slice_quoted_key(raw: str) -> str:
    # Backslash escapes are checked for syntax, and field identity is retained.
    # This reference deliberately does not normalize Unicode or prove codec rules.
    return raw


def _validate_nested(tokens: list[Token]) -> int:
    """Check nested tilde tokens anywhere in a bounded expression."""
    count = 0
    i = 0
    while i < len(tokens):
        if tokens[i].value == "~":
            _, i = _literal_at(tokens, i)
            count += 1
        else:
            i += 1
    return count


def _type_args(tokens: list[Token], i: int) -> tuple[list[str], int]:
    if i >= len(tokens) or tokens[i].value != "<":
        return [], i
    i += 1
    depth = 1
    segments: list[list[str]] = [[]]
    while i < len(tokens):
        t = tokens[i]
        if t.value == "<":
            depth += 1
            segments[-1].append(t.value)
        elif t.value == ">":
            depth -= 1
            if depth == 0:
                i += 1
                break
            segments[-1].append(t.value)
        elif t.value == "," and depth == 1:
            segments.append([])
        else:
            segments[-1].append(t.value)
        i += 1
    if depth or len(segments) != 2 or any(not x for x in segments):
        raise SyntaxRejection("map requires exactly two explicit generic types")
    for ts in segments:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*(?:[<>,A-Za-z_0-9]*)", "".join(ts)):
            raise SyntaxRejection("bad generic type syntax")
    return ["".join(x) for x in segments], i


def _literal_at(tokens: list[Token], index: int, *, pattern: bool = False) -> tuple[dict, int]:
    if index >= len(tokens) or tokens[index].value != "~":
        raise SyntaxRejection("tilde literal required")
    i = index + 1
    explicit: str | None = None
    generic_types: list[str] = []
    if i < len(tokens) and tokens[i].kind == "name" and tokens[i].start == tokens[index].end:
        if tokens[i].value not in ("map", "record"):
            raise SyntaxRejection("unsupported tilde literal kind")
        explicit = tokens[i].value
        i += 1
    if i < len(tokens) and tokens[i].value == "<":
        if explicit != "map" or pattern:
            raise SyntaxRejection("generic args only for map constructor")
        generic_types, i = _type_args(tokens, i)
    if i >= len(tokens) or tokens[i].value != "(":
        raise SyntaxRejection("missing literal opening parenthesis")
    i += 1
    start = i
    depth = 0
    while i < len(tokens):
        val = tokens[i].value
        if val == "(":
            depth += 1
        elif val == ")":
            if depth == 0:
                break
            depth -= 1
        i += 1
    if i >= len(tokens):
        raise SyntaxRejection("missing literal closing parenthesis")
    interior = tokens[start:i]
    end = i + 1
    if not interior and not explicit:
        raise SyntaxRejection("bare ~() is ambiguous")
    parts = _segments(interior)
    if interior and interior[-1].value == ",":
        pass  # optional trailing comma
    if len(parts) > 64:
        raise SyntaxRejection("reference literal exceeds 64 items")
    entries: list[dict] = []
    seen_fields: set[str] = set()
    seen_map_constant_keys: set[tuple[str, str]] = set()
    derived_kind = explicit
    nested_count = 0
    for item in parts:
        if item[0].value == "...":
            if pattern:
                raise SyntaxRejection("spread not permitted in a map or record pattern")
            if not explicit:
                # Record spreads can disambiguate only when another named field exists;
                # the required context is established after the complete initializer.
                pass
            if len(item) == 1:
                raise SyntaxRejection("empty spread")
            nested_count += _validate_nested(item[1:])
            entries.append({"kind": "spread"})
            continue
        delim = _find_sep(item)
        if delim is None:
            raise SyntaxRejection("entry requires : or =>")
        at, sep = delim
        if at == 0 or at == len(item) - 1:
            raise SyntaxRejection("entry lacks key or value")
        kind = "record" if sep == ":" else "map"
        if derived_kind is None:
            derived_kind = kind
        if derived_kind != kind:
            raise SyntaxRejection("mixed map and record separators")
        key_tokens, val_tokens = item[:at], item[at + 1:]
        if kind == "record":
            if len(key_tokens) != 1 or key_tokens[0].kind not in ("name", "string"):
                raise SyntaxRejection("record field must be static identifier/string")
            field = _slice_quoted_key(key_tokens[0].value)
            if field in seen_fields:
                raise SyntaxRejection("duplicate record field")
            seen_fields.add(field)
        else:
            if pattern and (len(key_tokens) != 1 or key_tokens[0].kind not in
                            ("number", "string", "symbol")):
                raise SyntaxRejection("map pattern keys must be constant literals")
            if len(key_tokens) == 1 and key_tokens[0].kind in ("number", "string", "symbol"):
                identity = (key_tokens[0].kind, key_tokens[0].value)
                if identity in seen_map_constant_keys:
                    raise SyntaxRejection("duplicate map constant key")
                seen_map_constant_keys.add(identity)
            nested_count += _validate_nested(key_tokens)
        nested_count += _validate_nested(val_tokens)
        entries.append({"kind": kind, "key": "".join(x.value for x in key_tokens)})
    if derived_kind is None:
        if not explicit:
            raise SyntaxRejection("cannot infer kind from spreads alone")
        derived_kind = explicit
    if derived_kind == "map" and explicit is None and any(e["kind"] == "spread" for e in entries):
        raise SyntaxRejection("inferred map spread requires ~map")
    if derived_kind == "map" and explicit is None and not entries:
        raise SyntaxRejection("bare empty map")
    if pattern:
        if derived_kind == "map" and (not explicit or not entries):
            raise SyntaxRejection("map pattern must be explicit and nonempty")
        if not entries:
            raise SyntaxRejection("empty record pattern is catch-all; use default")
    return {"kind": derived_kind, "explicit": explicit or "inferred",
            "generic_types": generic_types, "item_count": len(entries),
            "spread_count": sum(e["kind"] == "spread" for e in entries),
            "nested_count": nested_count, "requires_expected_type":
                derived_kind == "map" and not entries and not generic_types}, end


def parse_literal(source: str, *, pattern: bool = False) -> dict:
    tokens = lex(source)
    if not tokens:
        raise SyntaxRejection("empty source")
    parsed, end = _literal_at(tokens, 0, pattern=pattern)
    if end != len(tokens):
        raise SyntaxRejection("trailing tokens after literal")
    return parsed


def parse_match(source: str) -> dict:
    """Reference recognizer for simple match-over-on/default snippets.

    Statement bodies are opaque, with balanced delimiters. No scope, purity,
    exhaustiveness, ownership, or scrutinee type checking is attempted.
    """
    toks = lex(source)
    if not toks or toks[0].value != "match":
        raise SyntaxRejection("match required")
    i = 1
    ordered = i < len(toks) and toks[i].value == "first"
    if ordered:
        i += 1
    if i < len(toks) and toks[i].value == "<":
        _, i = _type_args_for_match(toks, i)
    start = i
    while i < len(toks) and toks[i].value != "over":
        i += 1
    if i == start or i == len(toks):
        raise SyntaxRejection("match requires scrutinee and over")
    _validate_nested(toks[start:i])
    i += 1
    arm_count = 0
    has_default = False
    structural_arms = 0
    map_arms = 0
    while i < len(toks):
        tag = toks[i].value
        if tag == "end":
            if i != len(toks) - 1:
                raise SyntaxRejection("trailing tokens after match end")
            if arm_count == 0 and not has_default:
                raise SyntaxRejection("match must contain an arm")
            return {"kind": "match", "ordered": ordered, "arm_count": arm_count,
                    "has_default": has_default, "structural_arms": structural_arms,
                    "map_arms": map_arms}
        if tag not in ("on", "default"):
            raise SyntaxRejection("each match arm must start with on or default")
        if has_default:
            raise SyntaxRejection("default must be last")
        i += 1
        if tag == "on":
            if i < len(toks) and toks[i].value == "default":
                raise SyntaxRejection("default has no on prefix")
            structural = i < len(toks) and toks[i].value == "structural"
            if structural:
                structural_arms += 1
                i += 1
            pstart = i
            while i < len(toks) and toks[i].value not in ("when", "->", "end", "default"):
                i += 1
            if i == pstart:
                raise SyntaxRejection("empty on pattern")
            pattern = toks[pstart:i]
            if pattern[0].value == "~":
                parsed, stop = _literal_at(pattern, 0, pattern=True)
                if stop != len(pattern):
                    raise SyntaxRejection("unexpected trailing pattern tokens")
                if structural and parsed["kind"] != "record":
                    raise SyntaxRejection("structural is for readonly record shape views")
                if parsed["kind"] == "map":
                    map_arms += 1
            elif structural:
                raise SyntaxRejection("this reference supports structural ~record patterns only")
            if i < len(toks) and toks[i].value == "when":
                i += 1
                guard_start = i
                while i < len(toks) and toks[i].value not in ("->", "end"):
                    i += 1
                if i == guard_start:
                    raise SyntaxRejection("empty when guard")
            arm_count += 1
        else:
            has_default = True
        if i >= len(toks) or toks[i].value != "->":
            raise SyntaxRejection("match arm missing ->")
        i += 1
        body_start = i
        brackets = {"(": ")", "[": "]", "{": "}"}
        stack: list[str] = []
        while i < len(toks):
            t = toks[i]
            if not stack and t.value in ("on", "default", "end"):
                break
            if t.value in brackets:
                stack.append(brackets[t.value])
            elif t.value in (")", "]", "}"):
                if not stack or stack.pop() != t.value:
                    raise SyntaxRejection("unbalanced match body")
            i += 1
        if stack or body_start == i:
            raise SyntaxRejection("empty or unbalanced match arm body")
    raise SyntaxRejection("unterminated match")


def _type_args_for_match(tokens: list[Token], i: int) -> tuple[str, int]:
    # Match<T>, unlike Map<K,V>, accepts one type.
    depth = 0
    result: list[str] = []
    while i < len(tokens):
        val = tokens[i].value
        if val == "<":
            depth += 1
            if depth > 1:
                result.append(val)
        elif val == ">":
            depth -= 1
            if depth == 0:
                i += 1
                break
            result.append(val)
        else:
            result.append(val)
        i += 1
    if depth != 0 or not result or "," in result and len(result) < 3:
        raise SyntaxRejection("invalid typed match")
    return "".join(result), i
