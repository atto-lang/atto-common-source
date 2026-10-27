#!/usr/bin/env python3
"""Reference closure model for core/std OTP portability.

This validates metadata semantics only. It is not a compiler, linker, runtime,
bare-metal binary, or hardware execution proof.
"""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = json.loads(
    (ROOT / "contracts/library/v1/otp-portability.json").read_text(
        encoding="utf-8"
    )
)
LAYERS = {item["id"]: item for item in MANIFEST["layers"]}
MODULES = {item["module"]: item for item in MANIFEST["modules"]}
PROVIDER_KINDS = frozenset(MANIFEST["providerKinds"])
ACTOR_PROVIDERS = frozenset(MANIFEST["actorProviders"])
FORBIDDEN_HOST_EFFECTS = frozenset(MANIFEST["forbiddenHostEffects"])


class AdmissionError(ValueError):
    pass


def _bounded_names(unit, key, name):
    raw = unit.get(key, [])
    if not isinstance(raw, (list, tuple)) or len(raw) > 256:
        raise AdmissionError("invalid source " + key + ": " + name)
    if any(not isinstance(x, str) or not x or len(x) > 512 for x in raw):
        raise AdmissionError("invalid source " + key + ": " + name)
    if len(set(raw)) != len(raw):
        raise AdmissionError("duplicate source " + key + ": " + name)
    return set(raw)


def audit_closure(
    units,
    roots,
    *,
    allowed_layers,
    providers=(),
    features=(),
    allowed_effects=(),
):
    """Walk verified unit metadata and enforce layer/provider/effect closure."""
    allowed_layers = set(allowed_layers)
    providers = set(providers)
    features = set(features)
    allowed_effects = set(allowed_effects)

    unknown_providers = providers - PROVIDER_KINDS
    if unknown_providers:
        raise AdmissionError(
            "unknown provider grant: " + ",".join(sorted(unknown_providers))
        )

    pending = list(roots)
    if len(pending) > 4096:
        raise AdmissionError("too many import roots")

    visited = set()
    edges = 0
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

        required_providers = _bounded_names(unit, "providerRequires", name)
        if not required_providers <= PROVIDER_KINDS:
            raise AdmissionError("unknown source provider: " + name)
        if not required_providers <= providers:
            raise AdmissionError("missing provider: " + name)

        required_features = _bounded_names(unit, "requires", name)
        if not required_features <= features:
            raise AdmissionError("missing feature: " + name)

        effects = _bounded_names(unit, "effects", name)
        if layer == "core" and effects & FORBIDDEN_HOST_EFFECTS:
            raise AdmissionError("core host effect: " + name)
        if not effects <= allowed_effects:
            raise AdmissionError("forbidden effect: " + name)

        imports = unit.get("imports", [])
        if not isinstance(imports, (list, tuple)) or len(imports) > 256:
            raise AdmissionError("invalid or excessive imports: " + name)

        permitted_layers = set(LAYERS[layer]["dependsOn"]) | {layer}
        for dep in imports:
            edges += 1
            if edges > 65536:
                raise AdmissionError("import closure exceeds 65536 edges")
            if not isinstance(dep, str) or dep not in units:
                raise AdmissionError("unknown import: " + str(dep))
            imported = units[dep]
            if not isinstance(imported, dict):
                raise AdmissionError("invalid imported unit: " + dep)
            if imported.get("layer") not in permitted_layers:
                raise AdmissionError("forbidden layer edge: " + name + " -> " + dep)
            if dep not in visited:
                pending.append(dep)

        visited.add(name)

    return frozenset(visited)


def synthetic_units():
    units = {
        "ores.core/scalars": {"layer": "core"},
        "ores.core/actor-mail": {
            "layer": "core",
            "imports": ["ores.core/scalars"],
            "providerRequires": list(ACTOR_PROVIDERS),
        },
    }
    for name, module in MODULES.items():
        units[MANIFEST["canonicalImportPrefix"] + name] = {
            "layer": module["layer"],
            "imports": ["ores.core/actor-mail"],
            "requires": list(module["requires"]),
            "providerRequires": list(module["providerRequires"]),
        }
    return units


