"""Reference-only shared-RO Symbol model.

NOT a compiler, native read-only mapping, concurrent actor runtime or backend
conformance suite. Tests exercise policy and immutable snapshot invariants.
"""
import hashlib
import itertools
import json
import re
import tempfile
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
MAX_LIVE_GENERATIONS = 8
# Sequential reference model only. Runtime backends require their own atomic
# process/VM-local unique generation allocation.
_NEXT_REGION_EPOCH = itertools.count(1)


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
        self.closed = False

    def publish(self, value):
        if self.closed:
            raise RuntimeError("closed region registry")
        prepared = freeze(value, {"trust": "trusted"}, self.manifest)
        if self.closed:
            raise RuntimeError("closed region registry")
        old = self.current
        discard_unpinned_current = (
            1 if old and self.records[old]["pins"] == 0 else 0
        )
        if len(self.records) + 1 - discard_unpinned_current > MAX_LIVE_GENERATIONS:
            raise RuntimeError("too many pinned region generations")
        # Do not mint an epoch on rejection; a failed publication is inert.
        epoch = next(_NEXT_REGION_EPOCH)
        self.current = epoch
        self.records[epoch] = {"value": prepared, "pins": 0}
        self._retire(old)
        return epoch

    def pin(self, context, expected_epoch=None):
        if self.closed or self.current == 0 or (
                expected_epoch is not None and expected_epoch != self.current):
            raise ValueError("closed, stale or missing region generation")
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

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.current = 0
        for epoch in tuple(self.records):
            self._retire(epoch)

    def _retire(self, epoch):
        if epoch and epoch != self.current:
            if self.records[epoch]["pins"] == 0:
                del self.records[epoch]


