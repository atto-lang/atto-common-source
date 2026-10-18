#!/usr/bin/env python3
"""Source-free structural checks for the proposed Oreslang scoped visibility contract.

This does NOT parse/compile/execute Oreslang source or prove runtime parity.
Run: python3 scripts/verify_package_visibility_contract.py
"""
from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "contracts/package-visibility-multifile-v1.json"
SCOPES = {"file": ("FILE", "pub[file]"), "pkg": ("PACKAGE", "pub[pkg]"),
          "package": ("PACKAGE", "pub[pkg]")}
QUALIFIER = re.compile(r"\bpub([\[(])([A-Za-z][A-Za-z0-9_]*)([\])])")


def check(condition: bool, why: str) -> None:
    if not condition:
        raise AssertionError(why)


def canonicalize(source: str) -> tuple[str, str | None]:
    # Contract-only notation validator, NOT a compiler/parser.
    if "define module Nested" in source or " method " in source:
        raise ValueError("unsupported nested module / scoped instance member")
    found = QUALIFIER.search(source)
    if found is None:
        if "pub[" in source or "pub(" in source:
            raise ValueError("invalid or incomplete qualifier")
        return source, None
    opening, name, closing = found.groups()
    if (opening == "[" and closing != "]") or (opening == "(" and closing != ")"):
        raise ValueError("unmatched scoped qualifier delimiters")
    if name not in SCOPES:
        raise ValueError("unknown scope")
    scope, canonical = SCOPES[name]
    return source[:found.start()] + canonical + source[found.end():], scope


def package_ids(data: dict) -> dict[str, str]:
    manifest = data["manifest_example"]
    check(manifest["schema_version"] == "2", "manifest v2 required")
    check(manifest["project"]["root"] == ".", "fixture expects project-local root")
    owners: dict[str, str] = {}
    for package, block in manifest["packages"].items():
        check(isinstance(package, str) and bool(package), "invalid package key")
        check(isinstance(block["files"], list) and len(block["files"]) > 0,
              "empty package group")
        for path in block["files"]:
            check(isinstance(path, str) and bool(path), "missing package source")
            pieces = path.split("/")
            check(not path.startswith("/") and "\\" not in path
                  and all(piece not in ("", ".", "..") for piece in pieces)
                  and all(not any(c in piece for c in "*?[]") for piece in pieces),
                  "noncanonical, globbed, or escaping package path: " + path)
            check(path not in owners, "source file belongs to multiple packages: " + path)
            owners[path] = "local:" + package
    return owners


def package_id(path: str, owners: dict[str, str]) -> str:
    # A dependency copy must not share a package ID based on printed package name.
    return owners.get(path, "singleton:" + path)


def scope_allows(scope: str, owner_file: str, owner_module: str,
                 importer_file: str, importer_module: str,
                 owners: dict[str, str], *, member: bool) -> bool:
    if scope == "PUBLIC":
        return True
    if scope == "PACKAGE":
        return package_id(owner_file, owners) == package_id(importer_file, owners)
    if scope == "FILE":
        return owner_file == importer_file
    if scope == "PRIVATE":
        # At file root: same file. Within module: only its lexical module.
        return owner_file == importer_file and (not member or owner_module == importer_module)
    raise AssertionError("unrecognized visibility enum: " + repr(scope))


def module_case_visible(case: dict, owners: dict[str, str]) -> bool:
    owner = case["origin_source"]
    importer = case["importer_source"]
    module = case["module_name"]
    importer_module = case["importer_module"]
    return (
        scope_allows(case["module_visibility"], owner, module, importer,
                     importer_module, owners, member=False)
        and scope_allows(case["member_visibility"], owner, module, importer,
                         importer_module, owners, member=True)
    )


def validate(data: dict) -> tuple[int, int]:
    check(data["contract_version"] == "oreslang.package-visibility-multifile.v1",
          "unsupported visibility contract")
    check(data["status"] == "proposed-only-not-compiler-tested",
          "must not claim compiler test execution")
    owners = package_ids(data)
    canonical = {"PUBLIC": "pub", "FILE": "pub[file]",
                 "PACKAGE": "pub[pkg]", "PRIVATE": "(omitted)"}
    check(data["canonical_syntax"] == canonical, "canonical syntax changed")

    syntax = data["syntax_cases"] + data["module_syntax_cases"]
    check(len(syntax) >= 23, "missing synonym/negative syntax cases")
    for case in syntax:
        source = case["source"]
        try:
            output, scope = canonicalize(source)
        except ValueError:
            accepted = False
            output = None
            scope = None
        else:
            accepted = True
        want = case["expect"] == "admit"
        check(accepted == want, "syntax fixture mismatch: " + case["source"])
        if want:
            expected = case.get("formatted", case.get("canonical"))
            check(output == expected or expected is None,
                  "formatter alias mismatch: " + case["source"])
            if "normalized" in case:
                check(scope == case["normalized"], "scope normalization mismatch")
            if "visibility" in case:
                check(scope == case["visibility"], "module scope mismatch")

    cases = data["module_visibility_cases"]
    check(len(cases) >= 21, "missing module visibility regression cases")
    for case in cases:
        allowed = module_case_visible(case, owners)
        check(allowed == (case["expected"] == "admit"),
              "visibility mismatch in " + case["id"])

    check(any(c["id"] == "pkg-module-public-member-other-package"
              and c["expected"] == "reject" for c in cases),
          "missing parent scope intersection denial")
    check(any(c["id"] == "pkg-module-file-member-peer-file"
              and c["expected"] == "reject" for c in cases),
          "missing file scope denial inside same package")
    return len(syntax), len(cases)


def test_rejects_mutations(original: dict) -> None:
    wrong_expectation = copy.deepcopy(original)
    wrong_expectation["module_visibility_cases"][0]["expected"] = "reject"
    try:
        validate(wrong_expectation)
    except AssertionError:
        pass
    else:
        raise AssertionError("fault injection: wrong expected result was accepted")

    duplicate_source = copy.deepcopy(original)
    duplicate_source["manifest_example"]["packages"]["billing"]["files"].append(
        "src/auth/tokens.ores")
    try:
        validate(duplicate_source)
    except AssertionError:
        pass
    else:
        raise AssertionError("fault injection: duplicate ownership was accepted")

    changed_parent = copy.deepcopy(original)
    changed_parent["module_visibility_cases"][1]["module_visibility"] = "PUBLIC"
    try:
        validate(changed_parent)
    except AssertionError:
        pass
    else:
        raise AssertionError("fault injection: parent visibility widening was accepted")

    wrong_alias = copy.deepcopy(original)
    wrong_alias["module_syntax_cases"][1]["canonical"] = "define pub[package] module Auth as"
    try:
        validate(wrong_alias)
    except AssertionError:
        pass
    else:
        raise AssertionError("fault injection: noncanonical alias was accepted")


def main() -> int:
    try:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        syntax_count, module_count = validate(data)
        test_rejects_mutations(data)
    except (ValueError, KeyError, TypeError, AssertionError, OSError) as exc:
        print("FAIL package-visibility-contract: " + str(exc), file=sys.stderr)
        return 1
    print(f"PASS source-free package visibility contract: {syntax_count} syntax, "
          f"{module_count} module visibility, 4 mutation tests")
    print("NOT executed compiler/JVM/LLVM/AOT tests; remaining manifest/runtime "
          "security scenarios require integration fixtures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
