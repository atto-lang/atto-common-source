import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const c = JSON.parse(readFileSync(
  new URL('../fixtures/macro-semantics-v1.json', import.meta.url),
  'utf8'
));
const byId = rows => Object.fromEntries(rows.map(x => [x.id, x]));

test('define macro is compile-time only with explicit typed output', () => {
  assert.equal(c.schema, 'oreslang.macro-semantics.v1');
  assert.equal(c.status, 'SOURCE_CONTRACT_ONLY');
  assert.equal(c.declaration.compile_time_only, true);
  assert.equal(c.declaration.explicit_result_kind_required, true);
  assert.equal(c.declaration.first_class_runtime_value, false);
  assert.equal(c.ast.typed_not_text, true);
  assert.equal(c.ast.raw_token_streams, false);
  assert.equal(c.ast.parse_generated_source, false);
});

test('macro invocation is phase-visible and category-tagged', () => {
  const i = c.invocation;
  assert.equal(i.canonical_spelling, 'name!(...)');
  assert.equal(i.ordinary_runtime_call, false);
  assert.equal(i.argument_categories_explicit, true);
  assert.equal(i.identifier_is_checked_capture, false);
  assert.equal(i.identifier_is_hygienic_provenance, true);
  assert.equal(i.capture_requires_explicit_checked_operation, true);
  assert.equal(i.qualified_lookup_obeys_visibility, true);
  assert.equal(i.const_type_must_match, true);
  assert.deepEqual(i.declaration_result_kinds, ['Syntax<Decl>', 'SyntaxList<Decl>']);
  assert.deepEqual(i.expression_result_kinds, ['Syntax<Expr>']);
  assert.equal(i.runtime_const_fallback, false);
});

test('macro hygiene is explicit and checked', () => {
  const k = byId(c.cases);
  assert.equal(c.ast.hygienic_by_default, true);
  assert.equal(c.ast.hygiene_identity_exact, true);
  assert.equal(c.ast.hash_collision_grants_identity, false);
  assert.equal(c.ast.runtime_hygiene_table_required, false);
  assert.equal(c.ast.explicit_checked_capture_only, true);
  assert.equal(k['implicit-text-capture'].expected, 'reject');
  assert.equal(k['identifier-input-no-implicit-capture'].expected, 'accept');
  assert.equal(k['checked-capture'].expected, 'accept');
  assert.equal(k['private-cross-boundary-capture'].expected, 'reject');
  assert.equal(k['private-qualified-macro'].expected, 'reject');
  assert.equal(k['public-qualified-macro'].expected, 'accept');
  assert.equal(k['const-type-mismatch'].expected, 'reject');
  assert.equal(k['const-type-unproven'].expected, 'reject');
});

