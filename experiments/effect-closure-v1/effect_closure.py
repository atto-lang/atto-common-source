#!/usr/bin/env python3
"""Untrusted, standalone Oreslang effect-closure reference model (NOT compiler proof)."""

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import re
import sys

MAX_INPUT_BYTES = 1024 * 1024
MAX_FUNCTIONS = 4096
MAX_EDGES = 65536
MAX_ISSUES = 128
EFFECTS = (
    "blocking_io", "dynamic_dispatch", "ffi", "gc", "heap_alloc",
    "runtime_codegen", "suspension", "unbounded_work",
)
LEVELS = ("never", "bounded", "unbounded", "unknown")
RANK = {value: index for index, value in enumerate(LEVELS)}
ID = re.compile(r"[A-Za-z_][A-Za-z0-9_.$:/-]{0,127}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
PROFILES = {
    # Only checks declared facts, not end-to-end timing or code generation.
    "hard_rt": {
        "blocking_io": ("never",), "dynamic_dispatch": ("never",),
        "ffi": ("never",), "gc": ("never",), "heap_alloc": ("never",),
        "runtime_codegen": ("never",), "suspension": ("never", "bounded"),
        "unbounded_work": ("never", "bounded"),
    },
    "zero_gc": {"gc": ("never",)},
    "full_aot": {
        "runtime_codegen": ("never",), "dynamic_dispatch": ("never",),
        "ffi": ("never",),
    },
}


class InvalidGraph(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidGraph(message)


def exact_keys(obj, keys, where):
    require(type(obj) is dict, f"{where}: expected object")
    require(set(obj) == set(keys), f"{where}: missing or unknown fields")


def unique_pairs(pairs):
    obj = {}
    for name, value in pairs:
        if name in obj:
            raise InvalidGraph(f"duplicate JSON key: {name}")
        obj[name] = value
    return obj


def parse_bytes(raw):
    require(type(raw) is bytes and len(raw) <= MAX_INPUT_BYTES, "input exceeds 1 MiB or is not bytes")
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InvalidGraph(f"invalid JSON: {exc}") from exc
    validate(payload)
    return payload


def validate(graph):
    exact_keys(graph, ("schema_version", "kind", "source_tree", "producer", "entries", "functions"), "root")
    require(type(graph["schema_version"]) is int and graph["schema_version"] == 1, "unsupported schema version")
    require(graph["kind"] == "ores-effect-graph", "unsupported graph kind")
    require(type(graph["source_tree"]) is str and SHA.fullmatch(graph["source_tree"]), "invalid source tree SHA")
    producer = graph["producer"]
    exact_keys(producer, ("backend", "revision"), "producer")
    require(producer["backend"] in ("java", "llvm", "reference"), "unknown producer backend")
    require(type(producer["revision"]) is str and SHA.fullmatch(producer["revision"]), "invalid compiler revision")
    functions = graph["functions"]
    entries = graph["entries"]
    require(type(functions) is list and 1 <= len(functions) <= MAX_FUNCTIONS, "invalid function count")
    require(type(entries) is list and 1 <= len(entries) <= 64, "invalid entry count")
    names = {}
    edges = 0
    for i, node in enumerate(functions):
        where = f"functions[{i}]"
        exact_keys(node, ("id", "effects", "calls"), where)
        symbol = node["id"]
        require(type(symbol) is str and ID.fullmatch(symbol), f"{where}: invalid symbol")
        require(symbol not in names, f"{where}: duplicate symbol {symbol}")
        names[symbol] = node
        effect = node["effects"]
        exact_keys(effect, EFFECTS, f"{where}.effects")
        for k in EFFECTS:
            require(type(effect[k]) is str and effect[k] in RANK, f"{where}: invalid {k}")
        calls = node["calls"]
        require(type(calls) is list and len(calls) <= 256, f"{where}: invalid call list")
        edges += len(calls)
        require(edges <= MAX_EDGES, "too many edges")
        require(all(type(c) is str and ID.fullmatch(c) for c in calls), f"{where}: invalid callee")
        require(len(set(calls)) == len(calls), f"{where}: duplicate callee")
    require(all(type(e) is str and ID.fullmatch(e) for e in entries), "invalid entry symbol")
    require(len(set(entries)) == len(entries), "duplicate entry")
    for entry in entries:
        require(entry in names, f"unresolved entry: {entry}")
    for name, node in names.items():
        for callee in node["calls"]:
            require(callee in names, f"unresolved call: {name} -> {callee}")
    return names


def analyze(graph, profiles):
    names = validate(graph)
    canonical = json.dumps(graph, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    reachable = set()
    pending = list(graph["entries"])
    while pending:
        name = pending.pop()
        if name in reachable:
            continue
        reachable.add(name)
        pending.extend(names[name]["calls"])

    parents = {name: [] for name in reachable}
    indegree = {name: 0 for name in reachable}
    for caller in sorted(reachable):
        for callee in names[caller]["calls"]:
            parents[callee].append(caller)
            indegree[callee] += 1
    # Kahn elimination: any residual reachable SCC needs a termination proof.
    ready = deque(sorted(name for name in reachable if indegree[name] == 0))
    while ready:
        current = ready.popleft()
        for callee in names[current]["calls"]:
            indegree[callee] -= 1
            if indegree[callee] == 0:
                ready.append(callee)
    recursive = sorted(name for name, degree in indegree.items() if degree > 0)

    # Least fixed point in the finite four-level effect lattice, cycle-safe.
    merged = {name: dict(names[name]["effects"]) for name in reachable}
    queue = deque(sorted(reachable))
    queued = set(queue)
    while queue:
        caller = queue.popleft()
        queued.remove(caller)
        summary = merged[caller]
        new = dict(names[caller]["effects"])
        for callee in names[caller]["calls"]:
            child = merged[callee]
            for effect in EFFECTS:
                if RANK[child[effect]] > RANK[new[effect]]:
                    new[effect] = child[effect]
        if new != summary:
            merged[caller] = new
            for parent in parents[caller]:
                if parent not in queued:
                    queue.append(parent)
                    queued.add(parent)

    assessments = {}
    for profile in profiles:
        policy = PROFILES[profile]
        issues = []
        issue_count = 0
        # BFS parent pointers: bounded memory even for deep call graphs.
        via = {entry: None for entry in sorted(graph["entries"])}
        bfs = deque(sorted(graph["entries"]))
        while bfs:
            name = bfs.popleft()
            for callee in sorted(names[name]["calls"]):
                if callee not in via:
                    via[callee] = name
                    bfs.append(callee)
        for name in sorted(reachable):
            for effect in sorted(policy):
                value = names[name]["effects"][effect]
                if value not in policy[effect]:
                    issue_count += 1
                    if len(issues) < MAX_ISSUES:
                        path = []
                        step = name
                        while step is not None:
                            path.append(step)
                            step = via[step]
                        path.reverse()
                        # No truncated witness is ever presented as complete.
                        shown = path if len(path) <= 32 else path[:16] + path[-16:]
                        issues.append({"symbol": name, "effect": effect, "level": value,
                                       "path": shown, "path_omitted_count": len(path) - len(shown)})
        if profile == "hard_rt" and recursive:
            issue_count += 1
            if len(issues) < MAX_ISSUES:
                issues.append({"symbol": recursive[0], "effect": "termination",
                               "level": "unknown", "reason": "recursive_call_graph_requires_termination_proof",
                               "path": [recursive[0]], "path_omitted_count": 0})
        assessments[profile] = {
            "compatible_with_declared_facts": issue_count == 0,
            "issues": issues, "omitted_issues": max(0, issue_count - MAX_ISSUES),
            "entry_summaries": {name: merged[name] for name in sorted(graph["entries"])},
        }
    return {
        "schema_version": 1,
        "status": "UNVERIFIED_DECLARED_FACTS_NOT_COMPILER_OR_TIMING_PROOF",
        "source_tree_claim": graph["source_tree"],
        "producer_revision_claim": graph["producer"]["revision"],
        "producer_backend_claim": graph["producer"]["backend"],
        "canonical_input_sha256": hashlib.sha256(canonical).hexdigest(),
        "reachable_functions": len(reachable),
        "assessments": assessments,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("graph", type=Path)
    parser.add_argument("--profile", action="append", choices=sorted(PROFILES), required=True)
    args = parser.parse_args(argv)
    try:
        raw = args.graph.read_bytes()
        graph = parse_bytes(raw)
        result = analyze(graph, list(dict.fromkeys(args.profile)))
    except (InvalidGraph, OSError) as exc:
        print(f"effect-closure input rejected: {exc}", file=sys.stderr)
        return 3
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if all(a["compatible_with_declared_facts"] for a in result["assessments"].values()) else 2


if __name__ == "__main__":
    sys.exit(main())
