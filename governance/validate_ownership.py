#!/usr/bin/env python3
"""Fail-closed AttoLang ownership checks. Remote mode needs ATTO_AUDIT_TOKEN."""
from __future__ import annotations
import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORG = "atto-lang"
COUNT = 68
PUBLIC = frozenset({".github", "atto-lang.github.io"})
CATEGORIES = frozenset({
    "Governance, specification and evidence",
    "Compilers, code generation and runtime",
    "Developer tools and browser-facing products",
    "Platforms and devices",
    "Libraries and scientific packages",
    "Examples, reference apps and benchmarks",
})
NAME = re.compile(r"^(?:\.[a-z0-9_-]+|[a-z0-9][a-z0-9._-]*)$")
ROW = re.compile(r"^\| \[\x60([^\x60]+)\x60\]\(https://github\.com/atto-lang/([^)]+)\) \| (.+) \|$")

class InventoryError(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise InventoryError(message)

def validate(manifest_text, map_text, readme):
    try:
        doc = json.loads(manifest_text)
    except (ValueError, TypeError) as error:
        raise InventoryError("invalid JSON manifest") from error
    require(isinstance(doc, dict), "manifest must be an object")
    require(set(doc) == {"schema_version", "organization", "expected_count", "provenance", "sensitivity", "repos"}, "incorrect manifest fields")
    require(type(doc["schema_version"]) is int and doc["schema_version"] == 1, "unknown schema version")
    require(doc["organization"] == ORG, "unexpected organization")
    require(type(doc["expected_count"]) is int and doc["expected_count"] == COUNT, "incorrect fixed inventory count")
    require(doc["provenance"] == "docs/REPOSITORY_MAP.md", "incorrect source document")
    require(doc["sensitivity"] == "private", "inventory must remain private")
    repos = doc["repos"]
    require(isinstance(repos, list) and len(repos) == COUNT, "missing or extra repositories")
    require("docs/REPOSITORY_MAP.md" in readme, "root README does not link map")
    require("private" in map_text.lower() and "Wasmtime" in map_text, "map missing privacy or browser/native boundary")
    seen = {}
    for item in repos:
        require(isinstance(item, dict) and set(item) == {"name", "category", "summary", "visibility"}, "invalid repository record")
        n = item["name"]
        require(isinstance(n, str) and NAME.fullmatch(n) is not None, "invalid repository slug")
        require(n not in seen, "duplicate repository")
        require(item["category"] in CATEGORIES, "unknown ownership category")
        s = item["summary"]
        require(isinstance(s, str) and s.strip() == s and len(s) >= 12, "empty or unsafe summary")
        require(item["visibility"] in ("private", "public"), "unknown visibility")
        require((n in PUBLIC) == (item["visibility"] == "public"), "public/private trust boundary mismatch")
        seen[n] = item
    seen_map = {}
    section = None
    for line in map_text.splitlines():
        if line.startswith("### "):
            section = line[4:].strip()
        if not line.startswith("| ["):
            continue
        match = ROW.fullmatch(line)
        require(match is not None, "noncanonical map link or row")
        n, url_slug, summary = match.groups()
        require(n == url_slug, "label/link mismatch")
        require(n not in seen_map, "duplicate map row")
        require(section in CATEGORIES, "unknown map section")
        seen_map[n] = (section, summary)
    require(set(seen_map) == set(seen), "map/manifest repo set differs")
    for n, item in seen.items():
        require(seen_map[n] == (item["category"], item["summary"]), "map/manifest ownership drift")
    return repos

def github_api(endpoint, token):
    req = urllib.request.Request("https://api.github.com" + endpoint, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "attolang-ownership-audit",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise InventoryError("GitHub API refused audit: HTTP " + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise InventoryError("GitHub API failed audit: " + type(error).__name__) from None
    require(isinstance(data, dict), "invalid GitHub API response")
    return data

def remote(repos, token):
    require(bool(token), "ATTO_AUDIT_TOKEN required for remote audit; refusing silent skip")
    receipt = []
    for item in repos:
        n = item["name"]
        prefix = "/repos/" + ORG + "/" + n
        metadata = github_api(prefix, token)
        require(metadata.get("full_name", "").lower() == (ORG + "/" + n).lower(), "remote identity mismatch: " + n)
        require(("private" if metadata.get("private") is True else "public") == item["visibility"], "remote visibility drift: " + n)
        require(metadata.get("archived") is False, "unexpected archived repository: " + n)
        branch = metadata.get("default_branch")
        require(isinstance(branch, str) and len(branch) > 0, "missing default branch: " + n)
        ref_url = prefix + "/git/ref/heads/" + urllib.parse.quote(branch, safe="")
        before = github_api(ref_url, token)
        sha = before.get("object", {}).get("sha")
        require(isinstance(sha, str) and re.fullmatch("[0-9a-f]{40}", sha) is not None, "invalid default ref SHA: " + n)
        content = github_api(prefix + "/contents/README.md?ref=" + sha, token)
        require(content.get("type") == "file" and content.get("encoding") == "base64", "README missing or nonregular: " + n)
        try:
            raw = base64.b64decode(content["content"]).decode("utf-8")
        except (KeyError, UnicodeError, ValueError):
            raise InventoryError("unreadable README: " + n) from None
        if n == "atto-source.realtime":
            scope = "## What belongs here" in raw and "## What belongs in other repositories" in raw
        else:
            scope = ("## Repository ownership and contribution routing" in raw
                and ("**Belongs here:**" in raw or "**Belongs in this repository:**" in raw)
                and "**Belongs elsewhere:**" in raw)
        require(scope, "ownership contract absent on default branch: " + n)
        require("not executed" in raw.lower() or "no CI" in raw, "execution boundary absent: " + n)
        after = github_api(ref_url, token)
        require(after.get("object", {}).get("sha") == sha, "default branch moved mid-audit: " + n)
        receipt.append({"repository": ORG + "/" + n, "head_sha": sha, "verified": True})
    return receipt

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--offline", action="store_true")
    mode.add_argument("--remote", action="store_true")
    parser.add_argument("--receipt", type=Path, help="remote audit receipt JSON path")
    args = parser.parse_args(argv)
    try:
        repos = validate(
            (ROOT / "governance/repositories.json").read_text(encoding="utf-8"),
            (ROOT / "docs/REPOSITORY_MAP.md").read_text(encoding="utf-8"),
            (ROOT / "README.md").read_text(encoding="utf-8"),
        )
        if args.remote:
            result = remote(repos, os.getenv("ATTO_AUDIT_TOKEN", ""))
            if args.receipt:
                args.receipt.write_text(json.dumps({"schema_version": 1, "results": result}, indent=2) + "\n", encoding="utf-8")
            print("PASS authenticated remote inventory: " + str(len(result)))
        else:
            require(args.receipt is None, "--receipt requires --remote")
            print("PASS offline ownership inventory: " + str(len(repos)))
        return 0
    except (InventoryError, OSError) as error:
        print("FAIL ownership audit: " + str(error), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
