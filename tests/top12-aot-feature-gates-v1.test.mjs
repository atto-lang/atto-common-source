import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const catalogPath = new URL('../fixtures/top12-aot-feature-gates-v1.json', import.meta.url);
const d = JSON.parse(readFileSync(catalogPath, 'utf8'));
const byId = Object.fromEntries(d.features.map(x => [x.id, x]));
const expected = {
  session_protocols: 'P0',
  refinement_contracts: 'P0',
  associated_witnesses: 'P0',
  typed_queries: 'P1',
  lazy_stream_fusion: 'P1',
  secret_safe_types: 'P1',
  portable_atomics: 'P1',
  register_bitfields: 'P1',
  language_editions: 'P1',
  doctests: 'P1',
  functional_lenses: 'P2',
  declarative_reactive: 'P2'
};
const get = (feature, caseName) => {
  const f = byId[feature];
  assert.ok(f, 'missing feature: ' + feature);
  const v = f.cases.find(c => c.id === feature + '--' + caseName);
  assert.ok(v, 'missing case: ' + feature + '--' + caseName);
  return v;
};
const reject = (feature, name) => {
  const v = get(feature, name);
  assert.equal(v.type, 'negative');
  assert.equal(v.expected, 'reject');
  assert.equal(v.evidence, 'source_or_boundary_negative_required');
};
const accept = (feature, name) => {
  const v = get(feature, name);
  assert.equal(v.type, 'positive');
  assert.equal(v.expected, 'accept');
  assert.equal(v.evidence, 'source_fixture_required');
};

test('all 12 exact feature identities and assigned priorities are present', () => {
  assert.equal(d.schema, 'oreslang.top12-aot-feature-admission.v1');
  assert.equal(d.status, 'SOURCE_CONTRACT_ONLY');
  assert.equal(d.complete_compiler_claims, false);
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort());
  for (const [id, priority] of Object.entries(expected)) {
    assert.equal(byId[id].priority, priority, id);
    assert.equal(byId[id].stage, 'DESIGN_REVIEW_REQUIRED');
    assert.ok(byId[id].formal_methods.length >= 2);
    assert.ok(existsSync(new URL('../' + byId[id].related_contract, import.meta.url)), byId[id].related_contract);
  }
  assert.ok(existsSync(new URL('../' + d.normative_doc, import.meta.url)));
});

test('108 unambiguous vectors, 36 positive and 72 negative, complete evidence labels', () => {
  const all = d.features.flatMap(f => f.cases);
  assert.equal(all.length, 108);
  assert.equal(all.filter(x => x.type === 'positive').length, 36);
  assert.equal(all.filter(x => x.type === 'negative').length, 72);
  assert.equal(new Set(all.map(x => x.id)).size, all.length);
  for (const feature of d.features) {
    assert.equal(feature.cases.length, 9, feature.id);
    assert.equal(feature.cases.filter(x => x.expected === 'accept').length, 3, feature.id);
    assert.equal(feature.cases.filter(x => x.expected === 'reject').length, 6, feature.id);
    for (const c of feature.cases) {
      assert.match(c.id, new RegExp('^' + feature.id + '--[a-z][a-z0-9_]*$'));
      assert.equal(c.expected, c.type === 'positive' ? 'accept' : 'reject', c.id);
    }
  }
});

test('native guest AOT excludes a packaged interpreter or runtime language synthesis', () => {
  assert.deepEqual(d.required_primary_native_guest_aot, ['llvm', 'java-graal']);
  assert.match(d.primary_aot_definition.llvm, /guest_native_executable_no_interpreter_or_jit/);
  assert.match(d.primary_aot_definition['java-graal'], /program_specific_compiled_guest_methods_in_graalvm_native_image_no_interpreter_or_jit/);
  assert.ok(d.release_requirements.includes('no_runtime_guest_code_generation'));
  assert.ok(d.release_requirements.includes('finite_code_closure'));
  assert.deepEqual(d.proof_levels, ['F0_contract','F1_model','F2_compiler_source_ir','F3_guest_binary','F4_refinement','F5_release']);
});

test('all backend statuses fail closed on unexecuted support', () => {
  assert.deepEqual(d.allowed_backend_outcomes, ['verified','compile_reject_expected','unsupported','failed','not_executed']);
  for (const feature of d.features) {
    assert.deepEqual(Object.keys(feature.backend_evidence).sort(), ['forge','java-graal','llvm','net','wasm']);
    for (const state of Object.values(feature.backend_evidence)) {
      assert.equal(state, 'not_executed', feature.id);
    }
  }
});

