#!/usr/bin/env python3
"""Experimental Oreslang callback temporal/effect reference checker over *facts*.

NOT a .ores parser, compiler fact producer, alias prover or security certificate.
Only a trusted typed-IR producer may use these findings for strict admission.
All `next` successors must include exceptional/cancellation/async control edges.
"""
from collections import deque
import argparse
import json
from pathlib import Path
import sys

VERSION = "ores-callback-facts/v0"
TIMINGS = {"inline", "deferred", "after_actor_turn", "mixed", "unknown"}
LANES = {"same_continuation", "actor_lane", "other_worker", "unknown"}
KINDS = {"noop", "subscribe", "unsubscribe", "publish", "launch", "await", "end_turn", "request_subscribe"}
MULTIPLICITY = {"at_most_once", "many", "unknown"}
MAX_BYTES = 8 * 1024 * 1024

class InvalidFacts(ValueError):
    pass

def check(value, message):
    if not value:
        raise InvalidFacts(message)

def ident(value):
    return type(value) is str and 0 < len(value) <= 256

def key(p):
    check(type(p) is dict and {"emitter", "event"} <= p.keys(), "invalid event key")
    check(ident(p["emitter"]) and ident(p["event"]), "invalid event identity")
    return p["emitter"], p["event"]

def may_alias(a, b):
    return all(x == y or x == "*" or y == "*" for x, y in zip(a, b))

def exact(a, b):
    return a == b and "*" not in a

def validate(doc):
    check(type(doc) is dict and set(doc) == {"version", "procedures"}, "invalid document")
    check(doc["version"] == VERSION, "invalid callback facts version")
    check(type(doc["procedures"]) is list and len(doc["procedures"]) <= 1000, "invalid procedures")
    names = set()
    for proc in doc["procedures"]:
        check(type(proc) is dict and {"id", "entry", "nodes"} <= proc.keys() and
              set(proc) <= {"id", "entry", "nodes", "strict"}, "invalid procedure")
        check(ident(proc["id"]) and proc["id"] not in names, "duplicate/invalid procedure")
        names.add(proc["id"])
        check(type(proc.get("strict", False)) is bool, "invalid strict flag")
        check(type(proc["nodes"]) is list and 0 < len(proc["nodes"]) <= 10000, "invalid nodes")
        ids = set()
        for node in proc["nodes"]:
            check(type(node) is dict and {"id", "kind", "next"} <= node.keys(), "invalid node")
            check(node["kind"] in KINDS and ident(node["id"]) and node["id"] not in ids, "invalid node id/kind")
            ids.add(node["id"])
            check(type(node["next"]) is list and len(node["next"]) <= 64 and
                  all(ident(n) for n in node["next"]) and
                  len(set(node["next"])) == len(node["next"]), "invalid next")
            required = {"id", "kind", "next"}
            optional = set()
            if node["kind"] in {"subscribe", "request_subscribe", "unsubscribe", "publish"}:
                required |= {"emitter", "event"}
                key({"emitter": node.get("emitter"), "event": node.get("event")})
            if node["kind"] == "launch":
                required |= {"api", "timing", "publishes"}
                optional |= {"lane", "serial_turn_proven", "invocations", "expected_invocations", "captures", "locks_held", "active_mutable_loans"}
                check(ident(node.get("api")) and node.get("timing") in TIMINGS, "invalid callback API/timing")
                check(node.get("lane", "unknown") in LANES, "invalid callback lane")
                check(type(node.get("serial_turn_proven", False)) is bool, "invalid turn serialization proof")
                check(node.get("invocations", "unknown") in MULTIPLICITY, "invalid invocation count")
                check(node.get("expected_invocations", "many") in {"at_most_once", "many"}, "invalid callback expectation")
                check(type(node.get("publishes")) is list and len(node["publishes"]) <= 128, "invalid publications")
                for pub in node["publishes"]:
                    check(type(pub) is dict and {"emitter", "event"} <= pub.keys() and
                          set(pub) <= {"emitter", "event", "replayable"}, "invalid publication")
                    key(pub)
                    check(type(pub.get("replayable", False)) is bool, "invalid replayability")
                for field in ("locks_held", "active_mutable_loans"):
                    xs = node.get(field, [])
                    check(type(xs) is list and len(xs) <= 128 and len(set(xs)) == len(xs) and
                          all(ident(x) for x in xs), "invalid active lock/loan")
                captures = node.get("captures", [])
                check(type(captures) is list and len(captures) <= 128, "invalid captures")
                captured_names = set()
                for cap in captures:
                    check(type(cap) is dict and set(cap) == {"name", "lifetime", "kind", "sendable"}, "invalid capture")
                    check(ident(cap["name"]) and cap["name"] not in captured_names, "invalid capture name")
                    captured_names.add(cap["name"])
                    check(cap["lifetime"] in {"call", "actor", "static"}, "invalid capture lifetime")
                    check(cap["kind"] in {"shared", "exclusive", "owned"}, "invalid capture kind")
                    check(type(cap["sendable"]) is bool, "invalid capture sendability")
            check(set(node) == required or (required <= set(node) and set(node) <= required | optional),
                  "unexpected or missing node fields")
        check(proc["entry"] in ids, "missing entry")
        check(all(n in ids for node in proc["nodes"] for n in node["next"]), "unknown successor")
        check(not any(n["kind"] == "end_turn" and n["next"] for n in proc["nodes"]),
              "end_turn cannot have successors")

def transfer(subs, node):
    out = set(subs)
    if node["kind"] == "subscribe":
        # Installed listener with compiler-verified synchronous completion;
        # request_subscribe represents a call whose installation is unproven.
        out.add(key(node))
    if node["kind"] == "unsubscribe":
        # Unknown aliases invalidate all potentially matching guarantees.
        out = {ev for ev in out if not may_alias(ev, key(node))}
    return frozenset(out)