test('generated identifiers and checked function capture are explicit', () => {
  const h = c.identifier_hygiene;
  const k = byId(c.cases);
  assert.equal(h.compiler_only, true);
  assert.equal(h.runtime_table_required, false);
  assert.equal(h.identifier_argument_grants_capture, false);
  assert.equal(h.generated_intrinsic, 'hygienic');
  assert.equal(h.generated_direct_call_only, true);
  assert.equal(h.generated_source_spellable, false);
  assert.equal(h.generated_textual_equality_grants_capture, false);
  assert.equal(h.generated_exact_hygiene_identity, true);
  assert.equal(h.generated_hint_is_authority, false);
  assert.equal(h.generated_handle_includes_lossless_source_unit, true);
  assert.equal(h.generated_handle_uses_hash_as_authority, false);
  assert.equal(h.capture_intrinsic, 'capture_fnc');
  assert.equal(h.capture_direct_call_only, true);
  assert.equal(h.capture_kind, 'public-reifiable-module-fnc');
  assert.equal(h.capture_resolves_from, 'caller_module');
  assert.equal(h.capture_records_overload_family, false);
  assert.equal(h.capture_requires_public, true);
  assert.equal(h.capture_same_module_private, false);
  assert.equal(h.capture_overloaded_family, false);
  assert.equal(h.capture_routine, false);
  assert.equal(h.capture_generic, false);
  assert.equal(h.capture_suspends, false);
  assert.equal(h.capture_runtime_macro_table_required, false);
  assert.equal(h.capture_lowering, 'source-unspellable-lossless-module-ref');
  assert.equal(h.capture_local_shadow_can_redirect, false);
  assert.equal(h.capture_internal_module_ref_encoding, 'lossless-utf8-hex');
  assert.equal(h.capture_internal_module_ref_source_spellable, false);
  assert.equal(h.capture_internal_module_ref_decoded_before_local_lookup, true);
  assert.equal(h.capture_internal_module_ref_capability_canonicalized, true);
  assert.equal(h.capture_internal_module_ref_text_is_authority, false);
  assert.equal(h.capture_internal_module_ref_requires_exact_admission_identity, true);
  assert.equal(h.capture_rewrite_preserves_admission_identity, true);
  assert.equal(h.capture_forged_programmatic_ast, false);
  assert.equal(h.capture_authority_binds_exact_member_expr, true);
  assert.equal(h.capture_authorized_receiver_reuse, false);
  assert.equal(h.capture_preserves_referenced_function_effects, true);
  assert.equal(h.capture_local_binding, false);
  assert.equal(h.capture_field, false);
  assert.equal(h.capture_method, false);
  assert.equal(h.capture_import_alias, false);
  assert.equal(h.capture_type, false);
  assert.equal(h.capture_actor_or_capability, false);
  assert.equal(h.cross_module_requires_public_family, true);
  assert.equal(h.intrinsic_names_reserved_only_in_macro_scope, true);

  for (const id of [
    'generated-hygienic-no-text-capture',
    'checked-function-capture-same-module-public',
    'checked-function-capture-cross-module-public',
    'checked-function-capture-local-shadow',
    'checked-function-capture-rewrite-preserves-authority'
  ]) assert.equal(k[id].expected, 'accept', id);
  assert.equal(
    k['generated-hygienic-full-semantic-noncapture'].expected,
    'reject-unresolved-generated-name');

  for (const id of [
    'generated-hygienic-equal-spelling-capture',
    'checked-function-capture-same-module-private',
    'checked-function-capture-cross-module-private',
    'checked-function-capture-wrong-kind',
    'checked-function-capture-actor',
    'checked-function-capture-overload',
    'checked-function-capture-routine',
    'checked-function-capture-generic',
    'checked-function-capture-suspends',
    'checked-function-capture-capability-laundering',
    'checked-function-capture-forged-internal-module-ref',
    'checked-function-capture-receiver-reuse',
    'identifier-intrinsic-shadow'
  ]) assert.equal(k[id].expected, 'reject', id);
});

test('public macro content identity is canonical and cache-only', () => {
  const m = c.canonical_content_identity;
  const k = byId(c.cases);
  assert.equal(m.format, 'ores-macro-content-v1');
  assert.equal(m.semantics_abi, 'ores-macro-semantics-v1');
  assert.equal(m.encoding, 'utf-8');
  assert.equal(m.free_form_string_length_unit, 'utf-8-bytes');
  assert.equal(m.max_encoded_bytes, 1048576);
  assert.equal(m.max_nodes, 4096);
  assert.equal(m.max_depth, 128);
  assert.equal(m.identifier_max_chars, 1024);
  assert.equal(m.source_unit_max_chars, 4096);
  assert.equal(m.source_text_in_identity, false);
  assert.equal(m.source_location_in_identity, false);
  assert.equal(m.record_to_string_in_identity, false);
  assert.equal(m.reflection_in_identity, false);
  assert.equal(m.object_identity_in_identity, false);
  assert.equal(m.parameter_names_in_identity, true);
  assert.equal(m.call_origin_in_identity, true);
  assert.equal(m.object_kind_in_identity, true);
  assert.equal(m.float_encoding, 'raw-ieee754-bits');
  assert.equal(m.hash_is_cache_only, true);
  assert.equal(m.hash_grants_hygiene_or_capture, false);
  assert.equal(m.resource_profiles_in_identity, true);
  assert.equal(m.format_or_semantics_change_invalidates_importers, true);
  assert.equal(k['macro-canonical-formatting-stable'].expected, 'accept');
  assert.equal(k['macro-canonical-semantic-change'].expected, 'invalidate-importers');
  assert.equal(k['macro-canonical-signed-zero'].expected, 'accept');
  assert.equal(k['macro-canonical-record-tostring'].expected, 'reject');
});

