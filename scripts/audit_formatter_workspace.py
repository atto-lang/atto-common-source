#!/usr/bin/env python3
"""Read-only cross-repository Oreslang formatter compatibility inventory.

Every formatter invocation receives an isolated temporary copy, never a source
path from a Git worktree. This is not a semantic equivalence/compile test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import selectors
import signal
import stat
import subprocess
import tempfile
import time
from pathlib import Path

REPOSITORIES = (
    "oreslang-source.java", "oreslang-source.llvm", "oreslang-source.wasm",
    "oreslang-source.forge", "oreslang-source.net", "oreslang-common-source",
    "oreslang-format",
)
IGNORE_DIRS = {".git", "build", "target", "out", "node_modules", "__pycache__"}


def discover(root: Path) -> list[Path]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"repository root must be a real directory: {root}")
    files = []
    for parent, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in IGNORE_DIRS and not (Path(parent) / d).is_symlink())
        for name in sorted(names):
            file = Path(parent) / name
            if file.suffix == ".ores" and file.is_file() and not file.is_symlink():
                files.append(file)
    return files


def formatter_pass(binary: Path, source: bytes, timeout: float,
                   max_output_bytes: int = 2097152) -> dict:
    # Do not use subprocess.run(capture_output=True): untrusted formatter
    # output could exhaust RAM long before the timeout fires.
    with tempfile.TemporaryDirectory(prefix="oresfmt-audit-") as scratch:
        path = Path(scratch) / "input.ores"
        path.write_bytes(source)
        try:
            process = subprocess.Popen(
                [str(binary), "--stdout", str(path)], cwd=scratch,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, start_new_session=(os.name == "posix"),
            )
        except OSError as exc:
            return {"status": "tool_error", "detail": str(exc)[:200]}

        output = bytearray()
        errors = bytearray()
        status = "finished"
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            try:
                for name, stream in (("stdout", process.stdout),
                                     ("stderr", process.stderr)):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, name)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        status = "timeout"
                        break
                    ready = selector.select(remaining)
                    if not ready:
                        status = "timeout"
                        break
                    for key, _ in ready:
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        if key.data == "stdout":
                            if len(output) + len(chunk) > max_output_bytes:
                                status = "oversize_output"
                                break
                            output.extend(chunk)
                        elif len(errors) < 200:
                            errors.extend(chunk[:200 - len(errors)])
                    if status != "finished":
                        break
                if status == "finished":
                    try:
                        process.wait(timeout=max(0, deadline - time.monotonic()))
                    except subprocess.TimeoutExpired:
                        status = "timeout"
            except (OSError, ValueError) as exc:
                status = "tool_error"
                errors = bytearray(str(exc).encode("utf-8", "replace")[:200])
            finally:
                if status != "finished":
                    try:
                        if os.name == "posix":
                            os.killpg(process.pid, signal.SIGKILL)
                        elif process.poll() is None:
                            process.kill()
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.kill()
                process.wait()
                for stream in (process.stdout, process.stderr):
                    if stream is not None:
                        stream.close()

        if path.read_bytes() != source:
            return {"status": "unsafe_temp_write",
                    "detail": "formatter changed temporary input"}
        if status != "finished":
            return {"status": status, "detail": errors.decode("utf-8", "replace")}
        if process.returncode != 0:
            return {"status": "rejected",
                    "detail": errors.decode("utf-8", "replace"),
                    "exit_code": process.returncode}
        return {"status": "formatted", "output": bytes(output)}


def audit(roots: dict[str, Path], formatter: Path, timeout: float = 15,
          max_bytes: int = 1048576) -> dict:
    results = []
    for repo in REPOSITORIES:
        if repo not in roots:
            raise ValueError(f"missing repository root: {repo}")
        root = roots[repo]
        files = discover(root)
        if not files:
            raise ValueError(f"no .ores source files under {repo}")
        for path in files:
            original = path.read_bytes()
            item = {"repository": repo, "path": path.relative_to(root).as_posix(),
                    "input_sha256": hashlib.sha256(original).hexdigest()}
            if len(original) > max_bytes:
                item.update(status="oversize", detail="file exceeds audit size limit")
            else:
                first = formatter_pass(formatter, original, timeout, max_bytes * 2)
                item["status"] = first["status"]
                if first["status"] == "formatted":
                    output = first["output"]
                    second = formatter_pass(formatter, output, timeout, max_bytes * 2)
                    item["would_change"] = output != original
                    item["idempotent"] = (second["status"] == "formatted"
                                           and second["output"] == output)
                    if not item["idempotent"]:
                        item["status"] = "unstable"
                        item["detail"] = second.get("detail", "second pass changed output")
                else:
                    item["detail"] = first.get("detail", "")
                    if "exit_code" in first:
                        item["exit_code"] = first["exit_code"]
            # Source remains outside the formatter's temporary working directory.
            if path.read_bytes() != original:
                item["status"] = "source_changed"
            results.append(item)
    counts = {kind: sum(item["status"] == kind for item in results) for kind in
              ("formatted", "rejected", "unstable", "tool_error", "unsafe_temp_write",
               "source_changed", "oversize", "oversize_output", "timeout")}
    return {"repositories": list(REPOSITORIES), "total": len(results), "counts": counts,
            "would_change": sum(bool(x.get("would_change")) for x in results),
            "formatter_sha256": hashlib.sha256(formatter.read_bytes()).hexdigest(),
            "results": results}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True,
                        help="parent directory containing all seven repositories")
    parser.add_argument("--formatter", type=Path, required=True)
    parser.add_argument("--formatter-sha256", help="optional expected reviewed formatter SHA-256")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--strict", action="store_true",
                        help="fail on any rejection, change, or unstable output; use curated corpus")
    args = parser.parse_args(argv)
    if args.timeout <= 0 or args.timeout > 300:
        parser.error("--timeout must be between 0 and 300 seconds")
    try:
        binary = args.formatter.resolve(strict=True)
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError("formatter must be an executable regular file")
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        if args.formatter_sha256 and digest != args.formatter_sha256.lower():
            raise ValueError("formatter SHA-256 mismatch")
        workspace = args.workspace.resolve(strict=True)
        roots = {name: workspace / name for name in REPOSITORIES}
        report = audit(roots, binary, args.timeout)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    report["formatter_pinned"] = bool(args.formatter_sha256)
    print(json.dumps(report, indent=2))
    unsafe = any(report["counts"][name] for name in
                 ("unstable", "tool_error", "unsafe_temp_write", "source_changed", "oversize", "oversize_output", "timeout"))
    if args.strict:
        unsafe |= bool(report["counts"]["rejected"] or report["would_change"])
    return int(unsafe)


if __name__ == "__main__":
    raise SystemExit(main())
