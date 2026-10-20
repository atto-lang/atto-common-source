#!/usr/bin/env python3
"""Experimental reference checker over compiler-supplied Oreslang semantic facts.

This is NOT a source analyzer, a verifier of producer assertions, or a security proof.
It deliberately emits potential warnings for undecidable dynamic behavior.
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
import json
from pathlib import Path
import sys

VERSION = "ores-static-facts/v0"
EDGE_KINDS = {"call", "actor_spawn", "task_spawn", "message", "callback", "supervisor_restart", "retry"}
RISKS = {"shell", "raw_sql", "file_path", "network_destination", "html", "ffi_pointer", "secret_log"}
PERMISSIONS = {"read", "write", "net", "env", "run", "sys", "ffi", "import"}
LIMITS = {"procedures": 10000, "edges": 50000, "taint_sources": 10000, "flows": 50000, "sinks": 10000, "permission_checks": 10000}
MAX_INPUT_BYTES = 8 * 1024 * 1024


class InvalidFacts(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidFacts(message)


def obj(value, name, required, optional=()):
    require(type(value) is dict, f"{name}: expected object")
    require(set(required) <= value.keys(), f"{name}: missing fields: {sorted(set(required)-value.keys())}")
    require(value.keys() <= set(required) | set(optional), f"{name}: unsupported fields: {sorted(value.keys()-(set(required)|set(optional)))}")


def ident(value, where):
    require(type(value) is str and 0 < len(value) <= 256, f"{where}: invalid id")


def location(value, where):
    if value is None:
        return
    obj(value, where, {"path", "line"})
    require(type(value["path"]) is str and 0 < len(value["path"]) <= 512, f"{where}: invalid path")
    require(type(value["line"]) is int and 1 <= value["line"] <= 200000000, f"{where}: invalid line")


def validate(doc):
    obj(doc, "facts", {"version", "unit", *LIMITS})
    require(doc["version"] == VERSION, "unsupported version")
    ident(doc["unit"], "unit")
    for key, cap in LIMITS.items():
        require(type(doc[key]) is list and len(doc[key]) <= cap, f"{key}: invalid length")
    procedures = set()
    for p in doc["procedures"]:
        obj(p, "procedure", {"id", "loops"})
        ident(p["id"], "procedure id")
        require(p["id"] not in procedures, "duplicate procedure id")
        procedures.add(p["id"])
        require(type(p["loops"]) is list and len(p["loops"]) <= 20000, "invalid loops")
        loop_ids = set()
        for loop in p["loops"]:
            obj(loop, "loop", {"id", "exit", "safepoint"}, {"location"})
            ident(loop["id"], "loop id")
            require(loop["id"] not in loop_ids, "duplicate loop id")
            loop_ids.add(loop["id"])
            require(loop["exit"] in ("proved_exit", "proved_no_exit", "unknown"), "bad loop exit")
            require(type(loop["safepoint"]) is bool, "bad loop safepoint")
            location(loop.get("location"), "loop location")
    for edge in doc["edges"]:
        obj(edge, "edge", {"from", "to", "kind", "fanout", "guard"}, {"location"})
        ident(edge["from"], "edge from")
        ident(edge["to"], "edge to")
        require(edge["from"] in procedures and edge["to"] in procedures, "unknown procedure on edge")
        require(edge["kind"] in EDGE_KINDS, "unknown edge kind")
        require(type(edge["fanout"]) is int and 1 <= edge["fanout"] <= 1000000, "bad fanout")
        require(edge["guard"] in ("proved_bounded", "unproved"), "bad guard")
        location(edge.get("location"), "edge location")
    for source in doc["taint_sources"]:
        obj(source, "taint source", {"id", "class"}, {"location"})
        ident(source["id"], "taint source id")
        require(source["class"] in ("untrusted", "secret"), "bad taint class")
        location(source.get("location"), "taint source location")
    for flow in doc["flows"]:
        obj(flow, "flow", {"from", "to"}, {"validated_for", "location"})
        ident(flow["from"], "flow from")
        ident(flow["to"], "flow to")
        risks = flow.get("validated_for", [])
        require(type(risks) is list and len(risks) == len(set(risks)) and set(risks) <= RISKS, "bad flow validation")
        location(flow.get("location"), "flow location")
    for sink in doc["sinks"]:
        obj(sink, "sink", {"id", "risk"}, {"location"})
        ident(sink["id"], "sink id")
        require(sink["risk"] in RISKS, "bad sink risk")
        location(sink.get("location"), "sink location")
    for check in doc["permission_checks"]:
        obj(check, "permission check", {"id", "requested", "ceiling"}, {"location"})
        ident(check["id"], "permission check id")
        for field in ("requested", "ceiling"):
            values = check[field]
            require(type(values) is list and len(values) == len(set(values)) and set(values) <= PERMISSIONS, "bad permission set")
        location(check.get("location"), "permission check location")


def finding(rule, severity, confidence, message, location=None, witness=None):
    result = {"rule": rule, "severity": severity, "confidence": confidence, "message": message}
    if location is not None:
        result["location"] = location
    if witness:
        result["witness"] = witness
    return result


def strongly_connected(nodes, edges):
    """Deterministic iterative Kosaraju SCCs; no recursion-depth failure on large graphs."""
    forward, reverse = defaultdict(list), defaultdict(list)
    for e in edges:
        forward[e["from"]].append(e["to"])
        reverse[e["to"]].append(e["from"])
    for adjacency in (forward, reverse):
        for key in adjacency:
            adjacency[key] = sorted(set(adjacency[key]))
    seen, order = set(), []
    for node in sorted(nodes):
        if node in seen:
            continue
        seen.add(node)
        stack = [(node, iter(forward[node]))]
        while stack:
            cur, neighbors = stack[-1]
            nxt = next(neighbors, None)
            if nxt is None:
                order.append(cur)
                stack.pop()
            elif nxt not in seen:
                seen.add(nxt)
                stack.append((nxt, iter(forward[nxt])))
    seen.clear()
    components = []
    for node in reversed(order):
        if node in seen:
            continue
        seen.add(node)
        comp = []
        stack = [node]
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nxt in reverse[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        components.append(sorted(comp))
    return components


def analyze(doc):
    validate(doc)
    result = []
    for proc in doc["procedures"]:
        for loop in proc["loops"]:
            at = loop.get("location")
            if loop["exit"] == "proved_no_exit":
                result.append(finding("ORES-TERM-001", "error", "proven",
                    f"{proc['id']}: loop {loop['id']} has no CFG exit", at, [proc["id"], loop["id"]]))
            elif loop["exit"] == "unknown":
                result.append(finding("ORES-TERM-002", "warning", "potential",
                    f"{proc['id']}: loop {loop['id']} termination not established", at, [proc["id"], loop["id"]]))
            if loop["exit"] != "proved_exit" and not loop["safepoint"]:
                result.append(finding("ORES-TERM-003", "error", "potential",
                    f"{proc['id']}: loop {loop['id']} may monopolize a scheduler worker", at, [proc["id"], loop["id"]]))
    open_edges = [e for e in doc["edges"] if e["guard"] == "unproved"]
    for comp in strongly_connected((p["id"] for p in doc["procedures"]), open_edges):
        members = set(comp)
        contained = [e for e in open_edges if e["from"] in members and e["to"] in members]
        if not contained or (len(comp) == 1 and not any(e["from"] == e["to"] for e in contained)):
            continue
        kinds = {e["kind"] for e in contained}
        amplified = any(e["fanout"] > 1 for e in contained)
        if "actor_spawn" in kinds:
            rule, label = "ORES-AMP-001", "actor creation"
        elif "task_spawn" in kinds:
            rule, label = "ORES-AMP-002", "task creation"
        elif kinds & {"message", "retry", "supervisor_restart"}:
            rule, label = "ORES-AMP-003", "asynchronous event/retry work"
        else:
            rule, label = "ORES-AMP-004", "synchronous recursion/callback work"
        qualifier = "multiplicative fanout" if amplified else "repeated work"
        at = next((e["location"] for e in contained if "location" in e), None)
        result.append(finding(rule, "error" if amplified else "warning", "potential",
            f"Unbounded cycle can generate {label} ({qualifier}); a finite total-cycle bound is unproved",
            at, comp))
    for sink in doc["sinks"]:
        risk = sink["risk"]
        adjacency = defaultdict(list)
        for e in doc["flows"]:
            # Only verified producer facts may supply sanitizer evidence.
            if risk not in e.get("validated_for", []):
                adjacency[e["from"]].append(e["to"])
        for key in adjacency:
            adjacency[key] = sorted(set(adjacency[key]))
        source_class = "secret" if risk == "secret_log" else "untrusted"
        for source in doc["taint_sources"]:
            if source["class"] != source_class:
                continue
            origin, dest = source["id"], sink["id"]
            queue, parent = deque([origin]), {origin: None}
            while queue and dest not in parent:
                current = queue.popleft()
                for nxt in adjacency[current]:
                    if nxt not in parent:
                        parent[nxt] = current
                        queue.append(nxt)
            if dest in parent:
                path = []
                current = dest
                while current is not None:
                    path.append(current)
                    current = parent[current]
                path.reverse()
                result.append(finding("ORES-SEC-001", "error", "potential",
                    f"{source_class} flow to {risk} sink without risk-specific validation",
                    sink.get("location"), path))
    for check in doc["permission_checks"]:
        unauthorized = sorted(set(check["requested"]) - set(check["ceiling"]))
        if unauthorized:
            result.append(finding("ORES-SEC-002", "error", "proven",
                f"{check['id']}: declared capability ceiling excludes required effects: {', '.join(unauthorized)}",
                check.get("location"), [check["id"]]))
    return sorted(result, key=lambda x: (x["rule"], tuple(x.get("witness", [])), x["message"]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("facts", type=Path, help="verified compiler-facts JSON (not .ores source)")
    parser.add_argument("--fail-on", choices=("never", "error", "warning"), default="never")
    args = parser.parse_args(argv)
    try:
        require(args.facts.stat().st_size <= MAX_INPUT_BYTES, "input too large")
        doc = json.loads(args.facts.read_text(encoding="utf-8"))
        results = analyze(doc)
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        print(f"invalid facts: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"version": VERSION, "unit": doc["unit"], "findings": results},
        sort_keys=True, separators=(",", ":")))
    if args.fail_on == "warning" and results:
        return 1
    if args.fail_on == "error" and any(x["severity"] == "error" for x in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
