import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const json = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const model = json('contracts/v1/native-actor-result-supervision-v1.json');
const actor = json('contracts/v1/core-actor-foundation-v1.json');
const protocols = json('contracts/v1/core-protocols-v1.json');

function check(candidate) {
  assert.equal(candidate.schema, 'attolang.native-actor-result-supervision.v1');
  assert.equal(candidate.status, 'EXPERIMENTAL_SELECTED_BACKEND_ONLY');
  assert.deepEqual(candidate.based_on,
    ['contracts/v1/core-protocols-v1.json', 'contracts/v1/core-actor-foundation-v1.json']);
  assert.equal(candidate.normative_actor_semantics.source_language, 'NATIVE_ATTO');
  assert.equal(candidate.normative_actor_semantics.module_header, 'use namespace');
  assert.equal(candidate.normative_actor_semantics.actor_declaration, 'declare actor');
  assert.equal(candidate.normative_actor_semantics.state_access,
    'CHECKED_CRITICAL_SCOPED_LOAN_ONLY');
  assert.deepEqual(candidate.normative_actor_semantics.private_ingress, ['init', 'receive']);
  assert.equal(candidate.normative_actor_semantics.actor_ref_authority,
    'RUNTIME_MINTED_CODE_IMAGE_AND_GENERATION_BOUND');
  assert.equal(candidate.normative_actor_semantics.mailbox,
    'BOUNDED_CHANNEL_LINEARIZABLE_ADMISSION');
  assert.equal(candidate.normative_actor_semantics.full_mailbox,
    'SUSPEND_TASK_NOT_CARRIER');
  assert.equal(candidate.normative_actor_semantics.guest_actor_output,
    'OWNED_DATA_ONLY_IMMUTABLE_SEQUENCE');
  assert.equal(candidate.normative_actor_semantics.output_sender,
    'ACTIVE_ACTOR_TURN_ONLY');
  for (const name of ['output_after_loan_release',
    'output_no_ambient_control', 'output_exact_current_actor_identity']) {
    assert.equal(candidate.normative_actor_semantics[name], true, name);
  }
  assert.equal(candidate.normative_actor_semantics.async_guest_result,
    'REQUIRES_TYPED_AWAIT_LOWERING');
  assert.equal(candidate.normative_actor_semantics.experimental_scalar_projection,
    'JAVA_CLOSED_WORLD_TEST_ONLY_NOT_FINAL_LANGUAGE_API');
  const s = candidate.supervisor_contract;
  assert.equal(s.native_actor_base, 'SupervisorActor');
  assert.equal(s.implementation_status, 'PROPOSED_NOT_EXECUTABLE');
  assert.equal(s.base_inheritance_mints_supervision, false);
  assert.equal(s.control_source, 'TRUSTED_RUNTIME_ONLY');
  assert.equal(s.control_priority, 'SEPARATE_FROM_USER_MAILBOX');
  assert.equal(s.child_parent_generation, 'RUNTIME_VERIFIED');
  assert.equal(s.terminal_failure_notices, 'ONE_PER_CHILD_INCARNATION_UNTIL_ACK');
  for(const name of ['control_may_be_forged_by_guest',
    'panic_interceptable_by_panicking_actor',
    'saturated_user_mailbox_may_drop_terminal_notice', 'manual_retry_required',
    'child_physical_done_before_terminal_ack', 'stale_incarnation_may_restart_or_send']) {
    assert.equal(s[name], false, name);
  }
  assert.equal(s.failed_physical_cleanup_requires_quarantine, true);
  const service = candidate.service_contract;
  assert.equal(service.native_actor_base, 'ServiceActor<Request,Reply>');
  assert.equal(service.implementation_status, 'PROPOSED_NOT_EXECUTABLE');
  assert.equal(service.ordinary_service_trait_mints_actor_ref, false);
  assert.equal(service.request_sender, 'RUNTIME_MINTED_ACTOR_REF_ONLY');
  assert.equal(service.reply_port, 'OWNED_LINEAR_ONE_SHOT_CAPABILITY');
  assert.equal(service.result, 'Future<Result<Reply,E>>');
  assert.equal(service.pending_wakes_on_close_cancel_panic, true);
  assert.equal(service.terminal_settlement, 'EXACTLY_ONCE');
  assert.equal(service.cancellation_quota_release, 'EXACTLY_ONCE');
  assert.equal(service.durable_ack_implied_by_send_success, false);
  assert.equal(actor.native_actor_policy.user_facing_implementation, 'NATIVE_ATTO_ONLY');
  assert.equal(actor.native_actor_policy.supervisor_control_source, s.control_source);
  assert.equal(actor.native_actor_policy.base_class_inheritance_grants_control,
    s.base_inheritance_mints_supervision);
  assert.equal(actor.native_actor_policy.service_trait_grants_actor_endpoint,
    service.ordinary_service_trait_mints_actor_ref);
  assert.ok(protocols.traits.Service);
  assert.equal(candidate.experimental_java_witness.git_blob_sha,
    '3ba0cf61163d48b757f09a33e1d4075498816c87');
  assert.equal(candidate.experimental_java_witness.temporary_expression,
    'return a.output_value();');
  assert.deepEqual(candidate.experimental_java_witness.scenarios.direct_output_values,
    [41, 98, 7]);
  assert.equal(candidate.experimental_java_witness.scenarios.negative_compile_or_admission_variants,
    15);
  assert.equal(candidate.experimental_java_witness.scenarios.supported_number_of_inputs_per_actor, 1);
  assert.deepEqual(candidate.baseline_scoped_receipts.map(x => x.backend),
    ['java_jvm21', 'java_graalvm25_jvm']);
  assert.deepEqual(candidate.baseline_scoped_receipts.map(x => x.run_url), [
    'https://github.com/voxletra/voxletra-e2e/actions/runs/43240063996',
    'https://github.com/voxletra/voxletra-e2e/actions/runs/43240482935'
  ]);
  for (const receipt of candidate.baseline_scoped_receipts) {
    assert.equal(receipt.kind, 'SELECTED_SOURCE_GIT_BLOBS_ONLY');
    assert.equal(receipt.outcome, 'PASSED');
    assert.equal(receipt.total_tests, 94);
    assert.equal(receipt.failed, 0);
    assert.equal(receipt.skipped, 0);
    assert.equal(receipt.source_pr_sha, 'd20098a7270e98a91b34fb2a5f7d17a78fccbd07');
  }
  assert.equal(candidate.baseline_scoped_receipts[1].optimizing_machine_code_tier_proven, false);
  assert.equal(candidate.baseline_scoped_receipts[1].native_image_proven, false);
  assert.deepEqual(Object.keys(candidate.full_backend_execution).sort(),
    ['forge','java','llvm','net','wasm']);
  assert.equal(candidate.full_backend_execution.java, 'NOT_EXECUTED_FULL_TREE');
  for (const name of ['llvm','wasm','forge','net']) {
    assert.equal(candidate.full_backend_execution[name],
      'NOT_EXECUTED_CANONICAL_ATTO_ACTOR_RESULT', name);
  }
  assert.equal(new Set(candidate.required_scenarios).size, 14);
  assert.ok(candidate.required_scenarios.includes('CONTROL_PRIORITY_SURVIVES_SATURATED_USER_MAILBOX'));
  assert.ok(candidate.required_scenarios.includes('SERVICE_REQUEST_REPLY_OWNED_LINEAR_ENDPOINT'));
  assert.ok(candidate.required_scenarios.includes('EXACT_SOURCE_TREE_COMPILER_AND_GUEST_REPLAY_EACH_BACKEND'));
}
test('closed actor/supervisor/service contract has exact nondelegable authority rules', () => {
  check(model);
});
test('security and backend evidence mutations cannot launder claims', () => {
  const changes = [
    x => x.supervisor_contract.base_inheritance_mints_supervision = true,
    x => x.supervisor_contract.control_source = 'GUEST_IMPLEMENTED',
    x => x.supervisor_contract.control_may_be_forged_by_guest = true,
    x => x.supervisor_contract.control_priority = 'USER_MAILBOX',
    x => x.supervisor_contract.saturated_user_mailbox_may_drop_terminal_notice = true,
    x => x.supervisor_contract.child_physical_done_before_terminal_ack = true,
    x => x.supervisor_contract.stale_incarnation_may_restart_or_send = true,
    x => x.supervisor_contract.failed_physical_cleanup_requires_quarantine = false,
    x => x.service_contract.ordinary_service_trait_mints_actor_ref = true,
    x => x.service_contract.reply_port = 'SHARED_UNBOUNDED',
    x => x.service_contract.terminal_settlement = 'BEST_EFFORT',
    x => x.service_contract.cancellation_quota_release = 'UNBOUNDED',
    x => x.normative_actor_semantics.full_mailbox = 'PARK_CARRIER',
    x => x.normative_actor_semantics.output_after_loan_release = false,
    x => x.normative_actor_semantics.output_sender = 'ARBITRARY_CALLER',
    x => x.normative_actor_semantics.experimental_scalar_projection = 'GENERAL_LANGUAGE_API',
    x => x.full_backend_execution.llvm = 'PASSED',
    x => x.full_backend_execution.java = 'PASSED',
    x => x.baseline_scoped_receipts[0].kind = 'FULL_SOURCE_TREE',
    x => x.baseline_scoped_receipts[1].optimizing_machine_code_tier_proven = true,
    x => x.baseline_scoped_receipts[1].native_image_proven = true,
    x => x.required_scenarios.pop()
  ];
  for(const [i, mutate] of changes.entries()) {
    const alt = structuredClone(model);
    mutate(alt);
    assert.throws(() => check(alt), 'mutation ' + i + ' must reject');
  }
});
test('exact native source witness is pinned without making experimental syntax canonical', () => {
  const f = model.experimental_java_witness;
  assert.match(f.source_path, /^tests\/fixtures\/native-actor-result-v1\/[a-z0-9-]+\.atto$/);
  const path = new URL(f.source_path, root);
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  const bytes = readFileSync(path);
  const sha = createHash('sha1').update('blob ' + bytes.length + '\0')
    .update(bytes).digest('hex');
  assert.equal(sha, f.git_blob_sha);
  const source = bytes.toString('utf8');
  for (const term of ['use namespace foo;', 'declare actor Meter;',
    'define state on actor Meter', 'external mtd (Meter p) receive',
    'critical mtd (Meter p)', 'p.send(mail.value);',
    'return a.output_value();']) assert.ok(source.includes(term), term);
  assert.doesNotMatch(source, /\b(?:java\.|filesystem|ffi|shell)\b/);
  assert.match(model.experimental_java_witness.known_limitations.join(' '),
    /not general typed spawn\/await/);
});
