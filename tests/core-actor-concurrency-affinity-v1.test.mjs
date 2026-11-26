import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const foundation = load('contracts/v1/core-actor-foundation-v1.json');
const native = load('contracts/v1/native-actor-result-supervision-v1.json');
const doc = readFileSync(new URL('docs/CORE_AND_ACTOR_BASE_CLASSES_V1.md', root), 'utf8');

const expected = Object.freeze({
  ordinary_actor_default: 'BOUNDED_CONCURRENT_EFFECTIVE_TURNS',
  serial_actor: 'AT_MOST_ONE_ACTIVE_GUEST_TURN',
  critical_read: 'OVERLAPPING_IMMUTABLE_READ_LOANS_WHEN_SUPPORTED',
  critical_write: 'EXCLUSIVE_AGAINST_ALL_CONFLICTING_READERS_AND_WRITERS',
  loan_may_escape_callback_or_cross_await: false,
  actor_spawned_task_executor: 'OWNING_ACTOR_TASK_POOL',
  supervisor_control_executor: 'SEPARATE_TRUSTED_CONTROL_POOL',
  task_or_continuation_may_use_supervisor_control_pool: false,
  continuation_identity: 'ACTOR_ID_INCARNATION_GENERATION_CODE_IMAGE',
  physical_carrier_migration_allowed: true,
  await_or_mailbox_backpressure_parks_carrier: false,
  stop_cancel_restart_requires: 'QUIESCENCE_AND_EXACTLY_ONCE_TERMINAL_ACCOUNTING'
});

function verify(model) {
  assert.deepEqual(model.execution_concurrency, expected);
  const rules = model.security_invariants.join('\n');
  assert.match(rules, /Ordinary actors allow bounded concurrent effective turns/);
  assert.match(rules, /serial actors admit at most one active guest turn/);
  assert.doesNotMatch(rules, /Each actor has serialized effective turns/);
  assert.deepEqual(Object.values(model.backend_evidence), Array(5).fill('NOT_EXECUTED'));
}

test('ordinary actors are concurrent but critical state loans remain exclusive on write', () => {
  verify(foundation);
  assert.equal(native.normative_actor_semantics.ordinary_actor_turns,
    expected.ordinary_actor_default);
  assert.equal(native.normative_actor_semantics.serial_actor_turns, expected.serial_actor);
  assert.equal(native.normative_actor_semantics.reader_loan_overlap,
    'IMMUTABLE_READERS_ONLY_WHEN_SUPPORTED');
  assert.equal(native.normative_actor_semantics.writer_loan_exclusion,
    'EXCLUSIVE_READ_WRITE');
  assert.match(doc, /Ordinary actors may have multiple concurrent effective turns/);
  assert.match(doc, /Only `serial actor`/);
});

test('actor tasks and resumed continuations cannot enter supervisor CONTROL', () => {
  verify(foundation);
  assert.equal(native.normative_actor_semantics.task_executor,
    'OWNING_ACTOR_TASK_POOL_NOT_SUPERVISOR_CONTROL');
  assert.equal(native.normative_actor_semantics.task_continuation_identity,
    expected.continuation_identity);
  assert.equal(native.normative_actor_semantics.task_suspension_parks_carrier, false);
  assert.equal(native.normative_actor_semantics.task_may_resume_on_supervisor_control_pool, false);
  assert.match(doc, /never.*supervisor.s[\s\S]*CONTROL execution pool/i);
  assert.match(doc, /no compiled Atto actor-task proof/i);
});

test('adversarial concurrency / privilege mutants fail closed', () => {
  const mutants = [
    x => { x.execution_concurrency.ordinary_actor_default = 'SERIAL_ONLY'; },
    x => { x.execution_concurrency.serial_actor = 'UNBOUNDED'; },
    x => { x.execution_concurrency.critical_read = 'MUTABLE_SHARED_LOANS'; },
    x => { x.execution_concurrency.critical_write = 'NON_EXCLUSIVE'; },
    x => { x.execution_concurrency.loan_may_escape_callback_or_cross_await = true; },
    x => { x.execution_concurrency.actor_spawned_task_executor = 'SUPERVISOR_POOL'; },
    x => { x.execution_concurrency.supervisor_control_executor = 'ACTOR_DATA_POOL'; },
    x => { x.execution_concurrency.task_or_continuation_may_use_supervisor_control_pool = true; },
    x => { x.execution_concurrency.continuation_identity = 'ACTOR_ID_ONLY'; },
    x => { x.execution_concurrency.physical_carrier_migration_allowed = false; },
    x => { x.execution_concurrency.await_or_mailbox_backpressure_parks_carrier = true; },
    x => { x.execution_concurrency.stop_cancel_restart_requires = 'BEST_EFFORT'; },
    x => { x.backend_evidence.llvm = 'PASSED'; },
    x => { x.security_invariants = []; }
  ];
  for (const [index, mutate] of mutants.entries()) {
    const candidate = structuredClone(foundation);
    mutate(candidate);
    assert.throws(() => verify(candidate), 'mutation ' + index);
  }
});
