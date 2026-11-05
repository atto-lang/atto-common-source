#!/usr/bin/env python3
"""Fail-closed byte identity for canonical AttoLang library v1 (source-only)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys
import stat

SCHEMA = "attolang.canonical-library-source.v1"
STATUS = "SOURCE_ONLY_NOT_COMPILED"
# Independent v1 pin: updating only the manifest and source must not silently pass.
PINNED_GIT_BLOBS = {
    "library/ores.core/numeric.atto": "5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72",
    "library/ores.std/actor_persistence.atto": "fec71c8ae3e9c0e8828b712a1a9d78a26948e0ea",
    "library/ores.std/assert.atto": "dd5e64e09e9a4b2606e4a685a60ad0bc00f45aea",
    "library/ores.std/compute.atto": "b8e11db5f8701fbceb1e2afd39cad06662d0e8be",
    "library/ores.std/core.atto": "d2cd9b8e0cd3e3bb3ee6a5f9cebf9ab3312c44f4",
    "library/ores.std/db_pool.atto": "95396a3cee45a18d7d2707224ef2f23957ba8e46",
    "library/ores.std/http_wire.atto": "21169e5c262cd79997637c97d448e05a835e2e44",
    "library/ores.std/trace.atto": "f4ff35b10683880e42e3151b34fc140d52704dba",
}
MODULE = re.compile(r"[a-z][a-z0-9_]*\Z", re.ASCII)
MAX_SOURCE_BYTES = 1024 * 1024


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def verify(root: Path, *, pins: dict[str, str] | None = None) -> list[str]:
    """Check canonical sources, compatibility aliases and v1 source pins.

    The optional pins argument exists for isolated synthetic regression tests.
    The executable entry point always uses the committed eight-module pins.
    """
    pinned = PINNED_GIT_BLOBS if pins is None else pins
    failures: list[str] = []
    manifest_path = root / "library/atto-library-source-v1.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        return ["manifest missing or symlinked"]
    if not stat.S_ISREG(manifest_path.lstat().st_mode) or manifest_path.stat().st_nlink != 1:
        return ["manifest must be a uniquely linked regular file"]
    try:
        manifest_bytes = manifest_path.read_bytes()
        if len(manifest_bytes) > MAX_SOURCE_BYTES:
            return ["manifest too large"]
        manifest = json.loads(manifest_bytes.decode("utf-8", errors="strict"))
    except (UnicodeError, OSError, ValueError) as exc:
        return [f"manifest invalid: {exc}"]
    if not isinstance(manifest, dict):
        return ["manifest must be object"]
    if manifest.get("schema") != SCHEMA or manifest.get("status") != STATUS:
        failures.append("manifest schema/status mismatch")
    if manifest.get("canonical_language_extension") != ".atto":
        failures.append("canonical .atto extension mismatch")
    modules = manifest.get("modules")
    if not isinstance(modules, list) or len(modules) != len(pinned):
        return failures + ["unexpected canonical module count"]

    seen: set[str] = set()
    for row in modules:
        if not isinstance(row, dict):
            failures.append("module entry is not object")
            continue
        tier = row.get("tier")
        name = row.get("module")
        rel = row.get("path")
        declared_sha = row.get("git_blob_sha")
        if tier not in ("core", "std") or not isinstance(name, str) or MODULE.fullmatch(name) is None:
            failures.append(f"invalid module identity: {name!r}")
            continue
        expected = f"library/ores.{tier}/{name}.atto"
        if rel != expected or not isinstance(rel, str) or rel not in pinned:
            failures.append(f"unexpected canonical path: {rel!r}")
            continue
        if rel in seen:
            failures.append(f"duplicate canonical path: {rel}")
            continue
        seen.add(rel)
        if declared_sha != pinned[rel]:
            failures.append(f"manifest is not independently pinned: {rel}")
        source = root / rel
        if source.is_symlink() or not source.is_file() or any(p.is_symlink() for p in source.parents if p != root):
            failures.append(f"source missing or symlinked: {rel}")
            continue
        if not stat.S_ISREG(source.lstat().st_mode) or source.stat().st_nlink != 1:
            failures.append(f"source must be a uniquely linked regular file: {rel}")
            continue
        try:
            data = source.read_bytes()
        except OSError as exc:
            failures.append(f"source unreadable: {rel}: {exc}")
            continue
        if len(data) > MAX_SOURCE_BYTES:
            failures.append(f"source quota exceeded: {rel}")
        try:
            data.decode("utf-8", errors="strict")
        except UnicodeError:
            failures.append(f"invalid UTF-8: {rel}")
        if git_blob_sha(data) != pinned[rel]:
            failures.append(f"source git blob mismatch: {rel}")
    if seen != set(pinned):
        failures.append("missing or extra canonical modules")

    for tier in ("core", "std"):
        base = root / f"library/ores.{tier}"
        if base.is_symlink() or not base.is_dir():
            failures.append(f"library directory missing or symlinked: {base.name}")
            continue
        for candidate in base.rglob("*"):
            rel = candidate.relative_to(root).as_posix()
            if candidate.is_symlink():
                failures.append(f"symlink inside guest library: {rel}")
            elif candidate.is_file() and candidate.suffix == ".atto" and rel not in pinned:
                failures.append(f"unmanifested .atto source: {rel}")
            elif candidate.is_file() and candidate.suffix == ".java":
                failures.append(f"Java source inside guest library: {rel}")
            elif candidate.is_file() and candidate.suffix == ".ores" and rel != "library/ores.core/numeric.ores":
                failures.append(f"unapproved legacy source: {rel}")
    legacy = root / "library/ores.core/numeric.ores"
    numeric = root / "library/ores.core/numeric.atto"
    if legacy.is_symlink() or not legacy.is_file() or numeric.is_symlink() or not numeric.is_file():
        failures.append("legacy numeric source missing or symlinked")
    elif legacy.stat().st_nlink != 1 or numeric.stat().st_nlink != 1:
        failures.append("legacy or canonical numeric hardlink not admitted")
    elif legacy.read_bytes() != numeric.read_bytes():
        failures.append("legacy numeric.ores differs from numeric.atto")
    return failures


if __name__ == "__main__":
    failures = verify(Path(__file__).resolve().parents[1])
    for issue in failures:
        print("FAIL:", issue, file=sys.stderr)
    if failures:
        sys.exit(1)
    print("ATTO_LIBRARY_SOURCE_FIDELITY_OK; GUEST_COMPILATION=NOT_EXECUTED")
