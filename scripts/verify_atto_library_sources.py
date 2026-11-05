#!/usr/bin/env python3
"""Verify canonical .atto source-byte identities; NOT a guest compiler test."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys

def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + bytes([0]) + data).hexdigest()

def verify(root: Path) -> list[str]:
    problems: list[str] = []
    manifest_file = root / "library/atto-library-source-v1.json"
    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as err:
        return [f"invalid manifest: {err}"]
    if manifest.get("schema") != "attolang.canonical-library-source.v1" or manifest.get("status") != "SOURCE_ONLY_NOT_COMPILED":
        problems.append("invalid manifest schema/status")
    rows = manifest.get("modules")
    if not isinstance(rows, list) or not rows:
        return problems + ["missing module entries"]
    seen: set[str] = set()
    for item in rows:
        if not isinstance(item, dict):
            problems.append("malformed module entry")
            continue
        rel = item.get("path")
        sha = item.get("git_blob_sha")
        tier = item.get("tier")
        module = item.get("module")
        if tier not in ("core", "std") or not isinstance(module, str):
            problems.append(f"invalid tier/module: {item!r}")
            continue
        expected = f"library/ores.{tier}/{module}.atto"
        if rel != expected or not module or not all(ch.isascii() and (ch.isalnum() or ch == "_") for ch in module):
            problems.append(f"invalid canonical path: {rel!r}")
            continue
        if rel in seen:
            problems.append(f"duplicate module: {rel}")
            continue
        seen.add(rel)
        path = root / rel
        if path.is_symlink() or not path.is_file() or any(parent.is_symlink() for parent in path.parents if parent != root):
            problems.append(f"missing or symlinked source: {rel}")
            continue
        data = path.read_bytes()
        if len(data) > 1048576:
            problems.append(f"source exceeds 1 MiB: {rel}")
        try:
            data.decode("utf-8", errors="strict")
        except UnicodeError:
            problems.append(f"invalid UTF-8: {rel}")
        if not isinstance(sha, str) or len(sha) != 40 or git_blob_sha(data) != sha:
            problems.append(f"source Git blob mismatch: {rel}")
    for tier in ("core", "std"):
        base = root / f"library/ores.{tier}"
        for path in base.rglob("*.atto"):
            if path.relative_to(root).as_posix() not in seen:
                problems.append(f"unmanifested Atto source: {path.relative_to(root)}")
        for path in base.rglob("*.java"):
            problems.append(f"Java source in guest library: {path.relative_to(root)}")
    legacy = root / "library/ores.core/numeric.ores"
    current = root / "library/ores.core/numeric.atto"
    if legacy.is_file() and current.is_file() and legacy.read_bytes() != current.read_bytes():
        problems.append("legacy numeric.ores differs from numeric.atto")
    return problems

if __name__ == "__main__":
    issues = verify(Path(__file__).resolve().parents[1])
    for issue in issues:
        print("FAIL:", issue, file=sys.stderr)
    if issues:
        raise SystemExit(1)
    print("ATTO_LIBRARY_SOURCE_FIDELITY_OK; GUEST_COMPILATION=NOT_EXECUTED")