test('actor phase/session/timeout, refinement and associated witness safety are explicit', () => {
  for (const name of ['wrong_phase_message','double_spend_session','forged_session_epoch','timeout_reissues_old_phase','intercept_actor_panic','generation_migration_without_proof']) reject('session_protocols', name);
  for (const name of ['raw_value_implicitly_refined','mutable_alias_invalidates_refinement','effectful_predicate','missing_return_path_postcondition','false_nominal_newtype_cast','unsigned_length_wrap']) reject('refinement_contracts', name);
  for (const name of ['ambiguous_overlapping_impls','orphan_protocol_authority','runtime_impl_registry','unbounded_specialization','effect_laundered_trait','import_order_changes_witness']) reject('associated_witnesses', name);
});

test('typed query and lazy fusion proof negative gates preserve authority and observables', () => {
  for (const name of ['string_interpolated_sql_value','identifier_from_untrusted_string','cross_generation_tx_lease','blocking_actor_db_call','schema_mismatch_ignored','unbounded_row_prefetch']) reject('typed_queries', name);
  for (const name of ['effectful_callback_reordered','source_prefetch_beyond_demand','duplicate_move_after_filter','async_generator_unsafely_fused','panic_erased_as_data','delegated_cleanup_skipped']) reject('lazy_stream_fusion', name);
  accept('lazy_stream_fusion','take_zero_never_pulls');
  accept('typed_queries','parameterized_async_query');
});

test('secret/atomic/MMIO hazards have mandatory denials', () => {
  for (const name of ['secret_implicit_logging','secret_to_plain_string','secret_ffi_lease_escape','copy_without_authority','unverified_zeroization_guarantee','secret_timing_claim_without_proof']) reject('secret_safe_types', name);
  for (const name of ['release_load_order','acquire_store_order','cas_failure_release_order','volatile_as_atomic','unbounded_spin_hard_rt','unsupported_width_silently_emulated']) reject('portable_atomics', name);
  for (const name of ['overlap_without_alias_contract','reserved_register_bit_write','wrong_endian_field_access','read_to_clear_as_pure','untrusted_raw_mmio_grant','implicit_mmio_read_modify_write']) reject('register_bitfields', name);
});

test('editions and actual executable doctests reject false migration and evidence claims', () => {
  for (const name of ['runtime_selects_language_edition','unversioned_ambiguous_migration','upgrade_breaks_actor_schema','breaking_effect_narrowing_hidden','edition_changes_wire_tags','dynamic_runtime_parser_fallback']) reject('language_editions', name);
  for (const name of ['illustrative_snippet_claimed_executable','skip_or_zero_step_called_pass','interpreter_native_image_called_guest_aot','ambient_network_permission','undisclosed_secret_in_docs','unbound_source_sha']) reject('doctests', name);
  accept('doctests','expected_compile_failure_snippet');
});

test('lenses/reactivity remain typed library surfaces, not unsound dynamic dispatch', () => {
  for (const name of ['string_reflection_field_access','mutable_alias_retained_after_update','lens_escape_actor_private_state','dynamic_unknown_field_path','inverted_layout_mismatch','unknown_index_out_of_bounds']) reject('functional_lenses', name);
  for (const name of ['unbounded_dynamic_dependency_creation','implicit_reentrant_actor_callback','undeclared_cycle_in_static_graph','duplicate_terminal_notification','consumer_cancellation_kills_borrowed_producer','reactive_source_eval_at_runtime']) reject('declarative_reactive', name);
  accept('functional_lenses','lens_get_put_laws');
  accept('declarative_reactive','topological_transaction_update');
});

test('every feature requires independent executable evidence rather than contract tests', () => {
  for (const feature of d.features) {
    assert.ok(feature.formal_methods.some(m => ['TLA+','SMT','weak-memory-litmus','information-flow','AST-equivalence','equational-logic','trace-refinement','equivalence-checking','coherence-checking','effect-system','cryptographic-kernel-verification','compiler-execution'].includes(m)), feature.id);
    for (const v of feature.cases) assert.ok(v.evidence.endsWith('_required'), v.id);
  }
  for (const requirement of ['ownership_borrow_effect_capability_proof','formal_negative_mutations','verified_guest_binary','source_artifact_digest_bound']) {
    assert.ok(d.release_requirements.includes(requirement), requirement);
  }
});
