#!/usr/bin/env python3
"""Experimental Oreslang callback timing/order fact checker, NOT a source compiler.

Facts must be generated and validated by a trusted compiler before using results
for security/strict-profile decisions. This reference cannot prove program safety.
"""
from collections import deque

VERSION = "ores-callback-facts/v0"
TIMINGS = {"inline", "deferred", "after_actor_turn", "mixed", "unknown"}
KINDS = {"noop", "subscribe", "unsubscribe", "publish", "launch"}

class InvalidFacts(ValueError):
    pass

def check(value, message):
    if not value:
        raise InvalidFacts(message)

def ident(value):
    return type(value) is str and 0 < len(value) <= 256

def key(p):
    check(type(p) is dict and set(p) == {"emitter", "event"}, "invalid event key")
    check(ident(p["emitter"]) and ident(p["event"]), "invalid event identity")
    return (p["emitter"], p["event"])

def validate(doc):
    check(type(doc) is dict and set(doc) == {"version", "procedures"}, "invalid document")
    check(doc["version"] == VERSION, "invalid callback facts version")
    check(type(doc["procedures"]) is list and len(doc["procedures"]) <= 1000, "invalid procedures")
    names = set()
    for proc in doc["procedures"]:
        check(type(proc) is dict and set(proc) == {"id", "entry", "nodes"}, "invalid procedure")
        check(ident(proc["id"]) and proc["id"] not in names, "duplicate/invalid procedure")
        names.add(proc["id"])
        check(type(proc["nodes"]) is list and len(proc["nodes"]) <= 10000, "invalid nodes")
        ids = set()
        for node in proc["nodes"]:
            check(type(node) is dict and {"id", "kind", "next"} <= node.keys(), "invalid node")
            check(node["kind"] in KINDS and ident(node["id"]) and node["id"] not in ids, "invalid node id/kind")
            ids.add(node["id"])
            check(type(node["next"]) is list and len(node["next"]) <= 64 and
                  all(ident(n) for n in node["next"]), "invalid next")
            required = {"id", "kind", "next"}
            if node["kind"] in {"subscribe", "unsubscribe", "publish"}:
                required |= {"emitter", "event"}
                key({"emitter": node.get("emitter"), "event": node.get("event")})
            if node["kind"] == "launch":
                required |= {"api", "timing", "publishes"}
                check(ident(node.get("api")) and node.get("timing") in TIMINGS, "invalid callback API/timing")
                check(type(node.get("publishes")) is list and len(node["publishes"]) <= 128, "invalid publications")
                for pub in node["publishes"]:
                    check(type(pub) is dict and set(pub) == {"emitter", "event"}, "invalid publication")
                    key(pub)
            check(set(node) == required, "unexpected or missing node fields")
        check(proc["entry"] in ids, "missing entry")
        check(all(n in ids for node in proc["nodes"] for n in node["next"]), "unknown successor")

def analyze(doc):
    validate(doc)
    findings = []
    for proc in doc["procedures"]:
        nodes = {node["id"]: node for node in proc["nodes"]}
        # All subscriptions that might be needed. This prototype does not yet
        # infer which registrations are semantically required on each branch.
        registered_ever = {(n["emitter"], n["event"]) for n in nodes.values() if n["kind"] == "subscribe"}
        in_sets = {proc["entry"]: frozenset()}
        queue = deque([proc["entry"]])
        while queue:
            nid = queue.popleft()
            n = nodes[nid]
            after = set(in_sets[nid])
            if n["kind"] == "subscribe":
                after.add((n["emitter"], n["event"]))
            if n["kind"] == "unsubscribe":
                after.discard((n["emitter"], n["event"]))
            for dest in n["next"]:
                prior = in_sets.get(dest)
                merged = frozenset(after) if prior is None else prior & frozenset(after)
                if prior is None or merged != prior:
                    in_sets[dest] = merged
                    queue.append(dest)
        for nid in sorted(in_sets):
            n = nodes[nid]
            def add(rule, message, ev=None):
                witness = [proc["id"], nid]
                if ev is not None:
                    witness += list(ev)
                findings.append({"rule": rule, "confidence": "potential", "message": message, "witness": witness})
            if n["kind"] == "launch" and n["timing"] in {"mixed", "unknown"}:
                add("ORES-CB-001", f"{n['api']} callback timing is {n['timing']}")
            publications = []
            if n["kind"] == "publish":
                publications = [(n["emitter"], n["event"])]
            elif n["kind"] == "launch":
                publications = [key(pub) for pub in n["publishes"]]
            for ev in sorted(set(publications)):
                if ev in registered_ever and ev not in in_sets[nid]:
                    add("ORES-CB-002", "non-replaying event may publish before subscription", ev)
    return sorted(findings, key=lambda x: (x["rule"], x["witness"]))
