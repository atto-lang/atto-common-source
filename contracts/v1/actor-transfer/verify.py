#!/usr/bin/env python3
"""Reference contract and negative matrix only; NOT a compiler implementation."""
import json
import pathlib
import unittest

MATRIX = pathlib.Path(__file__).with_name("cases.json")
BOUNDARIES = {"local_channel", "actor_shared", "actor_private", "wire"}
MODES = {"move", "copy", "share", "serialize"}
MAX_DEPTH = 64


def eligible(t, boundary, mode, depth=0):
    """Conservative reference policy; proof bits must be compiler-attested in reality."""
    if depth >= MAX_DEPTH or not isinstance(t, dict):
        return False
    kind = t.get("kind")
    if boundary == "wire":
        if mode != "serialize":
            return False
        if kind in {"primitive", "string"}:
            return True
        if kind == "symbol":
            return t.get("scope") == "global"
        if kind in {"record", "enum"}:
            return all(eligible(v, boundary, mode, depth + 1) for v in t.get("fields", []))
        if kind == "array":
            return eligible(t.get("item"), boundary, mode, depth + 1)
        if kind == "class":
            return t.get("serializable") is True and all(
                eligible(v, boundary, mode, depth + 1) for v in t.get("fields", [])
            )
        return False

    if boundary == "local_channel":
        # A local Channel is not an actor mailbox. It can move a unique handle
        # or an owned closure; it does not grant cross-actor memory access.
        return mode == "move" and kind != "borrow" and not t.get("live_loans", False)

    if boundary not in {"actor_private", "actor_shared"} or mode == "serialize":
        return False

    if kind in {"primitive", "string"}:
        return True
    if kind == "symbol":
        return t.get("scope") == "global"
    if kind in {"borrow", "function", "future", "channel", "mutex", "raw_pointer"}:
        return False
    if kind == "actor_ref":
        return mode == "move" and t.get("runtime_affinity") is True
    if kind in {"record", "enum"}:
        return all(eligible(v, boundary, mode, depth + 1) for v in t.get("fields", []))
    if kind == "array":
        return (mode != "share" or t.get("frozen") is True) and eligible(
            t.get("item"), boundary, mode, depth + 1
        )
    if kind == "class":
        if mode == "move":
            gate = t.get("sendable_proof") is True
        elif mode == "copy":
            gate = t.get("copy_proof") is True and t.get("independent_copy") is True
        else:
            gate = t.get("shareable_proof") is True and t.get("frozen") is True
        return gate and all(eligible(v, boundary, mode, depth + 1) for v in t.get("fields", []))
    if kind == "pointer":
        if t.get("live_loans"):
            return False
        if mode == "move":
            gate = t.get("sendable_proof") is True and t.get("domain_handoff") is True
        elif mode == "copy":
            gate = t.get("copy_proof") is True and t.get("independent_copy") is True
        else:
            gate = (t.get("shareable_proof") is True and t.get("frozen") is True
                    and t.get("shared_lifetime") is True)
        return gate and eligible(t.get("target"), boundary, mode, depth + 1)
    return False


class ActorTransferContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MATRIX.read_text(encoding="utf-8"))

    def test_matrix_contract(self):
        self.assertEqual(self.data["version"], 1)
        cases = self.data["cases"]
        self.assertGreaterEqual(len(cases), 30)
        names = [c["name"] for c in cases]
        self.assertEqual(len(names), len(set(names)), "case names must be unique")
        for case in cases:
            with self.subTest(case=case["name"]):
                self.assertIn(case["boundary"], BOUNDARIES)
                self.assertIn(case["mode"], MODES)
                self.assertIs(type(case["allow"]), bool)
                self.assertEqual(
                    eligible(case["type"], case["boundary"], case["mode"]),
                    case["allow"])

    def test_serializable_does_not_imply_sendable(self):
        obj = {"kind": "class", "serializable": True, "fields": [{"kind": "string"}]}
        self.assertTrue(eligible(obj, "wire", "serialize"))
        self.assertFalse(eligible(obj, "actor_private", "move"))

    def test_mutable_children_cannot_be_shared(self):
        inner = {"kind": "array", "item": {"kind": "string"}}
        p = {"kind": "pointer", "target": {"kind": "record", "fields": [inner]},
             "shareable_proof": True, "frozen": True, "shared_lifetime": True}
        self.assertFalse(eligible(p, "actor_shared", "share"))
        inner["frozen"] = True
        self.assertTrue(eligible(p, "actor_shared", "share"))

    def test_handle_copy_requires_independent_storage(self):
        p = {"kind": "pointer", "target": {"kind": "record", "fields": [{"kind": "string"}]},
             "copy_proof": True}
        self.assertFalse(eligible(p, "actor_shared", "copy"))
        p["independent_copy"] = True
        self.assertTrue(eligible(p, "actor_shared", "copy"))

    def test_cannot_send_borrow_or_private_symbol(self):
        self.assertFalse(eligible({"kind": "borrow", "target": {"kind": "primitive"}},
                                  "actor_private", "move"))
        self.assertFalse(eligible({"kind": "symbol", "scope": "module_private"},
                                  "actor_shared", "share"))

    def test_adversarial_depth_limit(self):
        nested = {"kind": "primitive"}
        for _ in range(MAX_DEPTH + 1):
            nested = {"kind": "record", "fields": [nested]}
        self.assertFalse(eligible(nested, "actor_private", "move"))


if __name__ == "__main__":
    unittest.main()