def load_guest_fixture_manifest(path):
    """Decode canonical source receipts without JSON last-key-wins ambiguity."""
    def unique_fields(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON member in Symbol guest manifest: " + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      object_pairs_hook=unique_fields)


def verify_guest_fixture_inventory(manifest, repo_root):
    """Source-only receipt check; never interprets acceptance as guest execution."""
    if not isinstance(manifest, dict):
        raise ValueError("malformed Symbol guest manifest")
    if manifest.get("schema") != "atto.symbol-shared-ro-guest-fixtures/v1":
        raise ValueError("wrong Symbol guest fixture schema")
    if manifest.get("status") != "NOT_EXECUTED":
        raise ValueError("candidate fixtures cannot claim compiler execution")
    # No unknown fields, especially synthetic "passed"/"steps"/"receipt" keys
    # that could be mistaken for real compiler-backed evidence.
    v1_keys = {
        "schema", "description", "status", "compatibility_note",
        "witness_requirements", "cases", "backends"
    }
    if not isinstance(manifest, dict) or set(manifest) - v1_keys:
        raise ValueError("unknown or malformed Symbol guest manifest field")
    for optional in ("description", "compatibility_note"):
        if optional in manifest and (
                not isinstance(manifest[optional], str)
                or not manifest[optional]
                or len(manifest[optional]) > 4096):
            raise ValueError("malformed Symbol fixture documentation")
    required_witnesses = {
        "exact_pr_head_sha", "exact_git_tree_sha", "compiler_build_identity",
        "source_git_blob_sha", "actual_job_steps_nonzero",
        "diagnostic_or_guest_stdout", "exit_status", "independent_review"
    }
    if "witness_requirements" in manifest:
        witness = manifest["witness_requirements"]
        if not isinstance(witness, list) or len(witness) != len(required_witnesses) or (
                not all(isinstance(field, str) for field in witness)
                or set(witness) != required_witnesses):
            raise ValueError("missing or forged Symbol guest evidence requirements")
    required_backends = {
        "java-graal", "llvm", "dotnet-nativeaot", "wasm", "forge"
    }
    backends = manifest.get("backends")
    if not isinstance(backends, dict) or set(backends) != required_backends or any(
            not isinstance(info, dict)
            or set(info) - {"status", "reason"}
            or info.get("status") != "NOT_EXECUTED"
            or ("reason" in info and (
                not isinstance(info["reason"], str) or not info["reason"]))
            for info in backends.values()):
        raise ValueError("unsupported backend evidence-status mutation")
    directory = repo_root / "fixtures" / "symbols-shared-ro-v1"
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("fixture directory missing or symlinked")
    actual = set()
    for entry in directory.iterdir():
        if entry.name == "manifest.json":
            if entry.is_symlink() or not entry.is_file():
                raise ValueError("unsafe Symbol fixture manifest file")
            continue
        # An unlisted nested directory or non-.atto payload must not become
        # an unpinned source input to a later backend invocation.
        if not entry.name.endswith(".atto") or entry.is_symlink() or not entry.is_file():
            raise ValueError("unexpected or unsafe Symbol fixture directory entry")
        actual.add(entry.name)
    expected = set()
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("missing Symbol guest cases")
    for entry in cases:
        if not isinstance(entry, dict) or set(entry) - {
                "path", "git_blob_sha1", "expected", "stdout"}:
            raise ValueError("malformed or forged Symbol fixture case record")
        raw = entry.get("path")
        if not isinstance(raw, str):
            raise ValueError("nontext guest path")
        relative = Path(raw)
        if (relative.parts[:2] != ("fixtures", "symbols-shared-ro-v1")
                or len(relative.parts) != 3
                or re.fullmatch(r"[a-z0-9][a-z0-9-]*\.atto", relative.name) is None):
            raise ValueError("noncanonical or traversing guest fixture path")
        if relative.name in expected:
            raise ValueError("duplicate guest fixture inventory path")
        expected.add(relative.name)
        if entry.get("expected") not in (
                "accept", "reject_lexer", "reject_parser", "reject_typecheck"):
            raise ValueError("unknown compiler admission classification")
        if entry["expected"] == "accept":
            if not isinstance(entry.get("stdout"), str) or not entry["stdout"]:
                raise ValueError("accepted guest fixture lacks predicted stdout")
        elif "stdout" in entry:
            raise ValueError("rejected source cannot claim guest output")
        pinned = entry.get("git_blob_sha1")
        if not isinstance(pinned, str) or re.fullmatch("[0-9a-f]{40}", pinned) is None:
            raise ValueError("malformed Git blob identity")
        source_path = directory / relative.name
        if not source_path.is_file() or source_path.is_symlink():
            raise ValueError("missing or symlinked guest fixture")
        # Bound input before reading or hashing. This is a deliberately small
        # canonical source corpus, not an unrestricted external source file.
        if source_path.stat().st_size > 65_536:
            raise ValueError("oversized canonical guest fixture")
        payload = source_path.read_bytes()
        if len(payload) > 65_536:
            raise ValueError("oversized canonical guest fixture")
        try:
            payload.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("malformed UTF-8 guest fixture") from error
        actual_sha = hashlib.sha1(
            b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload
        ).hexdigest()
        if actual_sha != pinned:
            raise ValueError("mismatched immutable guest Git blob")
    if actual != expected:
        raise ValueError("unlisted or missing .atto fixture")
    return len(expected)


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
        manifest = load_guest_fixture_manifest(
            VECTORS.parent / "symbols-shared-ro-v1" / "manifest.json")
        self.assertEqual(verify_guest_fixture_inventory(
            manifest, VECTORS.parent.parent), 11)

    def test_guest_fixture_verifier_rejects_mutated_references_and_inventories(self):
        with tempfile.TemporaryDirectory(prefix="atto-symbol-fixture-") as temp:
            root = Path(temp)
            folder = root / "fixtures" / "symbols-shared-ro-v1"
            folder.mkdir(parents=True)
            source = folder / "test.atto"
            source.write_text("pub routine main(): void { return; }\n",
                              encoding="utf-8")
            payload = source.read_bytes()
            blob_sha = hashlib.sha1(
                b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload
            ).hexdigest()
            base = {
                "schema": "atto.symbol-shared-ro-guest-fixtures/v1",
                "status": "NOT_EXECUTED",
                "backends": {
                    backend: {"status": "NOT_EXECUTED"} for backend in (
                        "java-graal", "llvm", "dotnet-nativeaot", "wasm", "forge")
                },
                "cases": [{
                    "path": "fixtures/symbols-shared-ro-v1/test.atto",
                    "expected": "accept", "stdout": "ok",
                    "git_blob_sha1": blob_sha
                }]
            }
            self.assertEqual(verify_guest_fixture_inventory(base, root), 1)
            for mutation in (
                {"git_blob_sha1": "0" * 40},
                {"git_blob_sha1": "f" * 40},
                {"path": "fixtures/symbols-shared-ro-v1/../test.atto"},
                {"path": "/tmp/test.atto"},
                {"expected": "reject_lexer", "stdout": "forged"},
                {"expected": "accept", "stdout": ""},
            ):
                changed = json.loads(json.dumps(base))
                changed["cases"][0].update(mutation)
                with self.subTest(mutation=mutation):
                    with self.assertRaises(ValueError):
                        verify_guest_fixture_inventory(changed, root)
            changed = json.loads(json.dumps(base))
            changed["status"] = "PASSED"
            with self.assertRaises(ValueError):
                verify_guest_fixture_inventory(changed, root)
            changed = json.loads(json.dumps(base))
            changed["backends"]["llvm"]["status"] = "EXECUTED"
            with self.assertRaises(ValueError):
                verify_guest_fixture_inventory(changed, root)
            extra = folder / "forgotten.atto"
            extra.write_text("untracked", encoding="utf-8")
            with self.assertRaises(ValueError):
                verify_guest_fixture_inventory(base, root)
            extra.unlink()
            source.unlink()
            source.symlink_to(folder / "missing.atto")
            with self.assertRaises(ValueError):
                verify_guest_fixture_inventory(base, root)

    def test_guest_manifest_loader_and_schema_reject_forged_evidence(self):
        manifest_path = VECTORS.parent / "symbols-shared-ro-v1" / "manifest.json"
        canonical = load_guest_fixture_manifest(manifest_path)
        self.assertEqual(verify_guest_fixture_inventory(
            canonical, VECTORS.parent.parent), 11)

        with tempfile.TemporaryDirectory(prefix="atto-duplicate-receipt-") as temp:
            candidate = Path(temp) / "manifest.json"
            for duplicate in (
                '{"schema":"atto.symbol-shared-ro-guest-fixtures/v1",'
                '"status":"PASSED","status":"NOT_EXECUTED"}',
                '{"backends":{"llvm":{"status":"PASSED",'
                '"status":"NOT_EXECUTED"}}}',
                '{"cases":[{"expected":"accept","expected":"reject_lexer"}]}',
            ):
                candidate.write_text(duplicate, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "duplicate JSON member"):
                    load_guest_fixture_manifest(candidate)

        def changed():
            return json.loads(json.dumps(canonical))

        for mutation in (
            ("top-level forged pass", lambda m: m.update({"ci_pass": True})),
            ("backend forged steps", lambda m: m["backends"]["llvm"].update(
                {"steps": 1})),
            ("case forged pass", lambda m: m["cases"][0].update({"passed": True})),
            ("missing witness", lambda m: m["witness_requirements"].remove(
                "independent_review")),
            ("duplicated witness", lambda m: m["witness_requirements"].append(
                "exact_pr_head_sha")),
            ("untyped witness", lambda m: m.update(
                {"witness_requirements": [1] * 8})),
            ("blank backend reason", lambda m: m["backends"]["java-graal"].update(
                {"reason": ""})),
            ("untyped backend reason", lambda m: m["backends"]["llvm"].update(
                {"reason": 0})),
        ):
            with self.subTest(mutation=mutation[0]):
                forged = changed()
                mutation[1](forged)
                with self.assertRaises(ValueError):
                    verify_guest_fixture_inventory(forged, VECTORS.parent.parent)
        with self.assertRaises(ValueError):
            verify_guest_fixture_inventory([], VECTORS.parent.parent)

    def test_guest_fixture_inventory_rejects_hidden_inputs_and_resource_abuse(self):
        with tempfile.TemporaryDirectory(prefix="atto-symbol-guard-") as temp:
            root = Path(temp)
            folder = root / "fixtures" / "symbols-shared-ro-v1"
            folder.mkdir(parents=True)
            source = folder / "valid.atto"
            source.write_text("pub routine main(): void { return; }\n", encoding="utf-8")
            original = source.read_bytes()
            digest = hashlib.sha1(
                b"blob " + str(len(original)).encode("ascii") + b"\0" + original
            ).hexdigest()
            manifest = {
                "schema": "atto.symbol-shared-ro-guest-fixtures/v1",
                "status": "NOT_EXECUTED",
                "backends": {
                    key: {"status": "NOT_EXECUTED"} for key in (
                        "java-graal", "llvm", "dotnet-nativeaot", "wasm", "forge")
                },
                "cases": [{
                    "path": "fixtures/symbols-shared-ro-v1/valid.atto",
                    "expected": "accept", "stdout": "ok", "git_blob_sha1": digest
                }],
            }
            self.assertEqual(verify_guest_fixture_inventory(manifest, root), 1)
            extra = folder / "unlisted.data"
            extra.write_text("not a declared guest source", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected or unsafe"):
                verify_guest_fixture_inventory(manifest, root)
            extra.unlink()

            nested = folder / "hidden"
            nested.mkdir()
            (nested / "malicious.atto").write_text("#private", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected or unsafe"):
                verify_guest_fixture_inventory(manifest, root)
            (nested / "malicious.atto").unlink()
            nested.rmdir()

            source.write_bytes(b"x" * 65_537)
            with self.assertRaisesRegex(ValueError, "oversized"):
                verify_guest_fixture_inventory(manifest, root)
            source.write_bytes(b"\xff")
            with self.assertRaisesRegex(ValueError, "malformed UTF-8"):
                verify_guest_fixture_inventory(manifest, root)
            source.write_bytes(original)

            malformed = json.loads(json.dumps(manifest))
            malformed["backends"]["java-graal"] = None
            with self.assertRaisesRegex(ValueError, "backend evidence"):
                verify_guest_fixture_inventory(malformed, root)
            malformed = json.loads(json.dumps(manifest))
            malformed["cases"][0] = "not a structured record"
            with self.assertRaisesRegex(ValueError, "case record"):
                verify_guest_fixture_inventory(malformed, root)

            linked_manifest = folder / "manifest.json"
            linked_manifest.symlink_to(folder / "untrusted-manifest.json")
            with self.assertRaisesRegex(ValueError, "unsafe Symbol fixture manifest"):
                verify_guest_fixture_inventory(manifest, root)

    def test_registry_epoch_minted_in_one_store_never_aliases_another(self):
        first = ReadOnlyRegistry(self.manifest)
        second = ReadOnlyRegistry(self.manifest)
        a = first.publish({"name": "a"})
        b = second.publish({"name": "b"})
        self.assertNotEqual(a, b)
        with self.assertRaises(ValueError):
            first.pin(self.trusted, expected_epoch=b)
        with self.assertRaises(ValueError):
            second.pin(self.trusted, expected_epoch=a)
        self.assertEqual(first.pin(self.trusted, expected_epoch=a).view.get("name"), "a")
        self.assertEqual(second.pin(self.trusted, expected_epoch=b).view.get("name"), "b")

    def test_exact_eight_live_generations_reject_ninth_transactionally(self):
        registry = ReadOnlyRegistry(self.manifest)
        pins = []
        for generation in range(MAX_LIVE_GENERATIONS):
            epoch = registry.publish({"ordinal": generation})
            pins.append(registry.pin(self.trusted, expected_epoch=epoch))
        self.assertEqual(len(registry.records), MAX_LIVE_GENERATIONS)
        current = registry.current
        with self.assertRaisesRegex(RuntimeError, "too many pinned"):
            registry.publish({"ordinal": 999})
        self.assertEqual(registry.current, current)
        extra = registry.pin(self.trusted)
        self.assertEqual(extra.view.get("ordinal"), 7)
        extra.release()
        pins[0].release()
        self.assertEqual(len(registry.records), MAX_LIVE_GENERATIONS - 1)
        newest = registry.publish({"ordinal": 8})
        self.assertNotEqual(newest, current)
        latest_pin = registry.pin(self.trusted)
        self.assertEqual(latest_pin.view.get("ordinal"), 8)
        latest_pin.release()
        for pin in pins[1:]:
            pin.release()
        self.assertEqual(len(registry.records), 1)

    def test_close_revokes_admission_but_keeps_pinned_views_until_release(self):
        registry = ReadOnlyRegistry(self.manifest)
        first = registry.publish({"symbol": Symbol("process", "ready")})
        pin = registry.pin(self.trusted, expected_epoch=first)
        registry.close()
        registry.close()
        self.assertEqual(pin.view.get("symbol"), Symbol("process", "ready"))
        with self.assertRaises(ValueError):
            registry.pin(self.trusted)
        with self.assertRaises(RuntimeError):
            registry.publish({"symbol": Symbol("process", "error")})
        self.assertEqual(len(registry.records), 1)
        pin.release()
        self.assertEqual(len(registry.records), 0)

    def test_denied_untrusted_pin_does_not_reserve_or_leak_a_generation(self):
        registry = ReadOnlyRegistry(self.manifest)
        epoch = registry.publish({"secret": Symbol("process", "not_exported")})
        before = registry.records[epoch]["pins"]
        with self.assertRaises(PermissionError):
            registry.pin(self.untrusted_a, expected_epoch=epoch)
        self.assertEqual(registry.records[epoch]["pins"], before)
        trusted = registry.pin(self.trusted, expected_epoch=epoch)
        self.assertEqual(registry.records[epoch]["pins"], before + 1)
        trusted.release()

    def test_export_scope_requires_matching_tenant_endpoint_and_protocol(self):
        event = Symbol("process", "event")
        self.assertTrue(allowed(event, self.untrusted_a, self.manifest))
        for changed in (
                {"tenant": "b"}, {"endpoint": "other"},
                {"protocol": "future"}, {"trust": "invalid"}):
            with self.subTest(changed=changed):
                context = {**self.untrusted_a, **changed}
                self.assertFalse(allowed(event, context, self.manifest))
                with self.assertRaises(PermissionError):
                    freeze({"event": event}, context, self.manifest)

    def test_signed_byte_budget_and_graph_counts_do_not_reset_in_nested_values(self):
        with self.assertRaisesRegex(ValueError, "graph byte quota"):
            freeze({"payload": "a" * (1_048_576 + 1)},
                   self.trusted, self.manifest)
        with self.assertRaisesRegex(ValueError, "graph node quota"):
            freeze({"left": list(range(MAX_NODES // 2)),
                    "right": list(range(MAX_NODES // 2))},
                   self.trusted, self.manifest)

    def test_frozen_map_duplicate_nfc_keys_and_mixed_domains(self):
        collapsed = FrozenMap((
            (Symbol("process", "cafe\u0301"), 1),
            (Symbol("process", "caf\u00e9"), 2),
        ))
        with self.assertRaisesRegex(ValueError, "duplicate canonical logical"):
            freeze(collapsed, self.trusted, self.manifest)
        disjoint = FrozenMap((
            ("ready", 1),
            (Symbol("process", "ready"), 2),
            (Symbol("stable", "550e8400-e29b-41d4-a716-446655440000"), 3),
        ))
        copied = freeze(disjoint, self.trusted, self.manifest)
        self.assertEqual(len(copied.entries), 3)
        self.assertEqual(copied.get("ready"), 1)
        self.assertEqual(copied.get(Symbol("process", "ready")), 2)
        self.assertEqual(copied.get(Symbol("stable",
                              "550e8400-e29b-41d4-a716-446655440000")), 3)

    def test_no_permanent_intern_registry_is_needed_for_identity(self):
        x = Symbol("process", "same").canonical()
        y = Symbol("process", "same").canonical()
        self.assertEqual(x, y)
        self.assertIsNot(x, y)  # logical equality without physical identity


if __name__ == "__main__":
    unittest.main()