def definitely_subscribed(subs, event):
    # A wildcard alias must never establish a *definite* registration.
    return any(exact(existing, event) for existing in subs)

def same_turn_subscribed(nodes, launch, event):
    """Prove subscription on every reachable path before actor-turn handoff.

    Only sound if `after_actor_turn` + `actor_lane` is a verified runtime
    scheduling contract. The fact producer must include exceptional edges.
    """
    queue = deque((n, frozenset()) for n in launch["next"])
    seen = set()
    saw_boundary = False
    if not queue:
        return False
    while queue:
        if len(seen) > 100000:
            return False  # analysis budget: never invent a proof
        nid, subs = queue.popleft()
        if (nid, subs) in seen:
            continue
        seen.add((nid, subs))
        node = nodes[nid]
        out = transfer(subs, node)
        if node["kind"] in {"await", "end_turn"} or not node["next"]:
            saw_boundary = True
            if not definitely_subscribed(out, event):
                return False
            # Do not continue through a suspended continuation.
            continue
        for nxt in node["next"]:
            queue.append((nxt, out))
    return saw_boundary

def finding(rule, proc, node, message, event=None, severity="warning"):
    witness = [proc["id"], node["id"]]
    if event is not None:
        witness += list(event)
    return {"rule": rule, "severity": severity, "confidence": "potential",
            "message": message, "witness": witness}

def analyze(doc):
    validate(doc)
    findings = []
    for proc in doc["procedures"]:
        nodes = {node["id"]: node for node in proc["nodes"]}
        # One path-insensitive set is used only to identify potentially intended
        # subscriptions. Definite registration uses intersection at CFG joins.
        intended = [key(n) for n in nodes.values() if n["kind"] in {"subscribe", "request_subscribe"}]
        in_sets = {proc["entry"]: frozenset()}
        queue = deque([proc["entry"]])
        while queue:
            nid = queue.popleft()
            node = nodes[nid]
            after = transfer(in_sets[nid], node)
            for dest in node["next"]:
                prior = in_sets.get(dest)
                merged = after if prior is None else prior & after
                if prior is None or merged != prior:
                    in_sets[dest] = merged
                    queue.append(dest)
        for nid in sorted(in_sets):
            node = nodes[nid]
            if node["kind"] == "launch":
                timing = node["timing"]
                lane = node.get("lane", "unknown")
                if timing in {"mixed", "unknown"}:
                    findings.append(finding("ORES-CB-001", proc, node,
                        f"{node['api']}: callback timing is {timing}"))
                escaping = timing != "inline"
                foreign_lane = lane in {"other_worker", "unknown"}
                for cap in node.get("captures", []):
                    if ((cap["kind"] != "owned" and cap["lifetime"] == "call" and escaping)
                        or (cap["lifetime"] == "actor" and foreign_lane and escaping)
                        or (not cap["sendable"] and lane == "other_worker" and escaping)):
                        findings.append(finding("ORES-CB-003", proc, node,
                            f"{node['api']}: captured {cap['name']} may outlive/escape its {cap['lifetime']} ownership domain"))
                if timing in {"inline", "mixed", "unknown"}:
                    held = node.get("locks_held", []) + node.get("active_mutable_loans", [])
                    if held:
                        findings.append(finding("ORES-CB-004", proc, node,
                            f"{node['api']}: callback may reenter with held locks or mutable loans: {', '.join(sorted(held))}"))
                if node.get("expected_invocations") == "at_most_once" and node.get("invocations", "unknown") != "at_most_once":
                    findings.append(finding("ORES-CB-005", proc, node,
                        f"{node['api']}: callback multiplicity cannot prove at-most-once"))
                if proc.get("strict", False) and (timing == "unknown" or lane == "unknown"):
                    findings.append(finding("ORES-CB-006", proc, node,
                        f"{node['api']}: timing/lane unverified in strict profile", severity="error"))
            pubs = []
            if node["kind"] == "publish":
                pubs = [node]
            if node["kind"] == "launch":
                pubs = node["publishes"]
            for pub in pubs:
                ev = key(pub)
                if pub.get("replayable", False):
                    continue
                if not any(may_alias(ev, wanted) for wanted in intended):
                    continue
                if definitely_subscribed(in_sets[nid], ev):
                    continue
                if (node["kind"] == "launch" and node["timing"] == "after_actor_turn"
                    and node.get("lane") == "actor_lane" and node.get("serial_turn_proven") is True
                    and same_turn_subscribed(nodes, node, ev)):
                    continue
                findings.append(finding("ORES-CB-002", proc, node,
                    "non-replaying event may publish before guaranteed subscription", ev))
    return sorted(findings, key=lambda x: (x["rule"], x["witness"], x["message"]))

def no_duplicate_keys(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise InvalidFacts(f"duplicate field: {k[:80]}")
        out[k] = v
    return out

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("facts", type=Path, help="typed-IR callback fact JSON (NOT Oreslang source)")
    parser.add_argument("--fail-on", choices=("never", "error", "warning"), default="never")
    args = parser.parse_args(argv)
    try:
        check(args.facts.stat().st_size <= MAX_BYTES, "facts exceed size limit")
        doc = json.loads(args.facts.read_text(encoding="utf-8"), object_pairs_hook=no_duplicate_keys)
        results = analyze(doc)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        print(f"invalid callback facts: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"version": VERSION, "findings": results}, sort_keys=True, separators=(",", ":")))
    if args.fail_on == "warning" and results:
        return 1
    if args.fail_on == "error" and any(r["severity"] == "error" for r in results):
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
