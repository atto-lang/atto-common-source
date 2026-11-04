import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const c = JSON.parse(readFileSync(new URL('../fixtures/three-guarantees-aot-v1.json', import.meta.url), 'utf8'));
const byId = Object.fromEntries(c.cases.map(row => [row.id, row]));
const expectCase = (id, domain, expected) => {
  assert.ok(byId[id], 'missing mandatory vector: ' + id);
  assert.equal(byId[id].domain, domain, id);
  assert.equal(byId[id].expected, expected, id);
};

test('case shape, identity and result domain are closed and exhaustively unambiguous', () => {
  assert.equal(c.schema, 'oreslang.three-guarantees-aot.v1');
  assert.equal(c.status, 'SOURCE_CONTRACT_ONLY');
  assert.equal(c.cases.length, 35);
  assert.equal(Object.keys(byId).length, c.cases.length);
  assert.deepEqual([...new Set(c.allowed_status)].sort(),
    ['verified', 'compile_reject_expected', 'unsupported', 'failed', 'not_executed'].sort());
  const positive = new Set();
  const negative = new Set();
  for (const row of c.cases) {
    assert.equal(typeof row.id, 'string');
    assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)+$/);
    assert.ok(['aot', 'hot_swap', 'realtime', 'protocol'].includes(row.domain), row.id);
    assert.equal(typeof row.scenario, 'string', row.id);
    assert.ok(row.scenario.length > 16, row.id);
    assert.ok(['accept', 'reject'].includes(row.expected), row.id);
    (row.expected === 'accept' ? positive : negative).add(row.domain);
  }
  assert.deepEqual([...positive].sort(), ['aot','hot_swap','protocol','realtime']);
  assert.deepEqual([...negative].sort(), ['aot','hot_swap','protocol','realtime']);
});

test('full guest AOT is mandatory in LLVM and Graal Native Image, not interpreter AOT', () => {
  assert.deepEqual(c.required_backends, ['llvm_guest_native_aot','graal_program_specific_guest_native_image']);
  assert.equal(c.no_runtime_fallback, true);
  assert.equal(c.native_image_of_truffle_interpreter_is_guest_aot, false);
  for (const requirement of ['finite_reachable_guest_closure','generated_static_protocol_witnesses','closed_actor_session_transitions','complete_effects_and_capabilities','checked_ownership_and_lifetimes','compiled_await_and_cancel_paths','compiled_exception_and_cleanup_paths','program_specific_guest_lowering','no_runtime_source_or_jit']) {
    assert.ok(c.compilation_requirements.includes(requirement), requirement);
  }
  expectCase('llvm-closed-actor-aot','aot','accept');
  expectCase('graal-program-specific-guest-native-image','aot','accept');
  expectCase('graal-truffle-evaluator-only','aot','reject');
  expectCase('llvm-runtime-orc-specialization','aot','reject');
  expectCase('runtime-source-macro','aot','reject');
  expectCase('static-precompiled-dispatch','aot','accept');
});

test('dev and production use identical safety rules; loader provenance decides in-process claims', () => {
  assert.equal(c.hot_swap.dev_and_prod_same_safety_checks, true);
  assert.equal(c.hot_swap.in_process_requires_proven_precompiled_loader, true);
  assert.equal(c.hot_swap.graal_native_image_can_assume_dynamic_java_class_loading, false);
  assert.equal(c.hot_swap.process_handoff_is_zero_process_restart, false);
  assert.equal(c.hot_swap.unknown_loader, 'unsupported');
  expectCase('dev-precompiled-in-process-loader','hot_swap','accept');
  expectCase('dev-unproven-native-image-class-loading','hot_swap','reject');
  expectCase('process-handoff-as-zero-restart','hot_swap','reject');
  expectCase('process-handoff-zero-downtime-conditional','hot_swap','accept');
});

test('hot swap follows ordered prepare/commit lifecycle, pins all execution, never forced purges', () => {
  assert.deepEqual(c.hot_swap.phases, ['prepare','validate','stage','fence','publish','drain','retire']);
  assert.deepEqual(c.hot_swap.must_pin, ['actor_turn','async_frame','generator','callback','ffi_or_dma','http_stream','session','child_task']);
  assert.equal(c.hot_swap.physical_quiescence_before_unload, true);
  assert.equal(c.hot_swap.forced_purge, false);
  assert.equal(c.hot_swap.capability_increase, false);
  assert.equal(c.hot_swap.rollback_after_commit, 'new_forward_promotion');
  expectCase('reclaim-pinned-old-frame','hot_swap','reject');
  expectCase('new-session-old-drain','hot_swap','accept');
  expectCase('third-generation-exhaustion','hot_swap','accept');
  expectCase('forced-purge-on-budget','hot_swap','reject');
  expectCase('capability-escalating-upgrade','hot_swap','reject');
  expectCase('post-commit-rollback-rewind','hot_swap','reject');
});

