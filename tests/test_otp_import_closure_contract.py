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
PORTABLE_LAYERS = frozenset({"core", "alloc", "actor", "otp"})
FORBIDDEN_HOST_EFFECTS = frozenset(MANIFEST["forbiddenHostEffects"])


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
    # The source language may have legal cyclic import graphs. Rejecting every
    # graph cycle here would incorrectly conflate import closure with the
    # separate compiler decision about cyclic static initialization.
    #
    # Bound work before dependency expansion and use an explicit stack rather
    # than Python recursion, including on adversarial generated-source graphs.
    visited = set()
    pending = list(roots)
    edges = 0
    if len(pending) > 4096:
        raise AdmissionError("too many import roots")

    while pending:
        name = pending.pop()
        if name in visited:
            continue
        if name not in units:
            raise AdmissionError("unknown import: " + str(name))
        if len(visited) >= 4096:
            raise AdmissionError("import closure exceeds 4096 units")
        unit = units[name]
        if not isinstance(unit, dict):
            raise AdmissionError("invalid source unit: " + str(name))
        layer = unit.get("layer")
        if layer not in LAYERS or layer not in allowed_layers:
            raise AdmissionError("forbidden or unknown layer: " + str(layer))
        if not set(LAYERS[layer]["requiredProviders"]) <= providers:
            raise AdmissionError("missing layer provider: " + name)
        # This remains a reference model, but malformed metadata must never
        # be treated as an empty/iterable string list or raise an uncontrolled
        # TypeError. A real compiler must additionally authenticate provenance.
        def bounded_names(key):
            raw = unit.get(key, [])
            if not isinstance(raw, (list, tuple)) or len(raw) > 256:
                raise AdmissionError("invalid source " + key + ": " + name)
            if any(not isinstance(x, str) or not x or len(x) > 512 for x in raw):
                raise AdmissionError("invalid source " + key + ": " + name)
            if len(set(raw)) != len(raw):
                raise AdmissionError("duplicate source " + key + ": " + name)
            return set(raw)
        if not bounded_names("requires") <= features:
            raise AdmissionError("missing feature: " + name)
        effects = bounded_names("effects")
        if layer in PORTABLE_LAYERS and effects & FORBIDDEN_HOST_EFFECTS:
            raise AdmissionError("portable host effect: " + name)
        if not effects <= allowed_effects:
            raise AdmissionError("forbidden effect: " + name)

        imported = unit.get("imports", [])
        if not isinstance(imported, (list, tuple)) or len(imported) > 256:
            raise AdmissionError("invalid or excessive imports: " + name)
        permitted = (set(LAYERS[layer]["dependsOn"]) |
                     set(LAYERS[layer].get("optionalDependsOn", [])) |
                     {layer})
        for dep in imported:
            edges += 1
            if edges > 65536:
                raise AdmissionError("import closure exceeds 65536 edges")
            if not isinstance(dep, str) or dep not in units:
                raise AdmissionError("unknown import: " + str(dep))
            if not isinstance(units[dep], dict):
                raise AdmissionError("invalid imported unit: " + dep)
            if units[dep].get("layer") not in permitted:
                raise AdmissionError("forbidden layer edge: " + name + " -> " + dep)
            if dep not in visited:
                pending.append(dep)
        visited.add(name)

    return frozenset(visited)