test('first declaration slice is narrow, private and transactional', () => {
  const d = c.declaration_generation_slice;
  const k = byId(c.cases);
  assert.equal(d.enabled, true);
  assert.equal(d.intrinsic, 'declare_fnc');
  assert.equal(d.direct_call_only, true);
  assert.equal(d.result_kind, 'Syntax<Decl>');
  assert.deepEqual(d.parameters, ['Identifier', 'Type', 'Syntax<Expr>']);
  assert.equal(d.output_kind, 'ordinary-module-function');
  assert.equal(d.output_visibility, 'private');
  assert.equal(d.output_actor_kind, 'NONE');
  assert.equal(d.output_async, false);
  assert.equal(d.output_generic, false);
  assert.equal(d.output_parameters, 0);
  assert.equal(d.stable_name_requires_explicit_identifier, true);
  assert.equal(d.exposed_name_site_in_provenance, true);
  assert.equal(d.duplicate_existing_name, 'reject');
  assert.equal(d.duplicate_generated_name, 'reject');
  assert.equal(d.overload_synthesis, false);
  assert.equal(d.generated_public_declaration, false);
  assert.equal(d.generated_import, false);
  assert.equal(d.generated_export, false);
  assert.equal(d.generated_macro, false);
  assert.equal(d.generated_module_or_package, false);
  assert.equal(d.nested_expression_macros_expand_before_semantics, true);
  assert.equal(d.generated_declaration_reenters_type_effect_ownership_capability_checks, true);
  assert.equal(d.syntax_decl_source_argument_enabled, false);

  for (const id of [
    'declare-fnc-private-zero-arg',
    'declare-fnc-nested-expression-macro',
    'declare-fnc-exposed-name-provenance'
  ]) assert.equal(k[id].expected, 'accept', id);
  for (const id of [
    'declare-fnc-existing-name-collision',
    'declare-fnc-generated-name-collision',
    'declare-fnc-body-semantic-recheck',
    'declare-fnc-public-output',
    'declare-fnc-pipeline-lookalike'
  ]) assert.equal(k[id].expected, 'reject', id);
});

test('macro expansion cannot mutate namespace discovery in v1', () => {
  const n = c.generated_namespace;
  assert.equal(n.ordinary_declarations, true);
  for (const key of ['package_or_module_header','imports_or_aliases','exports_or_reexports','macros','build_manifest_or_flags']) {
    assert.equal(n[key], false, key);
  }
  const k = byId(c.cases);
  for (const id of ['generate-import','generate-export','generate-macro']) {
    assert.equal(k[id].expected, 'reject', id);
  }
});

test('macro authority is compile-time sandboxed', () => {
  const d = c.determinism;
  for (const key of ['ambient_time','ambient_random','undeclared_env','arbitrary_files','network','mutable_global_state_observable']) {
    assert.equal(d[key], false, key);
  }
  const a = c.authority;
  for (const key of ['ffi','raw_pointer','actor_runtime','supervisor_runtime','runtime_task_future_thread','runtime_ownership_ops']) {
    assert.equal(a[key], false, key);
  }
});

test('type and layout inspection cannot mint unsafe authority', () => {
  const k = byId(c.cases);
  assert.equal(k['type-metadata-visible'].expected, 'accept');
  assert.equal(k['type-metadata-raw-offset'].expected, 'reject');
  assert.equal(k['layout-does-not-grant-pointer'].expected, 'reject');
});

test('macro expansion is finite, transactional and has no runtime fallback', () => {
  const k = byId(c.cases);
  assert.equal(c.resources.deterministic_budgets_required, true);
  assert.equal(c.resources.expansion_transactional, true);
  assert.equal(c.resources.runtime_fallback, false);
  assert.equal(c.resources.active_cycle_detection, true);
  assert.equal(k['nested-existing-macro'].expected, 'accept');
  assert.equal(k['macro-expansion-cycle'].expected, 'reject');
  assert.equal(k['budget-exhaustion'].expected, 'reject');
  assert.equal(k['partial-expansion-visibility'].expected, 'reject');
});

