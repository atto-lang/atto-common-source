import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "v1" / "json-record-map-v1.json"


class JsonRecordMapContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_library_boundary_is_alloc_not_core_or_hosted_std(self):
        lib = self.data["library"]
        self.assertEqual("alloc/json", lib["public_namespace"])
        self.assertTrue(lib["requires_allocator"])
        self.assertFalse(lib["core_allowed"])
        self.assertFalse(lib["hosted_std_required"])
        self.assertEqual([], lib["os_capabilities_required"])

    def test_dynamic_json_object_uses_canonical_typed_map(self):
        obj = self.data["json_object"]
        mp = self.data["map"]
        self.assertEqual("String", obj["key_type"])
        self.assertEqual("Map<String, JsonValue>", obj["dynamic_storage"])
        self.assertFalse(obj["symbol_key_implicit_coercion"])
        self.assertEqual("reject", obj["duplicate_key_policy"])
        self.assertTrue(mp["recursive_json_value_descriptor_required"])
        self.assertTrue(mp["host_map_semantics_forbidden"])

    def test_map_index_write_and_put_have_one_semantic_contract(self):
        mp = self.data["map"]
        self.assertEqual("insert_or_replace", mp["indexed_assignment"])
        self.assertEqual("Option<V>", mp["named_put_previous_value"])

    def test_record_update_is_static_atomic_and_ownership_aware(self):
        update = self.data["record_update"]
        self.assertEqual("readonly_structural_record_only", update["base_kind"])
        self.assertTrue(update["static_keys_only"])
        self.assertEqual("reject", update["duplicate_update_fields"])
        self.assertEqual("replace_type_and_value", update["existing_field"])
        self.assertEqual("append_field_and_widen_row", update["missing_field"])
        self.assertEqual("Map", update["dynamic_key_fallback"])
        self.assertEqual("reject", update["readonly_record_indexed_assignment"])
        self.assertEqual("reject", update["structural_view_update"])
        self.assertEqual("base_once_then_updates_left_to_right", update["evaluation"])
        self.assertEqual("atomic_no_partial_publication", update["failure"])
        self.assertEqual(
            "consume_unless_checked_copy_or_share",
            update["move_only_base"],
        )

    def test_typed_codecs_are_static_and_do_not_bypass_classes(self):
        codec = self.data["typed_codec"]
        self.assertFalse(codec["runtime_reflection"])
        self.assertEqual("compile_time", codec["generation"])
        self.assertFalse(codec["class_private_field_poke"])
        self.assertTrue(codec["class_opt_in_required"])
        self.assertTrue(codec["direct_typed_decode_may_skip_dom"])

    def test_strict_parser_defaults_fail_closed(self):
        safety = self.data["safety"]
        self.assertEqual("reject", safety["malformed_utf8"])
        self.assertEqual("reject", safety["nan_infinity"])
        self.assertEqual("reject", safety["integer_precision_loss"])
        self.assertEqual("reject", safety["unpaired_surrogate_escape"])
        self.assertEqual("reject", safety["unescaped_control_character"])
        self.assertEqual("reject", safety["bom_default"])
        self.assertEqual("reject", safety["comments_default"])
        self.assertEqual("reject", safety["trailing_comma_default"])
        self.assertTrue(safety["ignored_unknown_fields_count_toward_quotas"])
        self.assertTrue(safety["explicit_resource_quotas_required"])
        self.assertFalse(safety["guest_callbacks_under_internal_lock"])

    def test_json_numbers_are_exact_until_target_conversion(self):
        number = self.data["json_number"]
        self.assertEqual("exact_before_target_conversion", number["representation"])
        self.assertEqual("preserve", number["integer_over_2_pow_53"])
        self.assertEqual("reject", number["non_finite"])
        self.assertEqual("reject_by_default", number["float_overflow"])

    def test_missing_null_and_codec_metadata_are_explicit(self):
        codec = self.data["typed_codec"]
        self.assertEqual("reject", codec["missing_required"])
        self.assertEqual("reject", codec["null_required"])
        self.assertEqual("None", codec["option_absent"])
        self.assertEqual("None", codec["option_null"])
        self.assertEqual("exact_case_sensitive", codec["field_match"])
        self.assertEqual("reject", codec["rename_collision"])
        self.assertFalse(codec["defaults_on_malformed_present_value"])
        self.assertEqual(
            "Map<String, JsonValue>",
            codec["unknown_capture_type"],
        )

    def test_ordinary_json_does_not_serialize_cycles_or_capabilities(self):
        encoding = self.data["encoding"]
        self.assertEqual("reject", encoding["ordinary_json_cycle"])
        self.assertEqual("reject", encoding["implicit_runtime_capabilities"])
        self.assertTrue(encoding["deterministic_for_fixed_value"])
        self.assertEqual(
            "separate_profile",
            encoding["cryptographic_canonicalization"],
        )


if __name__ == "__main__":
    unittest.main()
