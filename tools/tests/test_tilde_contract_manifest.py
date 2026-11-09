"""Source-only adversarial contract validation; NOT AttoLang compiler tests."""
from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "fixtures/tilde-aggregate-match-v1/manifest.json"
SCRIPT = ROOT / "tools/check-tilde-aggregate-match-v1.py"
SPEC = importlib.util.spec_from_file_location("tilde_contract_check", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def baseline():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


class SourceOnlyTildeContractTests(unittest.TestCase):
    def test_unmodified_manifest_is_well_formed(self):
        data = baseline()
        self.assertEqual(checker.validate(data), [])
        self.assertEqual(data["counts"], {"accept": 22, "reject": 25, "total": 47})
        self.assertEqual(len({x["id"] for x in data["cases"]}), 47)

    def test_top_level_fail_closed(self):
        for bad in (None, [], "hello", 0, False):
            with self.subTest(value=repr(bad)):
                self.assertTrue(checker.validate(bad, check_spec=False))
        mutations = {
            "wrong_schema": lambda d: d.update(schema="attolang.other.v1"),
            "wrong_status": lambda d: d.update(status="EXECUTED"),
            "false_certification": lambda d: d.update(certification="CERTIFIED"),
            "false_java_evidence": lambda d: d["evidence"].update(java="PASS"),
            "missing_forge": lambda d: d["evidence"].pop("forge"),
            "all_fake_evidence": lambda d: d.update(evidence=dict.fromkeys(checker.BACKENDS, "PASS")),
            "duplicate_backend": lambda d: d["backends"].append("java"),
            "missing_backend": lambda d: d["backends"].remove("forge"),
            "wrong_order": lambda d: d["backends"].reverse(),
            "wrong_feature": lambda d: d.update(feature="map-only"),
            "bad_source_extension": lambda d: d.update(source_extension=".exe"),
            "path_traversal_spec": lambda d: d.update(spec="../../outside.md"),
            "wrong_counts": lambda d: d["counts"].update(total=42),
            "remove_case": lambda d: d["cases"].pop(),
            "duplicate_case": lambda d: d["cases"].append(copy.deepcopy(d["cases"][0])),
            "cases_not_list": lambda d: d.update(cases={}),
        }
        for name, mutate in mutations.items():
            with self.subTest(mutation=name):
                data = baseline()
                mutate(data)
                self.assertTrue(checker.validate(data, check_spec=False), msg=name)

    def test_case_level_fail_closed(self):
        positive = 0
        negative = 22
        mutations = [
            ("id_absent", positive, lambda c: c.pop("id")),
            ("id_bad_char", positive, lambda c: c.update(id="p01/unsafe")),
            ("duplicate_id", positive, lambda c: c.update(id="p02_record_explicit")),
            ("expected_vs_prefix", positive, lambda c: c.update(expected="reject")),
            ("unknown_kind", positive, lambda c: c.update(kind="superuser")),
            ("unknown_result", positive, lambda c: c.update(expected="skipped")),
            ("source_missing", positive, lambda c: c.pop("source")),
            ("source_blank", positive, lambda c: c.update(source="   ")),
            ("source_nul", positive, lambda c: c.update(source="abc\\x00def".replace("\\x00", "\x00"))),
            ("source_cr", positive, lambda c: c.update(source="abc\\rdef".replace("\\r", "\r"))),
            ("source_surrogate", positive, lambda c: c.update(source="abc\\ud800".replace("\\ud800", "\ud800"))),
            ("source_oversized", positive, lambda c: c.update(source="x" * 65537)),
            ("reason_blank", positive, lambda c: c.update(reason="")),
            ("fake_positive_exit", positive, lambda c: c.update(target_exit_code=0)),
            ("bool_exit", positive, lambda c: c.update(target_exit_code=True)),
            ("positive_negative_flag", positive, lambda c: c.update(no_guest_artifact_on_reject=True)),
            ("unexpected_metadata", positive, lambda c: c.update(verified=True)),
            ("negative_missing_rejection_gate", negative, lambda c: c.pop("no_guest_artifact_on_reject")),
            ("negative_false_rejection_gate", negative, lambda c: c.update(no_guest_artifact_on_reject=False)),
            ("negative_with_exit", negative, lambda c: c.update(target_exit_code=42)),
        ]
        for name, idx, mutate in mutations:
            with self.subTest(mutation=name):
                data = baseline()
                mutate(data["cases"][idx])
                self.assertTrue(checker.validate(data, check_spec=False), msg=name)

    def test_duplicate_raw_json_member_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            json.loads('{"status":"SOURCE_CONTRACT_ONLY","status":"CERTIFIED"}',
                       object_pairs_hook=checker._reject_duplicate_json_keys)


if __name__ == "__main__":
    unittest.main()