test('macro erasure preserves executable semantics', () => {
  const k = byId(c.cases);
  assert.equal(k['unused-supported-macro-erased'].expected, 'accept');
  assert.equal(k['identity-expansion-structural-equivalence'].expected, 'accept');
});

test('generated code re-enters ordinary semantic validation', () => {
  const k = byId(c.cases);
  assert.equal(k['generated-effect-violation'].expected, 'reject');
  assert.equal(k['generated-borrow-violation'].expected, 'reject');
  assert.equal(k['runtime-capability-input'].expected, 'reject');
});

test('macros and generics require finite compile-time closure', () => {
  const k = byId(c.cases);
  assert.equal(c.generics.generated_generics_allowed, true);
  assert.equal(c.generics.concrete_runtime_specialization_hook, false);
  assert.equal(c.generics.finite_feedback_required, true);
  assert.equal(k['generic-finite-generation'].expected, 'accept');
  assert.equal(k['generic-runtime-defer'].expected, 'reject');
});

test('const-v1 evaluator is bounded, authority-free and type-compatible', () => {
  const e = c.const_evaluator;
  const k = byId(c.cases);
  assert.equal(e.profile, 'const-v1');
  assert.equal(e.max_steps, 512);
  assert.equal(e.max_depth, 64);
  assert.equal(e.depth_limit_inclusive, true);
  assert.equal(e.max_aggregate_elements, 256);
  assert.equal(e.max_string_chars, 65536);
  assert.equal(e.max_estimated_bytes, 1048576);
  assert.equal(e.runtime_authority, false);
  assert.equal(e.name_lookup, false);
  assert.equal(e.calls, false);
  assert.equal(e.reflection, false);
  assert.equal(e.parse_generated_source, false);
  assert.equal(e.non_finite_float, false);
  assert.equal(e.checked_integer_overflow, true);
  assert.equal(e.integer_overflow_policy, 'reject');
  assert.equal(e.division_of_ints_has_type, 'float');
  assert.equal(k['const-int-division-type'].expected, 'reject');
  assert.equal(k['const-float-division-type'].expected, 'accept');
  assert.equal(k['const-memory-budget'].expected, 'reject');
});

test('macro rewrite traversal is explicitly bounded', () => {
  const r = c.resource_limits;
  const k = byId(c.cases);
  assert.equal(r.rewrite_traversal_max_depth, 512);
  assert.equal(r.rewrite_traversal_max_nodes, 1000000);
  assert.equal(r.rewrite_traversal_covers_programmatic_ast, true);
  assert.equal(r.rewrite_traversal_failure_before_runtime_fallback, true);
  assert.equal(k['macro-rewrite-deep-programmatic-ast'].expected, 'reject');
  assert.equal(k['macro-rewrite-bounded-program'].expected, 'accept');
});

