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
        self.assertEqual("readonly_record_or_plain_struct", update["base_kind"])
        self.assertTrue(update["static_keys_only"])
        self.assertEqual("reject", update["duplicate_update_fields"])
        self.assertEqual("replace_type_and_value", update["existing_field"])
        self.assertEqual("append_field_and_widen_row", update["missing_field"])
        self.assertEqual("Map", update["dynamic_key_fallback"])
        self.assertEqual("reject", update["readonly_record_indexed_assignment"])
        self.assertEqual("plain_struct", update["plain_struct_result_kind"])
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
        self.assertEqual(
            "edge_creation_serialized_and_cycle_checked",
            safety["mutable_json_cycle_invariant"],
        )
        self.assertEqual(
            "all_json_object_mutations_share_global_guard_before_object_monitor",
            safety["graph_stability_mutations"],
        )
        self.assertEqual(
            "revalidate_depth_and_nodes_under_graph_stability_guard_before_recursive_externalization",
            safety["whole_tree_quota_boundary"],
        )

    def test_json_numbers_are_exact_until_target_conversion(self):
        number = self.data["json_number"]
        self.assertEqual("exact_before_target_conversion", number["representation"])
        self.assertEqual("preserve", number["integer_over_2_pow_53"])
        self.assertEqual("reject", number["non_finite"])
        self.assertEqual("reject_by_default", number["float_overflow"])
        self.assertEqual(
            "mathematically_integral_in_range_including_decimal_or_exponent_spelling",
            number["integer_target_acceptance"],
        )

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

    def test_dynamic_stringify_is_graph_stable_and_utf8_bounded(self):
        encoding = self.data["encoding"]
        self.assertEqual(
            "graph_stable_complete_root_validation_and_traversal",
            encoding["dynamic_object_stringify"],
        )
        self.assertEqual(
            "Map<String, JsonValue>",
            encoding["dynamic_object_input"],
        )
        self.assertEqual(
            "non_consuming_scoped_read",
            encoding["dynamic_object_read_semantics"],
        )
        self.assertEqual("utf8_bytes", encoding["output_quota_unit"])
        self.assertEqual(
            "canonical_map_insertion_order",
            encoding["dynamic_object_order"],
        )
        self.assertFalse(encoding["validate_then_unlock_then_traverse"])

    def test_ordinary_json_does_not_serialize_cycles_or_capabilities(self):
        encoding = self.data["encoding"]
        self.assertEqual("reject", encoding["ordinary_json_cycle"])
        self.assertEqual("reject", encoding["implicit_runtime_capabilities"])
        self.assertTrue(encoding["deterministic_for_fixed_value"])
        self.assertEqual(
            "separate_profile",
            encoding["cryptographic_canonicalization"],
        )


    def test_core_may_only_expose_allocation_free_json_contracts(self):
        lib = self.data["library"]
        self.assertTrue(lib["core_json_contracts_allowed"])
        self.assertFalse(lib["owned_json_tree_in_core"])
        self.assertFalse(lib["ambient_allocator_allowed"])
        self.assertEqual("explicit", lib["allocator_provider"])
        self.assertEqual(
            [
                "token_kinds",
                "borrowed_input_cursor",
                "caller_provided_encode_sink",
                "static_codec_markers",
            ],
            lib["core_contract_scope"],
        )

    def test_map_index_assignment_is_single_eval_and_transactional(self):
        mp = self.data["map"]
        self.assertEqual("direct_owned_mutable_map", mp["indexed_assignment_requires"])
        self.assertEqual(
            "authority_preflight_then_rhs_once_then_receiver_once_then_key_once",
            mp["indexed_assignment_evaluation"],
        )
        self.assertEqual(
            "receiver_and_authority_then_key_once_then_value_once",
            mp["named_put_evaluation"],
        )
        self.assertEqual(
            "validate_and_admit_new_before_publish_then_release_old",
            mp["replacement_atomicity"],
        )
        self.assertEqual(
            "runtime_attempt_returns_exact_uncommitted_value_on_rejection_then_compiler_commits_move_only_on_success",
            mp["move_only_fallible_insert"],
        )
        self.assertEqual(
            "one_shot_take_before_failure_rethrow",
            mp["owned_put_rejected_candidate"],
        )
        self.assertEqual(
            "one_shot_take_after_commit",
            mp["owned_put_previous_value"],
        )
        self.assertEqual(
            "source_moved_on_commit_normal_edge_restored_on_admission_failure_catch_edge",
            mp["compiler_exceptional_flow"],
        )
        self.assertEqual(
            "direct_terminal_write_or_named_put_binding_no_top_level_defer_no_live_mutex_guard",
            mp["java_current_catch_recovery_proof"],
        )
        self.assertEqual(
            "any_possible_later_throw_keeps_source_moved_on_catch_edge",
            mp["post_commit_throw_rule"],
        )
        self.assertEqual(
            "conservative_moved_on_catch_edge",
            mp["nested_write_recovery"],
        )
        self.assertEqual(
            "gated_until_recursive_typechecker_and_alloc_json_import",
            mp["source_move_only_map_visibility"],
        )
        self.assertEqual(
            "commit_rejection_edges_enabled_in_production_pass",
            mp["ownership_checker_staging"],
        )
        self.assertEqual(
            "recover_candidate_before_rethrow_take_previous_on_commit",
            mp["evaluator_owned_put_lowering"],
        )
        self.assertEqual(
            "direct_statement_only_until_linear_assignment_result_defined",
            mp["move_only_indexed_assignment_staging"],
        )
        self.assertEqual(
            "direct_statement_or_direct_binding_until_nested_expression_throw_edges",
            mp["move_only_named_put_staging"],
        )
        self.assertEqual(
            "internal_lowering_only",
            mp["owned_put_guest_visibility"],
        )
        self.assertEqual(
            "canonical_checked_map_put_path",
            mp["shared_commit_primitive"],
        )
        self.assertTrue(mp["failed_commit_preserves_previous_mapping"])
        self.assertTrue(mp["failed_commit_must_not_lose_uncommitted_move_value"])
        self.assertEqual(
            "OresKeyedMap.put",
            mp["scalar_v1_current_primitive"],
        )
        self.assertEqual(
            "OresKeyedMap.attemptOwnedPut_linear_one_shot_result",
            mp["move_only_internal_primitive"],
        )

    def test_record_update_returns_a_new_row_type_not_a_mutated_binding(self):
        update = self.data["record_update"]
        self.assertEqual(
            "row_override_existing_then_extend_missing",
            update["result_type_rule"],
        )
        self.assertEqual("forbidden", update["base_binding_type_mutation"])
        self.assertEqual("forbidden", update["runtime_key_row_change"])
        self.assertFalse(update["literal_put_as_row_extension"])

    def test_typed_decode_never_publishes_partial_nominal_values(self):
        codec = self.data["typed_codec"]
        self.assertEqual(
            "generated_static_constructor",
            codec["known_record_struct_decode"],
        )
        self.assertEqual(
            "explicit_opt_in_constructor_or_factory",
            codec["known_class_decode"],
        )
        self.assertEqual(
            "forbidden",
            codec["direct_decode_partial_publication"],
        )



if __name__ == "__main__":
    unittest.main()
