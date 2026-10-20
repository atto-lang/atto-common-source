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
    obj(doc, "facts", {"version", "unit", *LIMITS}, {"callback_orderings"})
    require(doc["version"] == VERSION, "unsupported version")
    ident(doc["unit"], "unit")
    for key, cap in {**LIMITS, "callback_orderings": 10000}.items():
        values = doc.get(key, [])
        require(type(values) is list and len(values) <= cap, f"{key}: invalid length")
    procedures = set()
    loops_by_proc = {}
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
            require(loop["exit"] in ("proved_terminates", "proved_no_exit", "unknown"), "bad loop exit")
            require(type(loop["safepoint"]) is bool, "bad loop safepoint")
            location(loop.get("location"), "loop location")
        loops_by_proc[p["id"]] = loop_ids
    for edge in doc["edges"]:
        obj(edge, "edge", {"from", "to", "kind", "fanout", "guard"}, {"location", "enclosing_loop"})
        ident(edge["from"], "edge from")
        ident(edge["to"], "edge to")
        require(edge["from"] in procedures and edge["to"] in procedures, "unknown procedure on edge")
        require(edge["kind"] in EDGE_KINDS, "unknown edge kind")
        require(edge["fanout"] == "unknown" or
                (type(edge["fanout"]) is int and 1 <= edge["fanout"] <= 1000000), "bad fanout")
        require(edge["guard"] in ("proved_bounded", "unproved"), "bad guard")
        if "enclosing_loop" in edge:
            ident(edge["enclosing_loop"], "enclosing loop")
            require(edge["enclosing_loop"] in loops_by_proc[edge["from"]], "unknown enclosing loop")
        location(edge.get("location"), "edge location")
    callbacks_seen = set()
    for event in doc.get("callback_orderings", []):
        obj(event, "callback ordering", {"id", "emitter", "event", "publisher",
             "invocation_timing", "order", "registration_continuation", "registration_completion"}, {"location"})
        for field in ("id", "emitter", "publisher", "event"):
            ident(event[field], "callback " + field)
        require(event["id"] not in callbacks_seen, "duplicate callback ordering id")
        callbacks_seen.add(event["id"])
        require(event["invocation_timing"] in ("inline_only", "deferred_after_turn",
             "concurrent", "mixed", "unknown"), "bad callback timing")
        require(event["order"] in ("publish_first", "register_first", "unknown"),
                "bad registration order")
        require(event["registration_continuation"] in ("same_uninterrupted_turn",
             "may_suspend", "unknown"), "bad registration continuation")
        require(event["registration_completion"] in ("proved_sync_install", "unproved"),
                "bad registration completion")
        location(event.get("location"), "callback event location")
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