test('macro syntax provenance is exact, nested and transactional', () => {
  const p = c.provenance;
  const k = byId(c.cases);
  assert.equal(p.compiler_only, true);
  assert.equal(p.exact_hygiene_identity, true);
  assert.deepEqual(p.identity_fields, [
    'source_unit_id',
    'caller_module',
    'macro_owner_module',
    'macro_declaration_name',
    'invocation_site',
    'expansion_ordinal'
  ]);
  assert.equal(p.source_unit_identity_required, true);
  assert.equal(p.same_module_same_site_different_unit_is_distinct, true);
  assert.equal(p.source_unit_normalization, 'logical-relative-segments-forward-slash');
  assert.equal(p.absolute_source_unit_id, false);
  assert.equal(p.source_unit_parent_escape, false);
  assert.equal(p.backslash_and_slash_equivalent, true);
  assert.equal(p.memory_source_unit, '<memory>');
  assert.equal(p.qualified_invocation_spelling_is_identity, false);
  assert.equal(p.ordered_expansion_chain, true);
  assert.equal(p.nested_origins_preserved, true);
  assert.equal(p.transactional_publication, true);
  assert.equal(p.concurrent_publication_atomic, true);
  assert.deepEqual(p.origin_fields, [
    'source_unit_id',
    'caller_module',
    'macro_owner_module',
    'macro_declaration_name',
    'invocation_site',
    'macro_definition_site',
    'expansion_ordinal',
    'emission_kind'
  ]);
  assert.equal(p.definition_and_invocation_sites_distinct, true);
  assert.equal(p.runtime_authority, false);
  assert.equal(p.retained_in_native_artifact, false);
  assert.equal(k['nested-provenance-chain'].expected, 'accept');
  assert.equal(k['failed-expansion-provenance'].expected, 'reject');
  assert.equal(k['qualified-provenance-canonical-identity'].expected, 'accept');
  assert.equal(k['qualified-provenance-spelling-identity'].expected, 'reject');
  assert.equal(k['provenance-definition-site'].expected, 'accept');
  assert.equal(k['hygiene-source-unit-distinct'].expected, 'accept');
  assert.equal(k['hygiene-source-unit-collision'].expected, 'reject');
  assert.equal(k['generated-handle-unit-collision'].expected, 'reject');
  assert.equal(k['hygiene-source-unit-normalization'].expected, 'accept');
  assert.equal(k['hygiene-source-unit-rebind'].expected, 'reject');
  assert.equal(k['hygiene-source-unit-absolute-path'].expected, 'reject');
  assert.equal(k['hygiene-source-unit-parent-escape'].expected, 'reject');
  assert.equal(k['hygiene-source-unit-slash-equivalence'].expected, 'accept');
});

test('public macro content participates in compile-time cache identity', () => {
  const i = c.incremental_compilation;
  const k = byId(c.cases);
  assert.equal(i.public_macro_content_invalidates_importers, true);
  assert.equal(i.private_macro_change_is_not_imported_abi, true);
  assert.equal(i.transitive_compile_time_dependencies_invalidate, true);
  assert.equal(i.runtime_artifact_requires_macro_metadata, false);
  assert.equal(k['public-macro-cache-invalidation'].expected, 'accept');
  assert.equal(k['private-macro-cache-isolation'].expected, 'accept');
});

test('Const<T> metadata matching and diagnostics are bounded', () => {
  const e = c.const_evaluator;
  assert.equal(e.max_const_type_depth, 64);
  assert.equal(e.max_const_type_nodes, 512);
  assert.equal(e.max_type_diagnostic_depth, 16);
  assert.equal(e.max_type_diagnostic_nodes, 128);
  assert.equal(e.max_type_diagnostic_children, 16);
  assert.equal(e.max_type_diagnostic_chars, 1024);
  assert.equal(e.type_matching_is_iterative, true);
  const k = byId(c.cases);
  assert.equal(k['const-type-depth-budget'].expected, 'reject');
  assert.equal(k['const-type-node-budget'].expected, 'reject');
  assert.equal(k['const-type-diagnostic-bounded'].expected, 'accept');
  assert.equal(k['const-type-boolean-alias'].expected, 'accept');
});

test('macro provenance traversal budgets fail atomically', () => {
  const p = c.provenance;
  assert.equal(p.max_traversal_depth, 256);
  assert.equal(p.max_traversal_nodes, 65536);
  assert.equal(p.budget_checked_before_publication, true);
  assert.equal(p.failed_walk_does_not_publish_any_origin, true);
  const k = byId(c.cases);
  assert.equal(k['provenance-depth-quota'].expected, 'reject');
  assert.equal(k['provenance-node-quota'].expected, 'reject');
  assert.equal(k['provenance-failed-then-success'].expected, 'accept');
});

test('macro expansion is absent from runtime and hot reload', () => {
  const k = byId(c.cases);
  assert.equal(k['hot-reload-preexpanded'].expected, 'accept');
  assert.equal(k['runtime-macro-engine'].expected, 'reject');
  assert.equal(k['source-string-eval'].expected, 'reject');
});

