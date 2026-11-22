"""Mutations and fixed-point tests for the untrusted typed-effect envelope."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("unified_typed_effects_v1", ROOT / "unified_typed_effects_v1.py")
effects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effects)


def fn(name, *, calls=(), direct=(), bound=None, work="bounded_claim", closure="complete"):
    return {"id": name, "closure": closure,
            "direct_effects": list(direct), "calls": list(calls),
            "work": work, "declared_bound": bound}


def call(*targets, kind="direct", phase="immediate"):
    return {"kind": kind, "targets": list(targets), "phase": phase}


def report(*functions, entries=("main",)):
    return {
        "version": 1, "kind": effects.KIND, "assurance": effects.ASSURANCE,
        "producer": {
            "backend": "reference", "revision": "a" * 40,
            "source_sha256": "b" * 64, "typed_ir_digest": "c" * 64
        },
        "entries": list(entries), "functions": list(functions)
    }


class TypedEffectV1Test(unittest.TestCase):
    def assessment(self, doc, profile):
        return effects.analyze(effects.parse(json.dumps(doc).encode()), [profile])["profiles"][profile]

    def test_pure_scalar_passes_as_model_not_certificate(self):
        d = report(fn("main"))
        self.assertTrue(self.assessment(d, "pure")["compatible_with_claimed_facts"])
        self.assertIn("NOT_COMPILER_CERTIFICATE", effects.analyze(d, ["pure"])["status"])

    def test_transitive_allocation_is_disallowed_even_through_helper(self):
        d = report(fn("main", calls=[call("helper")]), fn("helper", direct=["alloc"]))
        self.assertFalse(self.assessment(d, "no_alloc")["compatible_with_claimed_facts"])
        self.assertEqual(self.assessment(d, "no_alloc")["denied_effects"], ["alloc"])
        self.assertTrue(self.assessment(d, "pure")["compatible_with_claimed_facts"])

    def test_clock_is_nondeterministic_even_when_bound_includes_io(self):
        d = report(fn("main", direct=["io.clock", "nondet"], bound=["io", "nondet"]))
        a = self.assessment(d, "deterministic")
        self.assertFalse(a["compatible_with_claimed_facts"])
        self.assertEqual(a["denied_effects"], ["io.clock", "nondet"])

    def test_clock_claim_missing_nondet_is_invalid(self):
        d = report(fn("main", direct=["io.clock"]))
        with self.assertRaisesRegex(effects.InvalidEffectReport, "nondet"):
            self.assessment(d, "deterministic")

    def test_explicit_empty_effect_bound_is_not_inference(self):
        d = report(fn("main", calls=[call("helper")], bound=[]), fn("helper", direct=["alloc"]))
        with self.assertRaisesRegex(effects.InvalidEffectReport, "E_EFFECT_BOUND"):
            self.assessment(d, "no_alloc")

    def test_unknown_dispatch_and_missing_targets_reject(self):
        d = report(fn("main", calls=[call(kind="unknown")]))
        with self.assertRaisesRegex(effects.InvalidEffectReport, "E_EFFECT_UNKNOWN"):
            self.assessment(d, "pure")
        d["functions"][0]["calls"] = [call("missing")]
        with self.assertRaisesRegex(effects.InvalidEffectReport, "unresolved target"):
            self.assessment(d, "pure")

    def test_latent_invocation_and_cleanup_targets_not_erased(self):
        d = report(fn("main", calls=[call("task", phase="latent_poll"),
                                      call("drop", phase="cleanup")]),
                   fn("task", direct=["nondet"]), fn("drop", direct=["alloc"]))
        a = self.assessment(d, "deterministic")
        self.assertFalse(a["compatible_with_claimed_facts"])
        self.assertIn("nondet", a["denied_effects"])
        self.assertIn("alloc", self.assessment(d, "no_alloc")["denied_effects"])

    def test_effect_cycles_converge_not_wcet(self):
        d = report(fn("main", calls=[call("step")]),
                   fn("step", calls=[call("main")], direct=["alloc"]))
        self.assertIn("alloc", self.assessment(d, "no_alloc")["denied_effects"])
        self.assertIn("unbounded_recursion",
                      self.assessment(d, "hard_rt_screen")["denied_effects"])

    def test_claimed_bounded_work_not_certification(self):
        d = report(fn("main", work="bounded_claim"))
        out = effects.analyze(d, ["hard_rt_screen"])
        self.assertTrue(out["profiles"]["hard_rt_screen"]["compatible_with_claimed_facts"])
        self.assertEqual(out["status"],
                         "UNTRUSTED_INPUT_SOURCE_FREE_MODEL_NOT_COMPILER_CERTIFICATE")

    def test_unknown_work_rejected_by_rt_screen(self):
        d = report(fn("main", work="unknown"))
        self.assertIn("unbounded_work", self.assessment(d, "hard_rt_screen")["denied_effects"])

    def test_forged_certification_and_unknown_fields_reject(self):
        d = report(fn("main"))
        d["assurance"] = "CERTIFIED_HARD_REALTIME"
        with self.assertRaises(effects.InvalidEffectReport):
            self.assessment(d, "hard_rt_screen")
        d = report(fn("main"))
        d["functions"][0]["trusted"] = True
        with self.assertRaises(effects.InvalidEffectReport):
            self.assessment(d, "pure")

    def test_duplicate_json_key_and_oversize_reject(self):
        with self.assertRaises(effects.InvalidEffectReport):
            effects.parse(b'{"version":1,"version":1}')
        with self.assertRaises(effects.InvalidEffectReport):
            effects.parse(b" " * (effects.MAX_BYTES + 1))

    def test_malformed_input_and_invalid_digest_reject(self):
        d = report(fn("main"))
        d["producer"]["typed_ir_digest"] = "not-an-ir-hash"
        with self.assertRaises(effects.InvalidEffectReport):
            self.assessment(d, "pure")

    def test_unhashable_backend_claim_fails_with_structured_invalid_error(self):
        for adversarial in ([], {}, ["java"], 22, None, True):
            d = report(fn("main"))
            d["producer"]["backend"] = adversarial
            with self.subTest(backend=adversarial):
                with self.assertRaises(effects.InvalidEffectReport):
                    effects.parse(json.dumps(d).encode("utf-8"))

    def test_unhashable_backend_cli_exits_three_not_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "effects.json"
            doc = report(fn("main"))
            doc["producer"]["backend"] = {"forged": "java"}
            path.write_text(json.dumps(doc))
            p = subprocess.run([
                sys.executable, str(ROOT / "unified_typed_effects_v1.py"),
                str(path), "--profile", "pure"
            ], capture_output=True, text=True)
            self.assertEqual(p.returncode, 3, p.stderr)
            self.assertNotIn("Traceback", p.stderr)

    def test_case_with_extra_dormant_impure_function(self):
        d = report(fn("main"), fn("unreachable", direct=["nondet"]))
        self.assertTrue(self.assessment(d, "deterministic")["compatible_with_claimed_facts"])

    def test_cli_reports_distinct_invalid_incompatible_and_compatible_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "effects.json"
            for source, expected_code in [
                (report(fn("main")), 0),
                (report(fn("main", direct=["alloc"])), 2),
                ({"invalid": True}, 3)
            ]:
                path.write_text(json.dumps(source))
                completed = subprocess.run([
                    sys.executable, str(ROOT / "unified_typed_effects_v1.py"),
                    str(path), "--profile", "no_alloc"
                ], capture_output=True, text=True)
                self.assertEqual(completed.returncode, expected_code, completed.stderr)


if __name__ == "__main__":
    unittest.main()
