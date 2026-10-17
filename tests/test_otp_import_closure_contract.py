#!/usr/bin/env python3
"""Reference import/effect closure for G0 OTP portability.

This is a Python MODEL of the future compiler admission rule, not an Oreslang
parser, linker, executable module, bare-metal binary or runtime conformance test.
"""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = json.loads(
    (ROOT / "contracts/library/v1/otp-portability.json").read_text(encoding="utf-8")
)
LAYERS = {item["id"]: item for item in MANIFEST["layers"]}
MODULES = {item["module"]: item for item in MANIFEST["modules"]}
ACTOR_PROVIDERS = frozenset(LAYERS["actor"]["requiredProviders"])


class AdmissionError(ValueError):
    pass


def audit_closure(units, roots, *, allowed_layers, providers=(),
                  features=(), allowed_effects=()):
    """Walk all transitive imports and require explicit capabilities.

    The units argument represents *already parsed* source metadata. A compiler
    must obtain this data from verified source and generated code, never from
    caller-supplied unchecked names. Missing imports and unknown effects fail
    closed rather than triggering a permissive host fallback.
    """
    allowed_layers = set(allowed_layers)
    providers = set(providers)
    features = set(features)
    allowed_effects = set(allowed_effects)
    visited, visiting = set(), set()

    def visit(name):
        if name in visiting:
            raise AdmissionError("dependency cycle: " + name)
        if name in visited:
            return
        if name not in units:
            raise AdmissionError("unknown import: " + name)
        unit = units[name]
        layer = unit.get("layer")
        if layer not in LAYERS or layer not in allowed_layers:
            raise AdmissionError("forbidden or unknown layer: " + str(layer))
        if not set(LAYERS[layer]["requiredProviders"]) <= providers:
            raise AdmissionError("missing layer provider: " + name)
        if not set(unit.get("requires", [])) <= features:
            raise AdmissionError("missing feature: " + name)
        if not set(unit.get("effects", [])) <= allowed_effects:
            raise AdmissionError("forbidden effect: " + name)
        visiting.add(name)
        for dep in unit.get("imports", []):
            visit(dep)
        visiting.remove(name)
        visited.add(name)

    for root in roots:
        visit(root)
    return frozenset(visited)


def synthetic_units():
    """The normative six-module inventory as hypothetical parsed units."""
    units = {
        "core/scalars": {"layer": "core"},
        "actor/mail": {"layer": "actor", "imports": ["core/scalars"]},
    }
    for name, module in MODULES.items():
        units["std/otp/" + name] = {
            "layer": module["layer"],
            "imports": ["actor/mail"],
            "requires": module["requires"],
        }
    return units


class ImportClosureReferenceTests(unittest.TestCase):
    def test_core_only_compiles_without_providers(self):
        units = synthetic_units()
        self.assertEqual(
            audit_closure(units, ["core/scalars"], allowed_layers={"core"}),
            frozenset({"core/scalars"}),
        )

    def test_actor_requires_explicit_executor_mailbox_and_control(self):
        units = synthetic_units()
        with self.assertRaisesRegex(AdmissionError, "missing layer provider"):
            audit_closure(units, ["actor/mail"], allowed_layers={"core", "actor"})
        self.assertIn(
            "actor/mail",
            audit_closure(units, ["actor/mail"], allowed_layers={"core", "actor"},
                          providers=ACTOR_PROVIDERS),
        )

    def test_all_six_otp_modules_can_have_freestanding_source_closure(self):
        units = synthetic_units()
        mandatory_features = {
            feature for module in MODULES.values() for feature in module["requires"]
        }
        roots = ["std/otp/" + name for name in MODULES]
        closure = audit_closure(
            units, roots, allowed_layers={"core", "actor", "otp"},
            providers=ACTOR_PROVIDERS, features=mandatory_features,
        )
        self.assertEqual(len(roots), 6)
        self.assertEqual(len(closure), 8)
        self.assertNotIn("host-adapter", {units[x]["layer"] for x in closure})

    def test_missing_mandatory_otp_feature_rejects(self):
        units = synthetic_units()
        with self.assertRaisesRegex(AdmissionError, "missing feature"):
            audit_closure(units, ["std/otp/gen_server"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS, features={"actor.serial"})

    def test_transitive_host_import_forbidden_in_otp(self):
        units = synthetic_units()
        units["std/net"] = {
            "layer": "host-adapter", "effects": ["network"],
            "imports": ["core/scalars"],
        }
        units["std/otp/registry"]["imports"].append("std/net")
        with self.assertRaisesRegex(AdmissionError, "forbidden or unknown layer"):
            audit_closure(units, ["std/otp/registry"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["registry"]["requires"])

    def test_core_cannot_import_actor_directly_or_transitively(self):
        units = synthetic_units()
        units["core/leaky"] = {
            "layer": "core", "imports": ["actor/mail"],
        }
        with self.assertRaisesRegex(AdmissionError, "forbidden or unknown layer"):
            audit_closure(units, ["core/leaky"], allowed_layers={"core"})

    def test_unknown_import_rejected_and_no_host_fallback(self):
        units = synthetic_units()
        units["core/scalars"]["imports"] = ["stdlib/unknown"]
        with self.assertRaisesRegex(AdmissionError, "unknown import"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_cycle_rejected(self):
        units = synthetic_units()
        units["core/scalars"]["imports"] = ["core/scalars"]
        with self.assertRaisesRegex(AdmissionError, "dependency cycle"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_ambient_host_effect_rejected_even_in_core_unit(self):
        units = synthetic_units()
        units["core/scalars"]["effects"] = ["clock.ambient"]
        with self.assertRaisesRegex(AdmissionError, "forbidden effect"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_timed_feature_needs_explicit_monotonic_clock(self):
        units = synthetic_units()
        units["std/otp/supervisor"]["requires"].append("clock.monotonic")
        with self.assertRaisesRegex(AdmissionError, "missing feature"):
            audit_closure(units, ["std/otp/supervisor"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["supervisor"]["requires"])
        audit_closure(units, ["std/otp/supervisor"],
                      allowed_layers={"core", "actor", "otp"},
                      providers=ACTOR_PROVIDERS,
                      features=[*MODULES["supervisor"]["requires"],
                                "clock.monotonic"])

    def test_dynamic_allocation_is_not_implicit(self):
        units = synthetic_units()
        units["std/otp/event_manager"]["imports"].append("alloc/arena")
        units["alloc/arena"] = {"layer": "alloc", "imports": ["core/scalars"]}
        with self.assertRaisesRegex(AdmissionError, "forbidden or unknown layer"):
            audit_closure(units, ["std/otp/event_manager"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["event_manager"]["requires"])
        audit_closure(units, ["std/otp/event_manager"],
                      allowed_layers={"core", "actor", "otp", "alloc"},
                      providers=[*ACTOR_PROVIDERS, "explicit-memory-provider"],
                      features=MODULES["event_manager"]["requires"])

    def test_this_model_never_advertises_source_implementation(self):
        self.assertIs(MANIFEST["sourceImplementationAvailable"], False)
        self.assertEqual(MANIFEST["status"], "contract-only")
        for module in MODULES.values():
            self.assertEqual(module["sourceStatus"], "pending")
            self.assertIs(module["executableTestsPassed"], False)


if __name__ == "__main__":
    unittest.main()