test('Const<T> quote emits compiler-proven syntax, never runtime compilation', () => {
  const q = c.literal_quote;
  assert.equal(q.compiler_only_intrinsic, true);
  assert.equal(q.result_kind, 'Syntax<Expr>');
  assert.equal(q.requires_proven_const_value, true);
  assert.equal(q.requires_exact_const_type, true);
  assert.equal(q.emits_literal_ast_not_source_text, true);
  assert.equal(q.ordinary_semantic_recheck, true);
  assert.equal(q.nonliteral_subset_may_fail_closed, true);
  assert.equal(q.runtime_evaluation_fallback, false);
  assert.equal(q.quote_name_reserved_in_macro_scope, true);
  assert.equal(q.direct_call_origin_required, true);
  const k = byId(c.cases);
  assert.equal(k['const-quote-literal'].expected, 'accept');
  assert.equal(k['const-quote-runtime-variable'].expected, 'reject');
  assert.equal(k['const-quote-unchecked-type'].expected, 'reject');
  assert.equal(k['quote-name-shadow'].expected, 'reject');
  assert.equal(k['quote-pipeline-lookalike'].expected, 'reject');
});

test('bounded Const<T> evaluator is deterministic and authority-free', () => {
  const e = c.const_evaluator;
  assert.equal(e.deterministic, true);
  assert.equal(e.runtime_authority, false);
  assert.equal(e.max_steps, 512);
  assert.equal(e.max_depth, 64);
  assert.equal(e.max_aggregate_elements, 256);
  assert.equal(e.max_string_chars, 65536);
  assert.equal(e.max_estimated_bytes, 1048576);
  assert.equal(e.checked_integer_overflow, true);
  assert.equal(e.non_finite_float, false);
  assert.equal(e.exact_const_type_required, true);
  assert.equal(e.expected_directed_empty_list, true);
  assert.equal(e.empty_list_requires_exact_list_element_type, true);
  assert.equal(e.ast_const_value_type_invariant, true);
  assert.equal(e.ast_const_meta_type_bypass, false);
  assert.equal(e.ast_const_inferred_type_hole, false);
  assert.equal(e.ast_const_runtime_borrow, false);
  assert.equal(e.ast_const_type_validation_bounded, true);
  for (const key of [
    'name_lookup','calls','runtime_intrinsics','actors','tasks_or_futures',
    'reflection','ffi','io','environment','time','randomness','parse_generated_source'
  ]) assert.equal(e[key], false, key);
  const k = byId(c.cases);
  for (const id of ['const-arithmetic-fold','const-aggregate-fold']) {
    assert.equal(k[id].expected, 'accept', id);
  }
  assert.equal(k['const-depth-inclusive'].expected, 'accept');
  assert.equal(k['const-empty-list-expected-type'].expected, 'accept');
  assert.equal(k['const-empty-list-untyped'].expected, 'reject');
  assert.equal(k['const-direct-ast-meta-bypass'].expected, 'reject');
  assert.equal(k['const-direct-ast-inferred-hole'].expected, 'reject');
  assert.equal(k['const-direct-ast-borrow'].expected, 'reject');
  for (const id of [
    'const-runtime-name','const-invalid-operation','const-budget-exhaustion',
    'const-nonfinite-float','const-integer-overflow','const-string-budget'
  ]) assert.equal(k[id].expected, 'reject', id);
});

test('cross-backend comptime scalar edge semantics are closed and explicit', () => {
  const e = c.const_evaluator;
  const k = byId(c.cases);
  assert.equal(e.exact_mixed_integer_float_comparison, true);
  assert.equal(e.ieee_signed_zero_comparison, true);
  assert.equal(e.checked_integer_subtraction_and_negation, true);
  assert.equal(k['const-mixed-i64-f64-exact-ordering'].expected, 'accept');
  assert.equal(k['const-ieee-signed-zero'].expected, 'accept');
  assert.equal(k['const-nonfinite-literal'].expected, 'reject');
  assert.equal(k['const-checked-subtraction-negation'].expected, 'reject');
});