test('soft RT is measured not guaranteed; hard RT requires a target-specific full bound', () => {
  assert.deepEqual(c.realtime.profiles, ['aot_no_timing_claim','soft_rt_measured','hard_rt_qualified']);
  assert.equal(c.realtime.graal_native_image_alone_is_hard_rt, false);
  assert.equal(c.realtime.target_specific_hard_rt_proof, true);
  assert.equal(c.realtime.compiler_aot_is_timing_certificate, false);
  assert.equal(c.realtime.watchdog_is_deadline_proof, false);
  assert.equal(c.realtime.unknown_bound, 'reject');
  assert.deepEqual(c.realtime.hard_rt_requires_all, [
    'specific_hardware_os_runtime', 'whole_program_wcet_bound', 'scheduling_interference',
    'release_jitter', 'critical_section_lock_bound', 'allocation_gc_interference',
    'ffi_and_io_bounds', 'cleanup_and_cancel_bounds', 'admission_and_mailbox_bounds',
    'upgrade_activation_bound'
  ]);
  expectCase('soft-rt-p99-budget','realtime','accept');
  expectCase('graal-native-image-is-hard-rt','realtime','reject');
  expectCase('llvm-qualified-hard-rt','realtime','accept');
  expectCase('rt-unknown-callback-wcet','realtime','reject');
  expectCase('rt-unbounded-migration-critical','realtime','reject');
  expectCase('rt-proven-activation-safe-point','realtime','accept');
  expectCase('rt-watchdog-as-proof','realtime','reject');
});

test('actor protocol proof belongs to one unique generation-bound session, not an actor-global type', () => {
  assert.equal(c.protocol.proof_scope, 'affine_per_session_not_global_actor');
  assert.equal(c.protocol.opaque_actor_generation_and_session_epoch, true);
  assert.equal(c.protocol.transitions_closed_at_compile_time, true);
  assert.equal(c.protocol.runtime_rejects_stale_or_forged_handles, true);
  assert.equal(c.protocol.actor_state_fields_outside_single_sealed_state, false);
  assert.equal(c.protocol.cross_generation_migration, 'explicit_verified_or_drain');
  expectCase('session-unique-authorized-transition','protocol','accept');
  expectCase('session-global-actor-phase-assumption','protocol','reject');
  expectCase('session-copy-and-double-send','protocol','reject');
  expectCase('session-forged-epoch','protocol','reject');
  expectCase('session-version-incompatible-migration','protocol','reject');
  expectCase('session-compatible-generation-pin','protocol','accept');
  expectCase('session-carries-private-state-loan','protocol','reject');
});

test('admission failure and ambiguous post-admission timeout preserve distinct ownership outcomes', () => {
  assert.equal(c.protocol.failed_before_admission, 'retain_ownership');
  assert.equal(c.protocol.ambiguous_after_admission, 'indeterminate_with_settlement');
  expectCase('session-failed-before-admission','protocol','accept');
  expectCase('session-timeout-reissue-old-phase','protocol','reject');
  expectCase('session-timeout-indeterminate','protocol','accept');
});

test('effects never grant permissions and actor fatal panic is never catchable', () => {
  assert.equal(c.protocol.effect_annotation_grants_permission, false);
  assert.equal(c.protocol.inherited_actor_permissions, 'intersection');
  assert.equal(c.protocol.actor_panic_interceptable, false);
  expectCase('session-panic-caught-by-actor','protocol','reject');
  expectCase('effects-as-os-permissions','protocol','reject');
});

test('reference tests must never masquerade as compiled native guest evidence', () => {
  for (const [key,value] of Object.entries(c.backend_evidence)) {
    assert.equal(value, key === 'positive_guest_native_execution_required', key);
  }
  assert.deepEqual(c.inherits, ['oreslang.aot-language-closure.v1','oreslang.macro-semantics.v1']);
});

test('every enumerated vector is asserted by a domain gate', () => {
  const ids = [
    'llvm-closed-actor-aot','graal-program-specific-guest-native-image','graal-truffle-evaluator-only',
    'llvm-runtime-orc-specialization','runtime-source-macro','static-precompiled-dispatch',
    'dev-precompiled-in-process-loader','dev-unproven-native-image-class-loading',
    'process-handoff-as-zero-restart','process-handoff-zero-downtime-conditional',
    'reclaim-pinned-old-frame','new-session-old-drain','third-generation-exhaustion',
    'forced-purge-on-budget','capability-escalating-upgrade','post-commit-rollback-rewind',
    'soft-rt-p99-budget','graal-native-image-is-hard-rt','llvm-qualified-hard-rt',
    'rt-unknown-callback-wcet','rt-unbounded-migration-critical','rt-proven-activation-safe-point',
    'rt-watchdog-as-proof','session-unique-authorized-transition','session-global-actor-phase-assumption',
    'session-copy-and-double-send','session-forged-epoch','session-failed-before-admission',
    'session-timeout-reissue-old-phase','session-timeout-indeterminate','session-panic-caught-by-actor',
    'effects-as-os-permissions','session-version-incompatible-migration',
    'session-compatible-generation-pin','session-carries-private-state-loan'
  ];
  assert.deepEqual(Object.keys(byId).sort(), ids.sort());
});