def synthetic_units():
    """The normative eight-module inventory as hypothetical parsed units."""
    units = {
        "core/scalars": {"layer": "core"},
        "actor/mail": {"layer": "actor", "imports": ["core/scalars"]},
    }
    for name, module in MODULES.items():
        units[MANIFEST["canonicalImportPrefix"] + name] = {
            "layer": module["layer"],
            "imports": ["actor/mail"],
            "requires": list(module["requires"]),
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

    def test_all_eight_otp_modules_can_have_freestanding_source_closure(self):
        units = synthetic_units()
        mandatory_features = {
            feature for module in MODULES.values() for feature in module["requires"]
        }
        roots = [MANIFEST["canonicalImportPrefix"] + name for name in MODULES]
        closure = audit_closure(
            units, roots, allowed_layers={"core", "actor", "otp"},
            providers=ACTOR_PROVIDERS, features=mandatory_features,
        )
        self.assertEqual(len(roots), 8)
        self.assertEqual(len(closure), 10)
        self.assertNotIn("host-adapter", {units[x]["layer"] for x in closure})

    def test_pg_and_ets_require_explicit_feature_sets(self):
        units = synthetic_units()
        for module in ("pg", "ets"):
            with self.subTest(module=module):
                with self.assertRaisesRegex(AdmissionError, "missing feature"):
                    audit_closure(
                        units, ["otp/" + module],
                        allowed_layers={"core", "actor", "otp"},
                        providers=ACTOR_PROVIDERS,
                        features=set(MODULES[module]["requires"]) - {
                            MODULES[module]["requires"][-1]
                        },
                    )
                audit_closure(
                    units, ["otp/" + module],
                    allowed_layers={"core", "actor", "otp"},
                    providers=ACTOR_PROVIDERS,
                    features=MODULES[module]["requires"],
                )


    def test_missing_mandatory_otp_feature_rejects(self):
        units = synthetic_units()
        with self.assertRaisesRegex(AdmissionError, "missing feature"):
            audit_closure(units, ["otp/gen_server"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS, features={"actor.serial"})

    def test_transitive_host_import_forbidden_in_otp(self):
        units = synthetic_units()
        units["std/net"] = {
            "layer": "host-adapter", "effects": ["network"],
            "imports": ["core/scalars"],
        }
        units["otp/registry"]["imports"].append("std/net")
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(units, ["otp/registry"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["registry"]["requires"])

    def test_hosted_profile_never_licenses_core_to_import_os(self):
        units = synthetic_units()
        units["std/net"] = {
            "layer": "host-adapter", "effects": ["network"],
        }
        units["core/scalars"]["imports"] = ["std/net"]
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(
                units, ["core/scalars"],
                allowed_layers={"core", "actor", "otp", "alloc", "host-adapter"},
                providers=[*ACTOR_PROVIDERS, "explicit-host-capabilities"],
                allowed_effects={"network"},
            )

    def test_core_cannot_import_actor_directly_or_transitively(self):
        units = synthetic_units()
        units["core/leaky"] = {
            "layer": "core", "imports": ["actor/mail"],
        }
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(units, ["core/leaky"], allowed_layers={"core"})

    def test_malformed_effect_and_feature_metadata_fail_closed(self):
        for field, malformed in (
                ("effects", "network"), ("effects", [123]),
                ("effects", [["network"]]), ("effects", ["os", "os"]),
                ("requires", "actor.serial"),
                ("requires", ["actor.serial", "actor.serial"]),
                ("requires", ["x"] * 257)):
            units = synthetic_units()
            units["core/scalars"][field] = malformed
            with self.subTest(field=field, malformed=str(malformed)[:60]):
                with self.assertRaisesRegex(AdmissionError, "invalid|duplicate"):
                    audit_closure(units, ["core/scalars"],
                                  allowed_layers={"core"},
                                  features={"actor.serial"},
                                  allowed_effects={"network"})

    def test_unknown_import_rejected_and_no_host_fallback(self):
        units = synthetic_units()
        units["core/scalars"]["imports"] = ["stdlib/unknown"]
        with self.assertRaisesRegex(AdmissionError, "unknown import"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_legal_import_cycle_terminates_without_skipping_closure(self):
        units = synthetic_units()
        units["core/scalars"]["imports"] = ["core/helpers"]
        units["core/helpers"] = {
            "layer": "core", "imports": ["core/scalars"],
        }
        self.assertEqual(
            audit_closure(units, ["core/scalars"], allowed_layers={"core"}),
            frozenset({"core/scalars", "core/helpers"}),
        )

    def test_cyclic_import_does_not_hide_forbidden_layer_edge(self):
        units = synthetic_units()
        units["core/scalars"]["imports"] = ["core/helpers"]
        units["core/helpers"] = {
            "layer": "core", "imports": ["core/scalars", "actor/mail"],
        }
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_deep_import_chain_avoids_recursive_stack_overflow(self):
        units = {
            "core/" + str(i): {
                "layer": "core",
                "imports": [] if i == 2999 else ["core/" + str(i + 1)],
            }
            for i in range(3000)
        }
        self.assertEqual(
            len(audit_closure(units, ["core/0"], allowed_layers={"core"})),
            3000,
        )

    def test_import_fanout_and_closure_size_are_bounded(self):
        units = {"core/root": {
            "layer": "core",
            "imports": ["core/" + str(i) for i in range(257)],
        }}
        for i in range(257):
            units["core/" + str(i)] = {"layer": "core"}
        with self.assertRaisesRegex(AdmissionError, "excessive imports"):
            audit_closure(units, ["core/root"], allowed_layers={"core"})

        chain = {
            "core/" + str(i): {
                "layer": "core",
                "imports": [] if i == 4096 else ["core/" + str(i + 1)],
            }
            for i in range(4097)
        }
        with self.assertRaisesRegex(AdmissionError, "exceeds 4096 units"):
            audit_closure(chain, ["core/0"], allowed_layers={"core"})

    def test_ambient_host_effect_rejected_even_in_core_unit(self):
        units = synthetic_units()
        units["core/scalars"]["effects"] = ["clock.ambient"]
        with self.assertRaisesRegex(AdmissionError, "portable host effect"):
            audit_closure(units, ["core/scalars"], allowed_layers={"core"})

    def test_timed_feature_needs_explicit_monotonic_clock(self):
        units = synthetic_units()
        units["otp/supervisor"]["requires"].append("clock.monotonic")
        with self.assertRaisesRegex(AdmissionError, "missing feature"):
            audit_closure(units, ["otp/supervisor"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["supervisor"]["requires"])
        audit_closure(units, ["otp/supervisor"],
                      allowed_layers={"core", "actor", "otp"},
                      providers=ACTOR_PROVIDERS,
                      features=[*MODULES["supervisor"]["requires"],
                                "clock.monotonic"])

    def test_dynamic_allocation_is_not_implicit(self):
        units = synthetic_units()
        units["otp/event_manager"]["imports"].append("alloc/arena")
        units["alloc/arena"] = {"layer": "alloc", "imports": ["core/scalars"]}
        with self.assertRaisesRegex(AdmissionError, "forbidden or unknown layer"):
            audit_closure(units, ["otp/event_manager"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["event_manager"]["requires"])
        audit_closure(units, ["otp/event_manager"],
                      allowed_layers={"core", "actor", "otp", "alloc"},
                      providers=[*ACTOR_PROVIDERS, "explicit-memory-provider"],
                      features=MODULES["event_manager"]["requires"])

    def test_optional_alloc_edges_are_explicit_and_nothing_reaches_host(self):
        self.assertEqual(LAYERS["core"]["optionalDependsOn"], [])
        for layer in LAYERS.values():
            self.assertNotIn("host-adapter", layer["dependsOn"])
            self.assertNotIn("host-adapter", layer["optionalDependsOn"])
        self.assertEqual(LAYERS["otp"]["optionalDependsOn"], ["alloc"])
        self.assertEqual(LAYERS["actor"]["optionalDependsOn"], ["alloc"])

    def test_actor_cannot_import_otp_even_when_otp_is_available(self):
        units = synthetic_units()
        units["actor/mail"]["imports"].append("otp/gen_server")
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(units, ["actor/mail"],
                          allowed_layers={"core", "actor", "otp"},
                          providers=ACTOR_PROVIDERS,
                          features=MODULES["gen_server"]["requires"])

    def test_portable_host_effect_not_waived_by_hosted_app_grant(self):
        units = synthetic_units()
        units["core/scalars"]["effects"] = ["network"]
        with self.assertRaisesRegex(AdmissionError, "portable host effect"):
            audit_closure(units, ["core/scalars"],
                          allowed_layers={"core", "host-adapter"},
                          providers={"explicit-host-capabilities"},
                          allowed_effects={"network"})

    def test_this_model_never_advertises_source_implementation(self):
        self.assertIs(MANIFEST["sourceImplementationAvailable"], False)
        self.assertEqual(MANIFEST["status"], "contract-only")
        for module in MODULES.values():
            self.assertEqual(module["sourceStatus"], "pending")
            self.assertIs(module["executableTestsPassed"], False)


if __name__ == "__main__":
    unittest.main()