test('typed expression quote/unquote remains identifier-safe', () => {
  const q = c.template_quote;
  assert.equal(q.result_kind, 'Syntax<Expr>');
  assert.equal(q.compiler_only, true);
  assert.equal(q.quote_direct_call_only, true);
  assert.equal(q.unquote_direct_call_only, true);
  assert.equal(q.unquote_parameter_kind, 'Syntax<Expr>');
  assert.equal(q.identifier_free_template, true);
  assert.equal(q.introduced_identifiers, false);
  assert.equal(q.generated_call_targets, false);
  assert.equal(q.caller_identifiers_via_unquote_only, true);
  assert.equal(q.duplicate_unquote_grants_ownership, false);
  assert.equal(q.max_depth, 64);
  assert.equal(q.max_nodes, 2048);
  assert.equal(q.all_parameters_must_be_used, true);
  assert.equal(q.duplicate_nontrivial_unquote, false);
  assert.equal(q.duplicate_trivial_name_or_literal, false);
  assert.equal(q.duplicate_closed_literal_only, true);
  assert.equal(q.duplicate_unproven_name_binding, false);
  assert.equal(q.repeated_nonliteral_requires_proven_copy_and_ownership, true);
  assert.equal(q.non_finite_float, false);
  assert.equal(q.deterministic_parameter_order, true);
  assert.equal(q.duplicated_trivial_splice_unique_ast_identity, true);
  assert.equal(q.shared_expr_identity_across_output_occurrences, false);
  assert.equal(q.quote_name_reserved_in_macro_scope, true);
  assert.equal(q.unquote_name_reserved_in_macro_scope, true);
  assert.equal(q.runtime_names_outside_macro_scope, true);
  assert.equal(q.source_text_reparse, false);
  assert.equal(q.provenance_kind, 'TEMPLATE_QUOTE');

  const k = byId(c.cases);
  for (const id of [
    'typed-template-unquote','template-callsite-name-preserved','template-provenance-kind'
  ]) assert.equal(k[id].expected, 'accept', id);
  for (const id of [
    'template-introduced-identifier','unquote-pipeline-lookalike',
    'unquote-name-shadow','template-duplicate-move',
    'template-unused-syntax-parameter','template-budget-exhaustion',
    'template-nonfinite-float','template-shared-output-identity'
  ]) assert.equal(k[id].expected, 'reject', id);
  assert.equal(k['template-duplicate-trivial-identity'].expected, 'accept');
});

test('macro provenance is transactional and distinguishes emission kind', () => {
  assert.equal(c.ast.transactional_provenance_publication, true);
  assert.equal(c.ast.splice_and_const_quote_origins_distinct, true);
  const k = byId(c.cases);
  assert.equal(k['provenance-splice-kind'].expected, 'accept');
  assert.equal(k['provenance-const-quote-kind'].expected, 'accept');
  assert.equal(k['failed-expansion-provenance'].expected, 'reject');
});

test('runtime renderers use precompiled code to generate data', () => {
  const r = c.runtime_generation;
  for (const key of [
    'macro_runs_at_build_time',
    'generated_function_may_consume_runtime_values',
    'runtime_dom_or_html_generation',
    'runtime_json_or_sql_generation',
    'precompiled_js_or_wasm_output',
    'runtime_source_text_is_data_not_authority'
  ]) assert.equal(r[key], true, key);
  for (const key of [
    'runtime_oreslang_compilation_required',
    'runtime_macro_engine_required',
    'runtime_generated_nominal_types',
    'representation_grants_ownership_authority'
  ]) assert.equal(r[key], false, key);
  const k = byId(c.cases);
  for (const id of ['runtime-renderer-data', 'precompiled-web-target']) {
    assert.equal(k[id].expected, 'accept', id);
  }
  for (const id of [
    'runtime-macro-invocation', 'runtime-oreslang-source-eval',
    'layout-actor-data-escape', 'layout-mints-sendable'
  ]) assert.equal(k[id].expected, 'reject', id);
});

test('case ids and outcomes are closed', () => {
  const ids = c.cases.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of c.cases) assert.ok(['accept','reject','invalidate-importers','reject-unresolved-generated-name'].includes(row.expected), row.id);
});
