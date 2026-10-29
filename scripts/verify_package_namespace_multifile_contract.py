#!/usr/bin/env python3
"""Source-free reference checks for proposed package-scoped multi-file namespaces.

This deliberately does NOT compile Oreslang or inspect the filesystem. Compiler
parity requires separate exact-source execution evidence.
"""
from __future__ import annotations

import copy
import json
import tomllib
from pathlib import Path
import sys

CONTRACT = Path(__file__).resolve().parent.parent / "contracts" / "package-namespace-multifile-v1.json"
ALLOWED_VISIBILITY = {"pub", "pub[pkg]", "pub[file]", "private"}


class ContractError(ValueError):
    pass


def validate_source_path(path: str) -> bool:
    return (
        isinstance(path, str)
        and bool(path)
        and not path.startswith("/")
        and "\\" not in path
        and all(part not in {"", ".", ".."} for part in path.split("/"))
        and path.endswith(".ores")
    )


def build_index(package: dict) -> dict:
    """Static package + namespace export index, keyed by exact package instance."""
    if not package.get("id") or not package.get("manifest"):
        raise ContractError("invalid-package-identity")
    seen_files = set()
    namespaces = {}
    for source in package["files"]:
        path = source["path"]
        if not validate_source_path(path):
            raise ContractError("invalid-source-path")
        if source.get("listed") is False:
            raise ContractError("unlisted-file")
        if path in seen_files:
            raise ContractError("duplicate-file")
        seen_files.add(path)
        namespace = source["namespace"]
        if not namespace.isidentifier() or source.get("header") != f"namespace {namespace};":
            raise ContractError("header-mismatch")
        bindings = namespaces.setdefault(namespace, {})
        for symbol in source["exports"]:
            if symbol["visibility"] not in ALLOWED_VISIBILITY or not symbol["name"].isidentifier():
                raise ContractError("invalid-export")
            name = symbol["name"]
            visibility = symbol["visibility"]
            # File-private or lexical-private declarations are never added to
            # the cross-file namespace binding table.
            if visibility in {"private", "pub[file]"}:
                continue
            if name in bindings:
                # The reference contract deliberately rejects all duplicate
                # public names. Production may accept *proven* legal arity
                # overload families after typechecker/evaluator parity.
                raise ContractError("duplicate-export")
            bindings[name] = (path, visibility)
    return namespaces


def resolve(index: dict, case: dict) -> tuple[str, str | None]:
    provider = index[case["provider"]]
    namespace = provider.get(case["namespace"])
    if namespace is None:
        return "reject", "no-such-namespace"
    entry = namespace.get(case["symbol"])
    if entry is None:
        hidden = any(
            source["namespace"] == case["namespace"]
            and any(e["name"] == case["symbol"] and e["visibility"] in {"private", "pub[file]"}
                    for e in source["exports"])
            for source in PACKAGES[case["provider"]]["files"]
        )
        return "reject", "not-public-to-package" if hidden else "not-exported-by-namespace"
    source_path, visibility = entry
    if visibility == "pub[pkg]" and case["importer"] != case["provider"]:
        return "reject", "not-public-to-package"
    return "admit", source_path


def apply_mutation(package: dict, scenario: dict) -> None:
    kind, path = scenario["mutation"], scenario["source_file"]
    source = next((x for x in package["files"] if x["path"] == path), None)
    if kind != "unlisted-file" and source is None:
        raise ContractError("unknown-mutation-source")
    if kind == "copy-export":
        source["exports"].append({"name": scenario["symbol"], "visibility": "pub"})
    elif kind == "mismatch-header":
        source["header"] = "namespace forged;"
    elif kind == "duplicate-file":
        package["files"].append(copy.deepcopy(source))
    elif kind == "path-traversal":
        source["path"] = "../outside/evil.ores"
    elif kind == "unlisted-file":
        package["files"].append({
            "path": path, "header": "namespace billing;", "namespace": "billing",
            "listed": False, "exports": [{"name": "shadow", "visibility": "pub"}]
        })
    else:
        raise ContractError("unknown-mutation-kind")


def verify_source_fixtures(data: dict) -> int:
    """Check real source fixtures have not drifted from the source-free vector.

    This only inspects UTF-8 files and a TOML manifest; it does NOT parse,
    compile, link, typecheck or execute Oreslang.
    """
    directory = CONTRACT.parent.parent / "fixtures" / "package-namespaces-multifile-v1"
    with (directory / "checkout" / ".ores.pkg.toml").open("rb") as stream:
        manifest = tomllib.load(stream)
    assert manifest["schema_version"] == "2"
    checkout = next(p for p in data["packages"] if p["id"] == "checkout@sha256:alpha")
    listed = manifest["packages"]["checkout"]["files"]
    expected = [source["path"] for source in checkout["files"]]
    assert len(listed) == len(set(listed)) == 10, "duplicate or missing manifest membership"
    assert sorted(listed) == sorted(expected), "manifest and source corpus disagree"
    checks = 0
    for source in checkout["files"]:
        path = directory / "checkout" / source["path"]
        body = path.read_text(encoding="utf-8")
        assert body.splitlines()[0] == source["header"], source["path"]
        for symbol in source["exports"]:
            assert "fnc " + symbol["name"] + "(" in body, (
                source["path"], symbol["name"])
        checks += 1
    within = (directory / "checkout/src/identity/accounts.ores").read_text(encoding="utf-8")
    outside = (directory / "client/src/main.ores").read_text(encoding="utf-8")
    assert 'import namespace billing from "+/";' in within
    assert 'import namespace billing as payments from "checkout";' in outside
    assert "billing.balance()" in within and "payments.balance()" in outside
    return checks + 2


def main() -> int:
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert data["contract_version"] == "oreslang.package-namespace-multifile.v1"
    assert data["status"] == "proposed-contract-not-compiler-executed"
    global PACKAGES
    PACKAGES = {pkg["id"]: pkg for pkg in data["packages"]}
    assert len(PACKAGES) == len(data["packages"]), "duplicate package-instance identity"
    checkout = PACKAGES["checkout@sha256:alpha"]
    assert len(checkout["files"]) == 10, "fixture must exercise a ten-file package"
    assert {n: sum(f["namespace"] == n for f in checkout["files"])
            for n in ("billing", "identity", "telemetry")} == {
                "billing": 4, "identity": 3, "telemetry": 3
            }, "fixture must contain three namespaces over ten files"
    index = {package_id: build_index(pkg) for package_id, pkg in PACKAGES.items()}

    cases = 0
    for case in data["reference_cases"]:
        if case["importer"] not in PACKAGES or case["provider"] not in PACKAGES:
            raise AssertionError(f"{case['id']}: unknown package identity")
        actual, detail = resolve(index, case)
        assert actual == case["expect"], (case["id"], actual, detail)
        assert detail == (case["provider_file"] if actual == "admit" else case["reason"]), (
            case["id"], detail)
        cases += 1

    for case in data["invalid_package_cases"]:
        mutated = copy.deepcopy(checkout)
        apply_mutation(mutated, case)
        try:
            build_index(mutated)
        except ContractError as exc:
            assert str(exc) == case["expect"], (case["id"], str(exc))
        else:
            raise AssertionError(f"{case['id']}: failed to reject invalid package")
        cases += 1

    fixture_checks = verify_source_fixtures(data)
    print(f"PASS: {cases} namespace reference cases and {fixture_checks} source fixture consistency checks")
    print("NOT compiler/linker/runtime/LLVM/.NET/Wasm execution evidence")
    return 0


if __name__ == "__main__":
    sys.exit(main())
