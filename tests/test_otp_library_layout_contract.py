"""Contract checks only: they do not execute or implement OTP actors.

The manifest intentionally remains proposal-only until actual guest-source
Oreslang modules, compiler admission and backend execution are evidenced.
"""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "otp-library-layout.v1.json"
EXPECTED = {
    "gen_server", "supervisor", "gen_statem",
    "application", "event_manager", "registry",
}
LAYERS = {"core", "alloc", "actor", "otp", "std"}
PORTABLE = {"core", "alloc", "actor", "otp"}
REQUIRES_RE = re.compile(r"^(actor\.[a-z][a-z0-9_]*|alloc)$")


def verify(data):
    if data.get("schemaVersion") != 1 or data.get("status") != "proposal-only":
        raise ValueError("unknown version or misleading availability status")
    if data.get("physicalRoot") != "stdlib" or data.get("canonicalImportPrefix") != "otp/":
        raise ValueError("physical layout or canonical import namespace drift")

    layers = data.get("dependencyLayers")
    if not isinstance(layers, dict) or set(layers) != LAYERS:
        raise ValueError("unknown or missing library layer")
    for name, spec in layers.items():
        required = spec.get("imports", [])
        optional = spec.get("optionalImports", [])
        if len(required) != len(set(required)) or len(optional) != len(set(optional)):
            raise ValueError(f"duplicate dependency for {name}")
        if not set(required + optional) <= LAYERS - {name}:
            raise ValueError(f"invalid dependency for {name}")
        if set(required) & set(optional):
            raise ValueError(f"dependency both required and optional: {name}")
        if name in PORTABLE and spec.get("osRequired") is not False:
            raise ValueError(f"portable {name} depends on OS")
        if name == "core" and (required or optional or spec.get("heapRequired") is not False):
            raise ValueError("core must be standalone and heap-independent")
        if name in {"core", "alloc", "actor"} and (
            "std" in required + optional or "otp" in required + optional
        ):
            raise ValueError(f"lower layer {name} depends on OTP or std")
        if name == "otp" and "std" in required + optional:
            raise ValueError("portable OTP depends on std")

    # Reject circular imports even among otherwise individually valid edges.
    visiting, visited = set(), set()

    def dfs(name):
        if name in visiting:
            raise ValueError(f"dependency cycle at {name}")
        if name in visited:
            return
        visiting.add(name)
        spec = layers[name]
        for dep in spec.get("imports", []) + spec.get("optionalImports", []):
            dfs(dep)
        visiting.remove(name)
        visited.add(name)

    for layer in sorted(LAYERS):
        dfs(layer)

    if set(data.get("profiles", {})) != {
        "freestanding-core", "freestanding-alloc", "freestanding-actor",
        "freestanding-otp", "hosted",
    }:
        raise ValueError("missing or extra target profile")
    for profile, included in data["profiles"].items():
        if len(included) != len(set(included)) or not set(included) <= LAYERS:
            raise ValueError(f"invalid profile: {profile}")
        if "core" not in included:
            raise ValueError(f"no core in {profile}")
        if profile.startswith("freestanding") and "std" in included:
            raise ValueError(f"freestanding profile imports std: {profile}")
        for layer in included:
            if not set(layers[layer]["imports"]) <= set(included):
                raise ValueError(f"profile misses required layer imports: {profile}")
        if profile == "freestanding-core" and set(included) != {"core"}:
            raise ValueError("freestanding-core must import only core")
        if profile == "freestanding-otp" and "otp" not in included:
            raise ValueError("freestanding OTP profile omits OTP")

    behaviours = data.get("behaviours")
    if not isinstance(behaviours, list) or len(behaviours) != len(EXPECTED):
        raise ValueError("exactly six OTP behaviour contracts required")
    names, sources, imports = set(), set(), set()
    for item in behaviours:
        name = item.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            raise ValueError("invalid behaviour name")
        if name in names:
            raise ValueError(f"duplicate behaviour name: {name}")
        names.add(name)
        source = f"stdlib/otp/{name}.ores"
        canonical = f"otp/{name}"
        if item.get("source") != source or item.get("import") != canonical:
            raise ValueError(f"source and logical import mismatch for {name}")
        if source in sources or canonical in imports:
            raise ValueError("duplicate source or canonical import")
        sources.add(source)
        imports.add(canonical)
        if item.get("implemented") is not False:
            raise ValueError(f"{name}: do not assert OTP implemented without executable proof")
        required = item.get("requires", [])
        optional = item.get("optional", [])
        if not required or not isinstance(required, list) or not isinstance(optional, list):
            raise ValueError(f"{name}: missing feature requirements")
        if len(required) != len(set(required)) or len(optional) != len(set(optional)):
            raise ValueError(f"{name}: duplicate feature requirement")
        if not all(isinstance(f, str) and REQUIRES_RE.fullmatch(f) for f in required + optional):
            raise ValueError(f"{name}: unknown or hosted feature requirement")
        if set(required) & set(optional):
            raise ValueError(f"{name}: overlapping feature requirements")
    if names != EXPECTED:
        raise ValueError(f"behaviour inventory drift: {sorted(EXPECTED - names)}")

    hosted = data.get("hostedExtensions", [])
    if len(hosted) != len(set(hosted)) or not all(
        isinstance(s, str) and not s.startswith(("core/", "actor/"))
        and ".." not in s for s in hosted
    ):
        raise ValueError("invalid hosted extension inventory")
    return True


class OtpLibraryLayoutContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_manifest_well_formed_and_portable(self):
        self.assertTrue(verify(self.contract))

    def test_rejects_hosted_dependency_on_core(self):
        data = copy.deepcopy(self.contract)
        data["dependencyLayers"]["core"]["imports"] = ["std"]
        with self.assertRaises(ValueError):
            verify(data)

    def test_rejects_otp_requiring_std(self):
        data = copy.deepcopy(self.contract)
        data["dependencyLayers"]["otp"]["imports"].append("std")
        with self.assertRaises(ValueError):
            verify(data)

    def test_rejects_dependency_cycles(self):
        data = copy.deepcopy(self.contract)
        data["dependencyLayers"]["alloc"]["imports"] = ["actor"]
        with self.assertRaises(ValueError):
            verify(data)

    def test_rejects_hosted_feature_in_portable_otp(self):
        data = copy.deepcopy(self.contract)
        data["behaviours"][0]["requires"].append("std.net")
        with self.assertRaises(ValueError):
            verify(data)

    def test_rejects_missing_behaviour_or_path_drift(self):
        for mutation in ("remove", "path"):
            data = copy.deepcopy(self.contract)
            if mutation == "remove":
                data["behaviours"].pop()
            else:
                data["behaviours"][0]["source"] = "stdlib/std/otp/gen_server.ores"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                verify(data)

    def test_rejects_unproven_implementation(self):
        data = copy.deepcopy(self.contract)
        data["behaviours"][0]["implemented"] = True
        with self.assertRaises(ValueError):
            verify(data)

    def test_rejects_std_in_freestanding_profile(self):
        data = copy.deepcopy(self.contract)
        data["profiles"]["freestanding-otp"].append("std")
        with self.assertRaises(ValueError):
            verify(data)


if __name__ == "__main__":
    unittest.main()
