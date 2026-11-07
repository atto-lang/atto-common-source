"""Reference-only shared-RO Symbol model.

NOT a compiler, native read-only mapping, concurrent actor runtime or backend
conformance suite. Tests exercise policy and immutable snapshot invariants.
"""
import hashlib
import json
import unicodedata
import unittest
import uuid
from dataclasses import dataclass
from pathlib import Path


VECTORS = Path(__file__).resolve().parents[1] / "fixtures" / "symbols-shared-ro-v1.json"
MAX_BYTES = 256
MAX_RAW = 1024
MAX_NODES = 64
MAX_DEPTH = 16


def canonical_name(name):
    if not isinstance(name, str) or len(name) > MAX_RAW:
        raise ValueError("unbounded or nontext Symbol name")
    name.encode("utf-8", "strict")
    result = unicodedata.normalize("NFC", name)
    if not result or len(result.encode("utf-8")) > MAX_BYTES:
        raise ValueError("invalid canonical Symbol byte length")
    for character in result:
        scalar = ord(character)
        category = unicodedata.category(character)
        if (scalar < 0x20 or 0x7f <= scalar <= 0x9f
                or category in ("Cf", "Zl", "Zp")):
            raise ValueError("unsafe Symbol character")
    return result


@dataclass(frozen=True)
class Symbol:
    kind: str
    name: str

    def canonical(self):
        if self.kind not in ("process", "stable"):
            raise ValueError("invalid Symbol kind")
        name = canonical_name(self.name)
        if self.kind == "stable":
            try:
                if str(uuid.UUID(name)) != name:
                    raise ValueError("stable Symbol must be canonical lowercase UUID")
            except (AttributeError, ValueError) as error:
                raise ValueError("invalid stable Symbol UUID") from error
        return Symbol(self.kind, name)


@dataclass(frozen=True)
class FrozenMap:
    entries: tuple

    def get(self, key):
        for candidate, value in self.entries:
            if candidate == key:
                return value
        raise KeyError(key)


def allowed(symbol, context, manifest):
    symbol = symbol.canonical()
    if context["trust"] == "trusted":
        return True
    if context["trust"] != "untrusted" or symbol.kind != "process":
        return False
    if symbol.name in manifest["core_process_names"]:
        return True
    return any(
        scope["tenant"] == context["tenant"]
        and scope["endpoint"] == context["endpoint"]
        and scope["protocol"] == context["protocol"]
        and symbol.name in scope["process_names"]
        for scope in manifest["exports"]
    )


def freeze(value, context, manifest):
    """Detach and deeply freeze, checking actual recursive traversal.

    Only a deliberately closed scalar/array/map reference subset is modeled.
    This does not prove safe concurrent iteration of mutable host collections.
    """
    ancestors = set()
    visited = [0]
    bytes_visited = [0]

    def walk(obj, depth):
        if depth > MAX_DEPTH:
            raise ValueError("graph depth quota")
        visited[0] += 1
        if visited[0] > MAX_NODES:
            raise ValueError("graph node quota")

        if isinstance(obj, Symbol):
            item = obj.canonical()
            if not allowed(item, context, manifest):
                raise PermissionError("Symbol not admitted to actor")
            bytes_visited[0] += len(item.name.encode("utf-8"))
            result = item
        elif isinstance(obj, str):
            bytes_visited[0] += len(obj.encode("utf-8", "strict"))
            result = obj
        elif obj is None or type(obj) in (bool, int):
            result = obj
        elif isinstance(obj, (dict, FrozenMap, list, tuple)):
            identity = id(obj)
            if identity in ancestors:
                raise ValueError("cyclic or recursive graph")
            ancestors.add(identity)
            try:
                if isinstance(obj, (dict, FrozenMap)):
                    source = obj.items() if isinstance(obj, dict) else obj.entries
                    members = []
                    seen_keys = set()
                    for key, entry in source:
                        frozen_key = walk(key, depth + 1)
                        # v1 Map key domain is STRING or SYMBOL, not
                        # arbitrary Python hashables. bool/int equality in
                        # Python (True == 1) must not silently collapse keys.
                        if type(frozen_key) is not str and not isinstance(frozen_key, Symbol):
                            raise TypeError("Symbol v1 map key must be String or Symbol")
                        if frozen_key in seen_keys:
                            raise ValueError("duplicate canonical logical map key")
                        seen_keys.add(frozen_key)
                        members.append((frozen_key, walk(entry, depth + 1)))
                    result = FrozenMap(tuple(members))
                else:
                    result = tuple(walk(child, depth + 1) for child in obj)
            finally:
                ancestors.remove(identity)
        else:
            raise TypeError("mutable host object/capability cannot be frozen")
        if bytes_visited[0] > 1_048_576:
            raise ValueError("graph byte quota")
        return result

    return walk(value, 0)