class ImportClosureReferenceTests(unittest.TestCase):
    def test_core_only_compiles_without_providers(self):
        units = synthetic_units()
        self.assertEqual(
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core"},
            ),
            frozenset({"ores.core/scalars"}),
        )

    def test_actor_capability_requires_explicit_providers(self):
        units = synthetic_units()
        with self.assertRaisesRegex(AdmissionError, "missing provider"):
            audit_closure(
                units,
                ["ores.core/actor-mail"],
                allowed_layers={"core"},
            )
        self.assertIn(
            "ores.core/actor-mail",
            audit_closure(
                units,
                ["ores.core/actor-mail"],
                allowed_layers={"core"},
                providers=ACTOR_PROVIDERS,
            ),
        )

    def test_all_eight_otp_modules_fit_core_with_explicit_providers(self):
        units = synthetic_units()
        features = {
            feature
            for module in MODULES.values()
            for feature in module["requires"]
        }
        roots = [MANIFEST["canonicalImportPrefix"] + x for x in MODULES]
        closure = audit_closure(
            units,
            roots,
            allowed_layers={"core"},
            providers=ACTOR_PROVIDERS,
            features=features,
        )
        self.assertEqual(len(roots), 8)
        self.assertEqual(len(closure), 10)
        self.assertEqual({units[x]["layer"] for x in closure}, {"core"})

    def test_pg_and_ets_require_their_features(self):
        units = synthetic_units()
        for module in ("pg", "ets"):
            required = set(MODULES[module]["requires"])
            missing = next(iter(required))
            with self.subTest(module=module):
                with self.assertRaisesRegex(AdmissionError, "missing feature"):
                    audit_closure(
                        units,
                        ["otp/" + module],
                        allowed_layers={"core"},
                        providers=ACTOR_PROVIDERS,
                        features=required - {missing},
                    )

    def test_core_to_std_is_rejected_even_in_hosted_build(self):
        units = synthetic_units()
        units["ores.std/net"] = {
            "layer": "std",
            "effects": ["network"],
        }
        units["ores.core/scalars"]["imports"] = ["ores.std/net"]
        with self.assertRaisesRegex(AdmissionError, "forbidden layer edge"):
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core", "std"},
                providers={"host.capabilities.explicit"},
                allowed_effects={"network"},
            )

    def test_std_may_import_core_when_effect_is_explicitly_admitted(self):
        units = synthetic_units()
        units["ores.std/net"] = {
            "layer": "std",
            "imports": ["ores.core/scalars"],
            "effects": ["network"],
            "providerRequires": ["host.capabilities.explicit"],
        }
        closure = audit_closure(
            units,
            ["ores.std/net"],
            allowed_layers={"core", "std"},
            providers={"host.capabilities.explicit"},
            allowed_effects={"network"},
        )
        self.assertEqual(
            closure,
            frozenset({"ores.std/net", "ores.core/scalars"}),
        )

    def test_core_host_effect_is_not_waived_by_host_grant(self):
        units = synthetic_units()
        units["ores.core/scalars"]["effects"] = ["network"]
        with self.assertRaisesRegex(AdmissionError, "core host effect"):
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core", "std"},
                providers={"host.capabilities.explicit"},
                allowed_effects={"network"},
            )

    def test_allocator_and_clock_are_explicit_providers_not_layers(self):
        units = synthetic_units()
        units["otp/supervisor"]["providerRequires"].append("clock.monotonic")
        units["otp/event_manager"]["providerRequires"].append(
            "allocator.explicit"
        )
        with self.assertRaisesRegex(AdmissionError, "missing provider"):
            audit_closure(
                units,
                ["otp/supervisor"],
                allowed_layers={"core"},
                providers=ACTOR_PROVIDERS,
                features=MODULES["supervisor"]["requires"],
            )
        with self.assertRaisesRegex(AdmissionError, "missing provider"):
            audit_closure(
                units,
                ["otp/event_manager"],
                allowed_layers={"core"},
                providers=ACTOR_PROVIDERS,
                features=MODULES["event_manager"]["requires"],
            )
        audit_closure(
            units,
            ["otp/supervisor", "otp/event_manager"],
            allowed_layers={"core"},
            providers={
                *ACTOR_PROVIDERS,
                "clock.monotonic",
                "allocator.explicit",
            },
            features={
                *MODULES["supervisor"]["requires"],
                *MODULES["event_manager"]["requires"],
            },
        )

    def test_unknown_or_overbroad_provider_grants_fail_closed(self):
        units = synthetic_units()
        with self.assertRaisesRegex(AdmissionError, "unknown provider grant"):
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core"},
                providers={"ambient.magic"},
            )
        units["ores.core/scalars"]["providerRequires"] = ["ambient.magic"]
        with self.assertRaisesRegex(AdmissionError, "unknown source provider"):
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core"},
            )

    def test_malformed_metadata_fails_closed(self):
        for field, malformed in (
            ("effects", "network"),
            ("effects", [123]),
            ("effects", ["os", "os"]),
            ("requires", "actor.serial"),
            ("requires", ["x"] * 257),
            ("providerRequires", "allocator.explicit"),
            ("providerRequires", ["allocator.explicit", "allocator.explicit"]),
        ):
            units = synthetic_units()
            units["ores.core/scalars"][field] = malformed
            with self.subTest(field=field):
                with self.assertRaisesRegex(AdmissionError, "invalid|duplicate"):
                    audit_closure(
                        units,
                        ["ores.core/scalars"],
                        allowed_layers={"core"},
                        providers={"allocator.explicit"},
                        features={"actor.serial"},
                        allowed_effects={"network"},
                    )

    def test_unknown_import_rejected_without_host_fallback(self):
        units = synthetic_units()
        units["ores.core/scalars"]["imports"] = ["ores.std/unknown"]
        with self.assertRaisesRegex(AdmissionError, "unknown import"):
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core"},
            )

    def test_legal_core_cycle_terminates(self):
        units = synthetic_units()
        units["ores.core/scalars"]["imports"] = ["ores.core/helpers"]
        units["ores.core/helpers"] = {
            "layer": "core",
            "imports": ["ores.core/scalars"],
        }
        self.assertEqual(
            audit_closure(
                units,
                ["ores.core/scalars"],
                allowed_layers={"core"},
            ),
            frozenset({"ores.core/scalars", "ores.core/helpers"}),
        )

    def test_deep_import_chain_is_iterative_and_bounded(self):
        units = {
            "ores.core/" + str(i): {
                "layer": "core",
                "imports": [] if i == 2999 else ["ores.core/" + str(i + 1)],
            }
            for i in range(3000)
        }
        self.assertEqual(
            len(
                audit_closure(
                    units,
                    ["ores.core/0"],
                    allowed_layers={"core"},
                )
            ),
            3000,
        )

        too_large = {
            "ores.core/" + str(i): {
                "layer": "core",
                "imports": [] if i == 4096 else ["ores.core/" + str(i + 1)],
            }
            for i in range(4097)
        }
        with self.assertRaisesRegex(AdmissionError, "exceeds 4096 units"):
            audit_closure(
                too_large,
                ["ores.core/0"],
                allowed_layers={"core"},
            )

    def test_import_fanout_is_bounded(self):
        units = {
            "ores.core/root": {
                "layer": "core",
                "imports": ["ores.core/" + str(i) for i in range(257)],
            }
        }
        for i in range(257):
            units["ores.core/" + str(i)] = {"layer": "core"}
        with self.assertRaisesRegex(AdmissionError, "excessive imports"):
            audit_closure(
                units,
                ["ores.core/root"],
                allowed_layers={"core"},
            )

    def test_model_never_advertises_source_implementation(self):
        self.assertIs(MANIFEST["sourceImplementationAvailable"], False)
        self.assertEqual(MANIFEST["status"], "contract-only")
        for module in MODULES.values():
            self.assertEqual(module["sourceStatus"], "pending")
            self.assertIs(module["executableTestsPassed"], False)


if __name__ == "__main__":
    unittest.main()
