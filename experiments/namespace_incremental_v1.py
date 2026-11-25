"""Backend-neutral namespace incremental planner (reference model, not a compiler).

Inputs MUST come from a trusted, fully validated package/source/ABI resolver.
This model is not a cache authority, parser, sandbox, or executable-guest proof.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
import re
from typing import Any

_SHA = re.compile(r"[0-9a-f]{64}\Z")
_NS = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


class InvalidSnapshot(ValueError):
    """An invalid or unresolved namespace graph cannot produce a build plan."""


@dataclass(frozen=True)
class Plan:
    recheck: tuple[str, ...]
    codegen: tuple[str, ...]
    removed: tuple[str, ...]
    relink_packages: tuple[str, ...]


def _sha(value: Any) -> bool:
    return isinstance(value, str) and _SHA.fullmatch(value) is not None


def _path(value: Any) -> bool:
    return (isinstance(value, str) and len(value) <= 4096
            and value.endswith(".atto") and "\\" not in value
            and all(part not in ("", ".", "..") for part in value.split("/"))
            and not value.startswith("/"))


def _identity(package: str, namespace: str) -> str:
    return package + "::" + namespace


def _file_identity(package: str, path: str) -> str:
    # '@file:' cannot be an explicit flat namespace. A missing header is NOT
    # membership in a global/default namespace, even within the same package.
    return package + "::@file:" + path


def _valid_edges(entry: dict[str, Any]) -> bool:
    for edge in ("imports", "inlines"):
        value = entry[edge]
        if (not isinstance(value, list) or len(value) > 4096
                or not all(isinstance(v, str) for v in value)
                or len(value) != len(set(value))):
            return False
    return True


def _snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate graph shape; reject missing imports and ambiguous identities."""
    if not isinstance(raw, dict) or set(raw) != {"semantic_profile", "codegen_profile", "packages", "files", "namespaces"}:
        raise InvalidSnapshot("expected exactly five snapshot fields")
    if not _sha(raw["semantic_profile"]) or not _sha(raw["codegen_profile"]):
        raise InvalidSnapshot("invalid profile digest")
    if not isinstance(raw["packages"], list) or not isinstance(raw["files"], list) or not isinstance(raw["namespaces"], list):
        raise InvalidSnapshot("packages, files and namespaces must be lists")
    if len(raw["packages"]) > 4096 or len(raw["files"]) > 131072 or len(raw["namespaces"]) > 131072:
        raise InvalidSnapshot("snapshot exceeds bounded graph capacity")
    packages = {}
    for pkg in raw["packages"]:
        if not isinstance(pkg, dict) or set(pkg) != {"id", "manifest_sha"}:
            raise InvalidSnapshot("invalid package descriptor")
        name = pkg["id"]
        if (not isinstance(name, str) or not name or len(name) > 512
                or "::" in name or name in packages or not _sha(pkg["manifest_sha"])):
            raise InvalidSnapshot("invalid or duplicate pinned package")
        packages[name] = pkg["manifest_sha"]
    namespaces = {}
    for ns in raw["namespaces"]:
        if not isinstance(ns, dict) or set(ns) != {"package", "name", "interface_sha", "imports", "inlines"}:
            raise InvalidSnapshot("invalid namespace descriptor")
        pkg, name = ns["package"], ns["name"]
        if pkg not in packages or not isinstance(name, str) or not _NS.fullmatch(name) or not _sha(ns["interface_sha"]):
            raise InvalidSnapshot("unresolved namespace identity/interface")
        key = _identity(pkg, name)
        if key in namespaces:
            raise InvalidSnapshot("duplicate namespace " + key)
        if not _valid_edges(ns):
            raise InvalidSnapshot("invalid or duplicate namespace dependency")
        namespaces[key] = ns
    files = defaultdict(list)
    paths = set()
    for unit in raw["files"]:
        if not isinstance(unit, dict):
            raise InvalidSnapshot("invalid source unit")
        pkg, ns, path = unit.get("package"), unit.get("namespace"), unit.get("path")
        bare_fields = {"package", "namespace", "path", "source_sha"}
        file_fields = bare_fields | {"interface_sha", "imports", "inlines"}
        if (not _path(path) or pkg not in packages or (pkg, path) in paths
                or not _sha(unit.get("source_sha"))):
            raise InvalidSnapshot("invalid source ownership, path or digest")
        if ns is None:
            # Each unnamespaced physical file is its OWN compilation unit.
            # Its verified file ABI and import/inline dependencies are required.
            if (set(unit) != file_fields or not _sha(unit.get("interface_sha"))
                    or not _valid_edges(unit)):
                raise InvalidSnapshot("unnamespaced file requires verified file ABI and edges")
            key = _file_identity(pkg, path)
            namespaces[key] = {
                "package": pkg, "name": "@file:" + path,
                "interface_sha": unit["interface_sha"],
                "imports": list(unit["imports"]), "inlines": list(unit["inlines"]),
            }
        else:
            if set(unit) != bare_fields or not isinstance(ns, str) or not _NS.fullmatch(ns):
                raise InvalidSnapshot("invalid namespace source descriptor")
            key = _identity(pkg, ns)
            if key not in namespaces:
                raise InvalidSnapshot("invalid namespace ownership")
        paths.add((pkg, path))
        files[key].append((path, unit["source_sha"]))
    for key, ns in namespaces.items():
        if not files[key]:
            raise InvalidSnapshot("empty namespace " + key)
        for edge in ns["imports"] + ns["inlines"]:
            if edge not in namespaces:
                raise InvalidSnapshot("missing/unauthorized dependency " + edge)
        files[key].sort()
    return {"packages": packages, "namespaces": namespaces, "files": dict(files),
            "semantic_profile": raw["semantic_profile"], "codegen_profile": raw["codegen_profile"]}