def cycle_witness(edges):
    """Produce a real directed cycle, prioritizing the high-fanout edge."""
    ordered = sorted(edges, key=lambda e: (
        0 if e["fanout"] == "unknown" or e["fanout"] > 1 else 1,
        e["from"], e["to"], e["kind"]))
    first = ordered[0]
    adjacency = defaultdict(list)
    for edge in edges:
        adjacency[edge["from"]].append(edge["to"])
    for key in adjacency:
        adjacency[key] = sorted(set(adjacency[key]))
    start, goal = first["to"], first["from"]
    queue, parent = deque([start]), {start: None}
    while queue and goal not in parent:
        current = queue.popleft()
        for nxt in adjacency[current]:
            if nxt not in parent:
                parent[nxt] = current
                queue.append(nxt)
    if goal not in parent:
        raise InvalidFacts("inconsistent SCC witness")
    path = []
    current = goal
    while current is not None:
        path.append(current)
        current = parent[current]
    path.reverse()
    return [goal] + path


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
            if loop["exit"] != "proved_terminates" and not loop["safepoint"]:
                result.append(finding("ORES-TERM-003", "error", "potential",
                    f"{proc['id']}: loop {loop['id']} may monopolize a scheduler worker", at, [proc["id"], loop["id"]]))
    loop_index = {(p["id"], loop["id"]): loop
                  for p in doc["procedures"] for loop in p["loops"]}
    for edge in doc["edges"]:
        loop_id = edge.get("enclosing_loop")
        if (loop_id is not None and
                loop_index[(edge["from"], loop_id)]["exit"] != "proved_terminates" and
                edge["kind"] in {"actor_spawn", "task_spawn", "message", "retry", "supervisor_restart"}):
            result.append(finding("ORES-AMP-005", "warning", "potential",
                f"{edge['from']}: repeatable {edge['kind']} inside loop {loop_id} with unproved finite bound",
                edge.get("location"), [edge["from"], loop_id, edge["to"]]))
    open_edges = [e for e in doc["edges"] if e["guard"] == "unproved"]
    for comp in strongly_connected((p["id"] for p in doc["procedures"]), open_edges):
        members = set(comp)
        contained = [e for e in open_edges if e["from"] in members and e["to"] in members]
        if not contained or (len(comp) == 1 and not any(e["from"] == e["to"] for e in contained)):
            continue
        kinds = {e["kind"] for e in contained}
        amplified = any(e["fanout"] == "unknown" or e["fanout"] > 1 for e in contained)
        if "actor_spawn" in kinds:
            rule, label = "ORES-AMP-001", "actor creation"
        elif "task_spawn" in kinds:
            rule, label = "ORES-AMP-002", "task creation"
        elif kinds & {"message", "retry", "supervisor_restart"}:
            rule, label = "ORES-AMP-003", "asynchronous event/retry work"
        else:
            rule, label = "ORES-AMP-004", "synchronous recursion/callback work"
        qualifier = "unknown or multiplicative fanout" if amplified else "repeated work"
        at = next((e["location"] for e in contained if "location" in e), None)
        result.append(finding(rule, "error" if amplified else "warning", "potential",
            f"Unbounded cycle can generate {label} ({qualifier}); a finite total-cycle bound is unproved",
            at, cycle_witness(contained)))
    # One reproducible shortest witness per sink, using at most one
    # multi-source BFS per risk (not quadratic source x sink traversals).
    sinks_by_risk = defaultdict(list)
    for sink in doc["sinks"]:
        sinks_by_risk[sink["risk"]].append(sink)
    for risk in sorted(sinks_by_risk):
        adjacency = defaultdict(list)
        for flow in doc["flows"]:
            # These validation facts are trusted ONLY when supplied by a verified compiler.
            if risk not in flow.get("validated_for", []):
                adjacency[flow["from"]].append(flow["to"])
        for key in adjacency:
            adjacency[key] = sorted(set(adjacency[key]))
        source_class = "secret" if risk == "secret_log" else "untrusted"
        origins = sorted({src["id"] for src in doc["taint_sources"] if src["class"] == source_class})
        parent = {origin: None for origin in origins}
        queue = deque(origins)
        while queue:
            current = queue.popleft()
            for nxt in adjacency[current]:
                if nxt not in parent:
                    parent[nxt] = current
                    queue.append(nxt)
        for sink in sorted(sinks_by_risk[risk], key=lambda item: item["id"]):
            if sink["id"] not in parent:
                continue
            path = []
            current = sink["id"]
            while current is not None:
                path.append(current)
                current = parent[current]
            path.reverse()
            result.append(finding("ORES-SEC-001", "error", "potential",
                f"{source_class} flow to {risk} sink without risk-specific validation",
                sink.get("location"), path))
    for event in doc.get("callback_orderings", []):
        timing = event["invocation_timing"]
        order = event["order"]
        continuation = event["registration_continuation"]
        install = event["registration_completion"] == "proved_sync_install"
        if order == "register_first" and install:
            continue
        # Deferred-after-current-turn is safe only if registration is
        # guaranteed to complete without suspension/failure in that turn.
        if (order == "publish_first" and timing == "deferred_after_turn"
                and continuation == "same_uninterrupted_turn" and install):
            continue
        rule = "ORES-ZALGO-001" if order == "publish_first" else "ORES-ZALGO-002"
        result.append(finding(rule, "warning", "potential",
            f"{event['publisher']}: callback timing {timing} and registration order "
            f"{order}; listener for {event['emitter']}.{event['event']} may miss emission",
            event.get("location"),
            [event["publisher"], event["emitter"] + "." + event["event"]]))
    for check in doc["permission_checks"]:
        unauthorized = sorted(set(check["requested"]) - set(check["ceiling"]))
        if unauthorized:
            result.append(finding("ORES-SEC-002", "error", "proven",
                f"{check['id']}: declared capability ceiling excludes required effects: {', '.join(unauthorized)}",
                check.get("location"), [check["id"]]))
    return sorted(result, key=lambda x: (x["rule"], tuple(x.get("witness", [])), x["message"]))


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidFacts(f"duplicate JSON field: {key[:80]}")
        result[key] = value
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("facts", type=Path, help="verified compiler-facts JSON (not .ores source)")
    parser.add_argument("--fail-on", choices=("never", "error", "warning"), default="never")
    args = parser.parse_args(argv)
    try:
        require(args.facts.stat().st_size <= MAX_INPUT_BYTES, "input too large")
        doc = json.loads(args.facts.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
        results = analyze(doc)
    except (OSError, UnicodeError, ValueError, TypeError, RecursionError) as error:
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
