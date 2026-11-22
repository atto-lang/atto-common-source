#!/usr/bin/env python3
"""Strict source-free checker for AttoLang typed-effect interchange v1.

This program validates caller-supplied facts, not compiler provenance.
A clean verdict is NOT runtime/capability/AOT/RT certification.
"""
import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import re
import sys

KIND = "attolang.typed-effects/v1"
ASSURANCE = "COMPILER_TYPED_IR_OBSERVATION_NOT_RUNTIME_CERTIFICATION"
EFFECTS = frozenset(("throw", "raise", "panic", "suspend", "block", "alloc",
    "state.read", "state.write", "io", "io.file.read", "io.file.write",
    "io.net", "io.env", "io.clock", "io.entropy", "ffi", "nondet",
    "spawns", "actor.send"))
BACKENDS = frozenset(("java", "llvm", "net", "wasm", "forge", "rs",
    "cranelift", "js", "hdl", "atto", "realtime", "reference"))
ID = re.compile(r"[A-Za-z_][A-Za-z0-9_.$:/-]{0,127}\Z")
SHA1 = re.compile(r"[a-f0-9]{40}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
MAX_BYTES = 1024 * 1024
MAX_EDGES = 65536
PROFILES = ("pure", "deterministic", "no_alloc", "hard_rt_screen")


class InvalidEffectReport(ValueError):
    pass


def need(ok, reason):
    if not ok:
        raise InvalidEffectReport(reason)


def exact(obj, names, where):
    need(type(obj) is dict and set(obj) == set(names), where + ": unknown/missing fields")


def unique_pairs(pairs):
    o = {}
    for k, v in pairs:
        need(k not in o, "duplicate JSON key " + k)
        o[k] = v
    return o


def parse(raw):
    need(type(raw) is bytes and len(raw) <= MAX_BYTES, "effect report byte budget")
    try:
        doc = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise InvalidEffectReport("invalid effect report JSON") from error
    validate(doc)
    return doc


def string_id(x):
    return type(x) is str and ID.fullmatch(x) is not None


def unique_list(x, maximum, predicate, where):
    need(type(x) is list and len(x) <= maximum
         and all(predicate(v) for v in x)
         and len(x) == len(set(x)), where + ": invalid or duplicate values")


def validate(doc):
    exact(doc, ("version", "kind", "assurance", "producer", "entries", "functions"), "root")
    need(type(doc["version"]) is int and doc["version"] == 1, "version")
    need(doc["kind"] == KIND and doc["assurance"] == ASSURANCE, "status/identity")
    p = doc["producer"]
    exact(p, ("backend", "revision", "source_sha256", "typed_ir_digest"), "producer")
    need(p["backend"] in BACKENDS and type(p["revision"]) is str and SHA1.fullmatch(p["revision"])
         and type(p["source_sha256"]) is str and SHA256.fullmatch(p["source_sha256"])
         and type(p["typed_ir_digest"]) is str and SHA256.fullmatch(p["typed_ir_digest"]),
         "producer identity claims malformed")
    functions = doc["functions"]
    need(type(functions) is list and 1 <= len(functions) <= 4096, "functions budget")
    unique_list(doc["entries"], 64, string_id, "entries")
    need(bool(doc["entries"]), "empty entries")
    ids, edges = set(), 0
    for i, f in enumerate(functions):
        exact(f, ("id", "closure", "direct_effects", "calls", "work", "declared_bound"),
              "functions[%s]" % i)
        name = f["id"]
        need(string_id(name) and name not in ids, "invalid or duplicate function id")
        ids.add(name)
        need(f["closure"] in ("complete", "unknown"), "closure")
        unique_list(f["direct_effects"], 32, lambda x: type(x) is str and x in EFFECTS,
                    "direct_effects")
        if f["declared_bound"] is not None:
            unique_list(f["declared_bound"], 32,
                        lambda x: type(x) is str and x in EFFECTS,
                        "declared_bound")
        need(f["work"] in ("bounded_claim", "unbounded", "unknown"), "work")
        observed = set(f["direct_effects"])
        if observed.intersection({"io.clock", "io.entropy", "io.env", "io.file.read"}):
            need("nondet" in observed, "ambient direct observation must include nondet")
        calls = f["calls"]
        need(type(calls) is list and len(calls) <= 256, "calls budget")
        for call in calls:
            exact(call, ("kind", "targets", "phase"), "call")
            need(call["kind"] in ("direct", "sealed_dynamic", "unknown"), "call kind")
            need(call["phase"] in ("immediate", "latent_start", "latent_poll", "cleanup"), "call phase")
            unique_list(call["targets"], 128, string_id, "call targets")
            if call["kind"] == "unknown":
                need(not call["targets"], "unknown call may not forge targets")
            else:
                need(bool(call["targets"]), "resolved call needs nonempty targets")
            edges += len(call["targets"])
            need(edges <= MAX_EDGES, "call graph budget")
    need(all(x in ids for x in doc["entries"]), "entry unresolved")
    for f in functions:
        for call in f["calls"]:
            need(all(t in ids for t in call["targets"]),
                 "unresolved target in " + f["id"])


def analyze(doc, profiles):
    validate(doc)
    nodes = {x["id"]: x for x in doc["functions"]}
    seen = set()
    pending = list(doc["entries"])
    while pending:
        n = pending.pop()
        if n in seen:
            continue
        seen.add(n)
        pending.extend(t for c in nodes[n]["calls"] for t in c["targets"])
    # Unknown source/dispatch/FFI summaries are not an empty set.
    for name in seen:
        fn = nodes[name]
        if fn["closure"] != "complete" or any(c["kind"] == "unknown" for c in fn["calls"]):
            raise InvalidEffectReport("E_EFFECT_UNKNOWN: incomplete reachable typed closure at " + name)
    rows = {n: set(nodes[n]["direct_effects"]) for n in seen}
    parents = {n: set() for n in seen}
    for n in seen:
        for c in nodes[n]["calls"]:
            for t in c["targets"]:
                parents[t].add(n)
    work = deque(sorted(seen))
    queued = set(work)
    while work:
        name = work.popleft()
        queued.remove(name)
        merged = set(nodes[name]["direct_effects"])
        for call in nodes[name]["calls"]:
            for callee in call["targets"]:
                merged.update(rows[callee])
        if merged != rows[name]:
            rows[name] = merged
            for parent in sorted(parents[name]):
                if parent not in queued:
                    work.append(parent)
                    queued.add(parent)
    # A bound of null means infer, [] is a declared empty upper bound.
    for name in sorted(seen):
        bound = nodes[name]["declared_bound"]
        if bound is not None:
            outside = rows[name] - set(bound)
            outside = {e for e in outside if not (e.startswith("io.") and "io" in bound)}
            if outside:
                raise InvalidEffectReport("E_EFFECT_BOUND: " + name + " exceeds explicit upper bound: " + ",".join(sorted(outside)))
    entry_effects = set().union(*(rows[e] for e in doc["entries"]))
    forbidden = {
        "pure": {"state.read", "state.write", "ffi", "nondet", "spawns", "actor.send", "block"},
        "deterministic": {"state.read", "state.write", "ffi", "nondet", "spawns", "actor.send", "block"},
        "no_alloc": {"alloc"},
        "hard_rt_screen": EFFECTS,
    }
    results = {}
    for profile in profiles:
        need(profile in PROFILES, "invalid profile")
        denied = entry_effects & forbidden[profile]
        if profile in ("pure", "deterministic"):
            denied.update(e for e in entry_effects if e == "io" or e.startswith("io."))
        elif profile == "hard_rt_screen":
            for n in seen:
                if nodes[n]["work"] != "bounded_claim":
                    denied.add("unbounded_work")
            indegree = {n: 0 for n in seen}
            for n in seen:
                for c in nodes[n]["calls"]:
                    for t in c["targets"]:
                        indegree[t] += 1
            ready = deque(n for n in seen if indegree[n] == 0)
            removed = 0
            while ready:
                n = ready.popleft()
                removed += 1
                for c in nodes[n]["calls"]:
                    for t in c["targets"]:
                        indegree[t] -= 1
                        if indegree[t] == 0:
                            ready.append(t)
            if removed != len(seen):
                denied.add("unbounded_recursion")
        results[profile] = {
            "compatible_with_claimed_facts": not denied,
            "denied_effects": sorted(denied),
            "entry_inferred": {e: sorted(rows[e]) for e in sorted(doc["entries"])},
        }
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return {
        "status": "UNTRUSTED_INPUT_SOURCE_FREE_MODEL_NOT_COMPILER_CERTIFICATE",
        "canonical_input_sha256": hashlib.sha256(canonical).hexdigest(),
        "producer_revision_claim": doc["producer"]["revision"],
        "profiles": results
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--profile", choices=PROFILES, action="append", required=True)
    args = parser.parse_args(argv)
    try:
        with args.report.open("rb") as f:
            doc = parse(f.read(MAX_BYTES + 1))
        report = analyze(doc, sorted(set(args.profile)))
    except (InvalidEffectReport, OSError) as error:
        print(error, file=sys.stderr)
        return 3
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if all(x["compatible_with_claimed_facts"] for x in report["profiles"].values()) else 2


if __name__ == "__main__":
    sys.exit(main())
