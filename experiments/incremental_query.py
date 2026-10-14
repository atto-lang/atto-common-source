"""Experimental, backend-neutral Oreslang incremental query model.

NOT a language parser, compiler, or production cache. This module exercises
red/green dependency tracking, negative lookups, specialization boundaries,
and backend-independent vs backend-specific query identities.
No security-sensitive compiler proof should consume this model as authority.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any


class QueryCycleError(RuntimeError):
    """An invalid cycle was detected in the declared computation graph."""


@dataclass(frozen=True)
class QueryResult:
    value: Any
    fingerprint: str
    dependencies: tuple[tuple[tuple[str, str], str], ...]


class QueryEngine:
    """Minimal red/green, in-memory reference query engine.

    This demonstrates key semantic invalidation edges, rather than providing a
    parser, stable AST/IR format, or validated borrow checker. Inputs must be
    canonical JSON values. Do not use this as a trust boundary.
    """

    def __init__(self, schema_version: str = "incremental-demo-v1") -> None:
        self.schema_version = schema_version
        self.inputs: dict[str, Any] = {}
        self.cache: dict[tuple[str, str], QueryResult] = {}
        self.computations: Counter[tuple[str, str]] = Counter()
        self._frames: list[dict[tuple[str, str], str]] = []
        self._active: set[tuple[str, str]] = set()

    def _digest(self, value: Any) -> str:
        encoded = json.dumps(
            {"schema": self.schema_version, "result": value},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        return sha256(encoded).hexdigest()

    def set_input(self, name: str, value: Any) -> bool:
        """Update a source fact. Return True only for meaningful changes."""
        self._digest(value)  # Fail closed on unserializable/nonfinite input.
        previous = self.inputs.get(name, _ABSENT)
        if previous is not _ABSENT and self._digest(previous) == self._digest(value):
            return False
        self.inputs[name] = value
        self.cache.pop(("input", name), None)
        return True

    def result(self, kind: str, symbol: str) -> QueryResult:
        """Evaluate a query and return the value plus its semantic fingerprint."""
        if not isinstance(kind, str) or not isinstance(symbol, str):
            raise TypeError("Query kind and identity must be strings")
        return self._evaluate((kind, symbol))

    def use(self, kind: str, symbol: str) -> Any:
        """Record a direct dependency while computing a parent query."""
        key = (kind, symbol)
        child = self._evaluate(key)
        if self._frames:
            self._frames[-1][key] = child.fingerprint
        return child.value

    def _evaluate(self, key: tuple[str, str]) -> QueryResult:
        if key in self._active:
            raise QueryCycleError("Cyclic query: " + repr(key))
        self._active.add(key)
        try:
            cached = self.cache.get(key)
            if cached is not None:
                # Validation uses _evaluate, not use: we must not accidentally
                # record transitive dependencies in the caller's query frame.
                green = True
                for dep, fingerprint in cached.dependencies:
                    if self._evaluate(dep).fingerprint != fingerprint:
                        green = False
                        break
                if green:
                    return cached

            self._frames.append({})
            try:
                value = self._compute(*key)
                deps = tuple(sorted(self._frames[-1].items()))
                result = QueryResult(value, self._digest(value), deps)
            finally:
                self._frames.pop()
            self.computations[key] += 1
            self.cache[key] = result
            return result
        finally:
            self._active.remove(key)

    def _compute(self, kind: str, identity: str) -> Any:
        if kind == "input":
            if identity not in self.inputs:
                return {"absent": identity}
            return self.inputs[identity]
        if kind == "lookup":
            names = self.use("input", "registry")
            if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
                raise ValueError("Registry must be a list of symbol names")
            if len(names) != len(set(names)):
                raise ValueError("Duplicate symbols in registry")
            return identity in names
        if kind == "interface":
            if not self.use("lookup", identity):
                return {"missing": identity}
            return {
                "signature": self.use("input", "signature:" + identity),
                "effects": self.use("input", "effects:" + identity),
            }
        if kind == "typed":
            own_interface = self.use("interface", identity)
            body = self.use("input", "body:" + identity)
            calls = self.use("input", "calls:" + identity)
            if not isinstance(calls, list) or not all(isinstance(n, str) for n in calls):
                raise ValueError("Call list must be a list of symbols")
            dependencies = [(name, self.use("interface", name)) for name in calls]
            valid = (
                "missing" not in own_interface
                and all("missing" not in iface for _, iface in dependencies)
            )
            return {
                "valid": valid,
                "body": body,
                "own_interface": own_interface,
                "callee_interfaces": dependencies,
            }
        if kind == "mir":
            typed = self.use("typed", identity)
            return {"verified": typed["valid"], "typed": typed}
        if kind == "object":
            # Backend and function are split with a NUL (for prototype only).
            target, _, function = identity.partition("\0")
            if not target or not function:
                raise ValueError("Object queries require target and function")
            mir = self.use("mir", function)
            if not mir["verified"]:
                raise ValueError("Unresolved or invalid function " + function)
            inlines = self.use("input", "inlines:" + function)
            if not isinstance(inlines, list) or not all(isinstance(n, str) for n in inlines):
                raise ValueError("Inlining dependencies must be a list of symbols")
            embedded = [(name, self.use("mir", name)) for name in inlines]
            if any(not inline["verified"] for _, inline in embedded):
                raise ValueError("Invalid inline dependency")
            return {
                "target": target,
                "toolchain": self.use("input", "toolchain:" + target),
                "mir": mir,
                "inlines": embedded,
            }
        if kind == "link":
            symbols = self.use("input", "registry")
            if not isinstance(symbols, list):
                raise ValueError("Registry must be a list")
            artifacts = [
                (name, self.use("object", identity + "\0" + name))
                for name in sorted(symbols)
            ]
            return {"target": identity, "artifacts": artifacts}
        raise ValueError("Unknown query type: " + kind)


_ABSENT = object()
