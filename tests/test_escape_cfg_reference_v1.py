"""Fail-closed, source-free CFG proof model for future allocation MIR.

This is NOT a compiler verifier: real MIR completeness and ownership must be
certified by a compiler-owned builder, never by user-supplied JSON flags.
"""
import unittest

ALLOWED = {"write", "read", "borrow", "noop", "exit", "actor_send",
           "channel_send", "ffi", "capture", "suspend", "unknown_call"}
BARRIERS = {"actor_send", "channel_send", "ffi", "capture", "suspend", "unknown_call"}


def analyze_cfg(nodes, edges, *, field_count=2, size_bytes=16,
                alignment=8, stack_budget=4096, certified=False):
    preserve = "preserve-allocation"
    if not certified:
        return preserve
    if (not 0 < field_count <= 64 or size_bytes < field_count or
            alignment <= 0 or alignment > 64 or
            alignment & (alignment - 1) or stack_budget <= 0):
        raise ValueError("invalid allocation layout or budget")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 256 or len(edges) > 512:
        raise ValueError("invalid CFG bounds")
    ids = [node.get("id") for node in nodes]
    if any(type(i) is not int for i in ids) or len(ids) != len(set(ids)):
        raise ValueError("invalid CFG node IDs")
    by_id = {node["id"]: node for node in nodes}
    succ = {i: [] for i in ids}
    pred = {i: [] for i in ids}
    for node in nodes:
        if node.get("kind") not in ALLOWED or set(node) - {"id", "kind", "field", "lifetime_proven"}:
            raise ValueError("unknown CFG operation")
        if node["kind"] in ("read", "write"):
            if type(node.get("field")) is not int or not 0 <= node["field"] < field_count:
                raise ValueError("invalid field index")
        elif "field" in node:
            raise ValueError("spurious field index")
        if node["kind"] != "borrow" and "lifetime_proven" in node:
            raise ValueError("spurious lifetime proof")
    for edge in edges:
        if (not isinstance(edge, (tuple, list)) or len(edge) != 2 or
                edge[0] not in by_id or edge[1] not in by_id or
                edge[1] in succ[edge[0]]):
            raise ValueError("invalid CFG edge")
        succ[edge[0]].append(edge[1])
        pred[edge[1]].append(edge[0])
    roots = [i for i in ids if not pred[i]]
    if len(roots) != 1:
        raise ValueError("CFG needs exactly one entry")
    if any(by_id[i]["kind"] == "exit" and succ[i] for i in ids):
        raise ValueError("terminal exit must have no successor")
    # Topological order refuses loops until a real fixed-point verifier exists.
    ready = roots[:]
    order = []
    pending = {i: len(pred[i]) for i in ids}
    while ready:
        i = ready.pop(0)
        order.append(i)
        for j in succ[i]:
            pending[j] -= 1
            if pending[j] == 0:
                ready.append(j)
    if len(order) != len(nodes):
        raise ValueError("cyclic or disconnected CFG unsupported")
    if any(not succ[i] and by_id[i]["kind"] != "exit" for i in ids):
        raise ValueError("all terminal paths require explicit exit")
    definite = {}
    has_borrow = False
    has_barrier = False
    for i in order:
        in_fields = (set.intersection(*(definite[p] for p in pred[i]))
                     if pred[i] else set())
        node = by_id[i]
        kind = node["kind"]
        if kind == "write":
            in_fields.add(node["field"])
        elif kind == "read" and node["field"] not in in_fields:
            raise ValueError("read before definite initialization")
        elif kind == "borrow":
            if node.get("lifetime_proven") is not True or len(in_fields) != field_count:
                return preserve
            has_borrow = True
        elif kind in BARRIERS:
            has_barrier = True
        definite[i] = in_fields
    exits = [i for i in ids if by_id[i]["kind"] == "exit"]
    if not exits:
        raise ValueError("missing exit")
    if any(len(definite[i]) != field_count for i in exits) or has_barrier:
        return preserve
    if not has_borrow:
        return "scalar-candidate"
    slot = ((size_bytes + alignment - 1) // alignment) * alignment
    return "stack-candidate" if slot <= stack_budget else preserve


class EscapeCfgReferenceTest(unittest.TestCase):
    def test_both_branches_initialize_before_join(self):
        nodes = [{"id": 0, "kind": "write", "field": 0},
                 {"id": 1, "kind": "write", "field": 1},
                 {"id": 2, "kind": "write", "field": 1},
                 {"id": 3, "kind": "read", "field": 1},
                 {"id": 4, "kind": "exit"}]
        edges = [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4)]
        self.assertEqual(analyze_cfg(nodes, edges, certified=True), "scalar-candidate")
        nodes[2] = {"id": 2, "kind": "noop"}
        with self.assertRaisesRegex(ValueError, "read before"):
            analyze_cfg(nodes, edges, certified=True)

    def test_exceptional_path_not_implicitly_ignored(self):
        nodes = [{"id": 0, "kind": "write", "field": 0},
                 {"id": 1, "kind": "write", "field": 1},
                 {"id": 2, "kind": "exit"},
                 {"id": 3, "kind": "exit"}]
        edges = [(0, 1), (1, 2), (0, 3)]  # 0 -> 3 models early exceptional exit
        self.assertEqual(analyze_cfg(nodes, edges, certified=True), "preserve-allocation")

    def test_borrow_stack_budget_and_opaque_boundaries(self):
        nodes = [{"id": 0, "kind": "write", "field": 0},
                 {"id": 1, "kind": "write", "field": 1},
                 {"id": 2, "kind": "borrow", "lifetime_proven": True},
                 {"id": 3, "kind": "exit"}]
        edges = [(0, 1), (1, 2), (2, 3)]
        self.assertEqual(analyze_cfg(nodes, edges, certified=True), "stack-candidate")
        self.assertEqual(analyze_cfg(nodes, edges, certified=True, stack_budget=8), "preserve-allocation")
        for barrier in BARRIERS:
            with self.subTest(barrier=barrier):
                nodes[2] = {"id": 2, "kind": barrier}
                self.assertEqual(analyze_cfg(nodes, edges, certified=True), "preserve-allocation")
        self.assertEqual(analyze_cfg(nodes, edges, certified=False), "preserve-allocation")

    def test_fail_closed_cfg_shapes(self):
        nodes = [{"id": 0, "kind": "write", "field": 0},
                 {"id": 1, "kind": "write", "field": 1},
                 {"id": 2, "kind": "exit"}]
        good = [(0, 1), (1, 2)]
        with self.assertRaises(ValueError):
            analyze_cfg(nodes, good + [(2, 0)], certified=True)
        with self.assertRaises(ValueError):
            analyze_cfg(nodes, good + [(0, 1)], certified=True)
        with self.assertRaises(ValueError):
            analyze_cfg(nodes[:2], [(0, 1)], certified=True)
        with self.assertRaises(ValueError):
            analyze_cfg(nodes + [{"id": 4, "kind": "bad"}], good + [(2, 4)], certified=True)
        with self.assertRaises(ValueError):
            analyze_cfg(nodes, good, alignment=3, certified=True)


if __name__ == "__main__":
    unittest.main()
