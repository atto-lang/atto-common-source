"""Provisional layout-independent, scalar FSM trace oracle (not guest execution)."""
from copy import deepcopy

CONTRACT = "ores-fsm-trace-v0"
LIMIT = (1 << 32) - 1
STATES = (0, 1, 2)
REASONS = ("none", "invalid-state", "invalid-ticks", "version-exhausted",
           "guard", "unhandled")


def require(good, message):
    if not good:
        raise ValueError(message)


def snap(state=0, version=0, ticks=0):
    return {"state": state, "version": version, "ticks": ticks}


def step(before, event):
    """Return (accepted,reason,after,effects), without changing before."""
    before = deepcopy(before)
    state, version, ticks = before["state"], before["version"], before["ticks"]
    require(all(type(x) is int and 0 <= x <= LIMIT
                for x in (state, version, ticks)), "snapshot must be u32")
    require(type(event) is int and 0 <= event <= LIMIT, "event must be u32")
    if state not in STATES:
        return False, "invalid-state", before, []
    if ticks > 3:
        return False, "invalid-ticks", before, []
    if version == LIMIT:
        return False, "version-exhausted", before, []
    if state == 0 and event == 0:
        return True, "none", snap(1, version + 1, 0), [1]
    if state == 1 and event == 1:
        if ticks == 3:
            return False, "guard", before, []
        return True, "none", snap(1, version + 1, ticks + 1), [2]
    if state == 1 and event == 2:
        if ticks < 2:
            return False, "guard", before, []
        return True, "none", snap(2, version + 1, ticks), [3]
    if state == 2 and event == 3:
        return True, "none", snap(0, version + 1, 0), [4]
    return False, "unhandled", before, []


def generate(events, entity_count=5):
    """Generate an *abstract* ordered trace; events are (entity,event) pairs."""
    require(type(entity_count) is int and 1 <= entity_count <= 1024, "entity bound")
    require(type(events) is list and len(events) <= 10000, "event list bound")
    entities = [snap() for _ in range(entity_count)]
    steps = []
    for seq, pair in enumerate(events):
        require(type(pair) in (list, tuple) and len(pair) == 2, "bad event pair")
        entity, event = pair
        require(type(entity) is int and 0 <= entity < entity_count, "entity bound")
        before = deepcopy(entities[entity])
        accepted, reason, after, effects = step(before, event)
        steps.append({"seq": seq, "entity": entity, "event": event,
                      "accepted": accepted, "reason": reason, "before": before,
                      "after": after, "effects": effects})
        entities[entity] = after
    return {"contract": CONTRACT, "machine": "flat-fixture-v0",
            "entity_count": entity_count, "transitions": steps}


def validate(trace):
    """Semantic equality checker, stricter than JSON Schema shape validation."""
    require(type(trace) is dict and set(trace) ==
            {"contract", "machine", "entity_count", "transitions"}, "bad trace shape")
    require(trace["contract"] == CONTRACT and trace["machine"] == "flat-fixture-v0",
            "unsupported trace contract/machine")
    n = trace["entity_count"]
    require(type(n) is int and 1 <= n <= 1024, "bad entity count")
    entries = trace["transitions"]
    require(type(entries) is list and len(entries) <= 10000, "bad transition count")
    previous = [snap() for _ in range(n)]
    for i, entry in enumerate(entries):
        require(type(entry) is dict and set(entry) ==
                {"seq", "entity", "event", "accepted", "reason", "before", "after", "effects"},
                "bad step shape")
        entity, event = entry["entity"], entry["event"]
        require(type(entry["seq"]) is int and entry["seq"] == i, "non-contiguous sequence")
        require(type(entity) is int and 0 <= entity < n, "bad entity")
        require(type(entry["accepted"]) is bool and type(entry["reason"]) is str,
                "bad admission fields")
        require(type(entry["effects"]) is list and all(type(x) is int for x in entry["effects"]),
                "bad effects")
        for label in ("before", "after"):
            s = entry[label]
            require(type(s) is dict and set(s) == {"state", "version", "ticks"},
                    "bad snapshot shape")
            require(all(type(v) is int and 0 <= v <= LIMIT for v in s.values()),
                    "bad snapshot field")
        require(entry["before"] == previous[entity], "out-of-order entity state")
        expected = step(previous[entity], event)
        require((entry["accepted"], entry["reason"], entry["after"], entry["effects"]) == expected,
                "transition semantics/effect/version mismatch")
        previous[entity] = entry["after"]
    return True