class Lease:
    def __init__(self, registry, epoch, view):
        self._registry = registry
        self.epoch = epoch
        self.view = view
        self._closed = False

    def release(self):
        if self._closed:
            raise RuntimeError("duplicate release")
        self._closed = True
        self._registry.release(self.epoch)


class ReadOnlyRegistry:
    """Sequential reference model for immutable hot-load generations."""

    def __init__(self, manifest):
        self.manifest = manifest
        self.current = 0
        self.records = {}

    def publish(self, value):
        prepared = freeze(value, {"trust": "trusted"}, self.manifest)
        old = self.current
        self.current += 1
        self.records[self.current] = {"value": prepared, "pins": 0}
        self._retire(old)
        return self.current

    def pin(self, context, expected_epoch=None):
        if self.current == 0 or (expected_epoch is not None and
                                 expected_epoch != self.current):
            raise ValueError("stale or missing region generation")
        record = self.records[self.current]
        view = record["value"] if context["trust"] == "trusted" else freeze(
            record["value"], context, self.manifest)
        record["pins"] += 1
        return Lease(self, self.current, view)

    def release(self, epoch):
        record = self.records[epoch]
        if record["pins"] <= 0:
            raise RuntimeError("pin ledger underflow")
        record["pins"] -= 1
        self._retire(epoch)

    def _retire(self, epoch):
        if epoch and epoch != self.current:
            if self.records[epoch]["pins"] == 0:
                del self.records[epoch]


class SharedROSymbolModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
        assert cls.vectors["schema"] == "atto.symbol-shared-ro/v1"
        cls.manifest = cls.vectors["admission_manifest"]
        cls.trusted = {"trust": "trusted"}
        cls.untrusted_a = {
            "trust": "untrusted", "tenant": "a",
            "endpoint": "worker", "protocol": "v1"
        }

    def test_literal_syntax_matrix_is_explicitly_not_compiler_execution(self):
        syntax = self.vectors["syntax"]
        self.assertEqual(len(syntax), len({case["source"] for case in syntax}))
        self.assertEqual(
            {case["expect"] for case in syntax},
            {"accept", "reject", "not-yet-admitted"}
        )
        self.assertEqual(
            [case["expect"] for case in syntax if "symbols Lifecycle" in case["source"]],
            ["not-yet-admitted"]
        )

    def test_names_and_nominal_equality(self):
        self.assertEqual(Symbol("process", "cafe\u0301").canonical(),
                         Symbol("process", "café").canonical())
        self.assertNotEqual(Symbol("process", "ready"), "ready")
        self.assertNotEqual(Symbol("process", "ready"), Symbol("stable", "ready"))
        self.assertNotEqual(Symbol("process", "Ready"), Symbol("process", "ready"))
        for name in ("", "x" * 257, "x" * 1025, "name\u202e"):
            with self.assertRaises(ValueError):
                Symbol("process", name).canonical()
        with self.assertRaises(ValueError):
            Symbol("stable", "550E8400-E29B-41D4-A716-446655440000").canonical()

    def test_scoped_actor_admission_vectors(self):
        for case in self.vectors["actor_cases"]:
            with self.subTest(case["label"]):
                symbol = Symbol(case["kind"], case["name"])
                self.assertIs(allowed(symbol, case, self.manifest), case["allow"])

    def test_deep_freeze_breaks_mutable_aliases_and_preserves_key_domains(self):
        source = {"list": [{"ready": 1, Symbol("process", "ready"): 2}]}
        snapshot = freeze(source, self.trusted, self.manifest)
        source["list"][0]["ready"] = 99
        source["list"].append({"extra": True})
        nested = snapshot.get("list")[0]
        self.assertEqual(nested.get("ready"), 1)
        self.assertEqual(nested.get(Symbol("process", "ready")), 2)
        self.assertEqual(len(snapshot.get("list")), 1)
        with self.assertRaises((AttributeError, TypeError)):
            nested.entries += (("extra", 7),)

    def test_recursive_keys_values_and_unknown_types_fail_closed(self):
        for obj in ({Symbol("process", "hidden"): 1},
                    {"ok": [Symbol("process", "hidden")]},
                    [Symbol("stable", "550e8400-e29b-41d4-a716-446655440000")]):
            with self.assertRaises(PermissionError):
                freeze(obj, self.untrusted_a, self.manifest)
        with self.assertRaises(TypeError):
            freeze({"socket": object()}, self.trusted, self.manifest)

    def test_normalization_collision_cycle_and_actual_budget(self):
        first = Symbol("process", "cafe\u0301")
        second = Symbol("process", "café")
        with self.assertRaises(ValueError):
            freeze({first: 1, second: 2}, self.trusted, self.manifest)
        cycle = []
        cycle.append(cycle)
        with self.assertRaises(ValueError):
            freeze(cycle, self.trusted, self.manifest)
        with self.assertRaises(ValueError):
            freeze(list(range(70)), self.trusted, self.manifest)
        nested = []
        for _ in range(MAX_DEPTH + 2):
            nested = [nested]
        with self.assertRaises(ValueError):
            freeze(nested, self.trusted, self.manifest)

    def test_non_symbol_non_string_keys_are_rejected_not_collapsed(self):
        # The host language considers True == 1; AttoLang must not silently
        # collapse their nominal key identities or widen an undeclared map.
        with self.assertRaises(TypeError):
            freeze({1: "number"}, self.trusted, self.manifest)
        with self.assertRaises(TypeError):
            freeze({True: "bool"}, self.trusted, self.manifest)
        # Mixed declared String and Symbol key domains remain distinct.
        frozen = freeze({"ready": 1, Symbol("process", "ready"): 2},
                        self.trusted, self.manifest)
        self.assertEqual(frozen.get("ready"), 1)
        self.assertEqual(frozen.get(Symbol("process", "ready")), 2)

    def test_generation_pins_and_tenant_copy(self):
        registry = ReadOnlyRegistry(self.manifest)
        epoch1 = registry.publish({"event": Symbol("process", "event")})
        trusted_a = registry.pin(self.trusted)
        trusted_b = registry.pin(self.trusted)
        self.assertIs(trusted_a.view, trusted_b.view)
        untrusted_a = registry.pin(self.untrusted_a)
        self.assertIsNot(untrusted_a.view, trusted_a.view)
        with self.assertRaises(PermissionError):
            registry.pin({**self.untrusted_a, "tenant": "b"})
        epoch2 = registry.publish({"event": Symbol("process", "ready")})
        self.assertNotEqual(epoch1, epoch2)
        self.assertEqual(trusted_a.view.get("event"), Symbol("process", "event"))
        with self.assertRaises(ValueError):
            registry.pin(self.trusted, expected_epoch=epoch1)
        untrusted_a.release()
        trusted_b.release()
        trusted_a.release()
        self.assertNotIn(epoch1, registry.records)
        with self.assertRaises(RuntimeError):
            trusted_a.release()

    def test_failed_publication_does_not_change_generation(self):
        registry = ReadOnlyRegistry(self.manifest)
        first = registry.publish({"ok": 1})
        with self.assertRaises(TypeError):
            registry.publish({"unsafe": object()})
        self.assertEqual(registry.current, first)
        lease = registry.pin(self.trusted)
        self.assertEqual(lease.view.get("ok"), 1)
        lease.release()

    def test_guest_fixtures_are_exact_blob_pinned_and_not_claimed_executed(self):
        manifest = json.loads((VECTORS.parent / "symbols-shared-ro-v1" /
                               "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema"], "atto.symbol-shared-ro-guest-fixtures/v1")
        self.assertEqual(manifest["status"], "NOT_EXECUTED")
        self.assertEqual(len(manifest["cases"]), 7)
        self.assertEqual(len({case["path"] for case in manifest["cases"]}), 7)
        self.assertEqual(len(manifest["backends"]), 5)
        self.assertTrue(all(item["status"] == "NOT_EXECUTED"
                            for item in manifest["backends"].values()))
        for case in manifest["cases"]:
            with self.subTest(case=case["path"]):
                path = VECTORS.parent.parent / case["path"]
                payload = path.read_bytes()
                actual = hashlib.sha1(
                    b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload
                ).hexdigest()
                self.assertEqual(actual, case["git_blob_sha1"])
                self.assertTrue(case["path"].endswith(".atto"))
                self.assertIn(case["expected"],
                              ("accept", "reject_lexer", "reject_parser", "reject_typecheck"))

    def test_no_permanent_intern_registry_is_needed_for_identity(self):
        x = Symbol("process", "same").canonical()
        y = Symbol("process", "same").canonical()
        self.assertEqual(x, y)
        self.assertIsNot(x, y)  # logical equality without physical identity


if __name__ == "__main__":
    unittest.main()