def _reverse(graph: dict[str, Any], edge: str) -> dict[str, set[str]]:
    reversed_edges: dict[str, set[str]] = defaultdict(set)
    for consumer, ns in graph["namespaces"].items():
        for origin in ns[edge]:
            reversed_edges[origin].add(consumer)
    return reversed_edges


def _closure(seeds: set[str], reverse_edges: dict[str, set[str]]) -> set[str]:
    found = set(seeds)
    queue = deque(sorted(seeds))
    while queue:
        for consumer in sorted(reverse_edges.get(queue.popleft(), ())):
            if consumer not in found:
                found.add(consumer)
                queue.append(consumer)
    return found


def plan_incremental(previous: dict[str, Any] | None, current: dict[str, Any]) -> Plan:
    """Compute conservative namespace recompilation/relinking across one snapshot edit.

    Interface hashes must include public types, effects, ownership, actor
    protocol/typestate, generics and all other exported semantic contracts.
    Imported/inlined edges must already be resolved to pinned package identities.
    """
    new = _snapshot(current)
    old = _snapshot(previous) if previous is not None else None
    now = set(new["namespaces"])
    before = set(old["namespaces"]) if old is not None else set()
    removed = before - now
    recheck: set[str] = set()
    codegen: set[str] = set()
    api_changed: set[str] = set(removed)
    if old is None:
        recheck.update(now)
        codegen.update(now)
        api_changed.update(now)
    else:
        for key in now:
            desc = new["namespaces"][key]
            prev = old["namespaces"].get(key)
            pkg = desc["package"]
            if prev is None or prev["interface_sha"] != desc["interface_sha"]:
                api_changed.add(key)
            if (prev is None or new["files"][key] != old["files"][key]
                    or new["packages"][pkg] != old["packages"].get(pkg)
                    or desc["imports"] != prev["imports"]
                    or desc["interface_sha"] != prev["interface_sha"]):
                recheck.add(key)
                codegen.add(key)
            if prev is not None and desc["inlines"] != prev["inlines"]:
                codegen.add(key)
        if new["semantic_profile"] != old["semantic_profile"]:
            recheck.update(now)
            codegen.update(now)
        if new["codegen_profile"] != old["codegen_profile"]:
            codegen.update(now)
    # Track public-ABI changes through the complete reverse-import closure.
    recheck |= _closure(api_changed, _reverse(new, "imports")) & now
    codegen |= recheck
    # Embedded bodies require code regeneration even when signatures are stable.
    codegen = _closure(codegen, _reverse(new, "inlines")) & now
    changed_packages = {new["namespaces"][key]["package"] for key in codegen}
    if old is not None:
        changed_packages.update(old["namespaces"][key]["package"] for key in removed)
    package_reverse: dict[str, set[str]] = defaultdict(set)
    for key, ns in new["namespaces"].items():
        for dep in ns["imports"] + ns["inlines"]:
            dep_package = new["namespaces"][dep]["package"]
            if dep_package != ns["package"]:
                package_reverse[dep_package].add(ns["package"])
    relink = _closure(changed_packages, package_reverse)
    return Plan(tuple(sorted(recheck)), tuple(sorted(codegen)), tuple(sorted(removed)), tuple(sorted(relink)))
