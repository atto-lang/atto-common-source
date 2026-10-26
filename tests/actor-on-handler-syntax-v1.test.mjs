import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../fixtures/actor-on-handler-syntax-v1.json', import.meta.url),
  'utf8'
));
const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));

test('schema pins normalized Symbol plus arity identity', () => {
  assert.equal(contract.schema, 'oreslang.actor-on-handler-syntax.v1');
  assert.equal(contract.status, 'SOURCE_CONTRACT_ONLY');
  assert.deepEqual(contract.handler_identity, ['normalized_symbol', 'arity']);
  assert.deepEqual(contract.body_forms, ['end', 'brace']);
  assert.deepEqual(contract.state_entry_forms, ['type_first', 'name_first']);
});

test('brace and end forms normalize to the same void/nonvoid decisions', () => {
  const c = byId(contract.cases);
  assert.equal(c['end-implicit-void-zero'].normalized_return, 'void');
  assert.equal(c['brace-explicit-void-zero'].normalized_return, 'void');
  assert.equal(c['end-nonvoid-zero'].expected, 'accept');
  assert.equal(c['brace-nonvoid-zero'].expected, 'accept');
  assert.equal(c['end-nonvoid-zero'].return_type, c['brace-nonvoid-zero'].return_type);
  assert.equal(c['quoted-symbol-selector'].normalized_selector, 'get');
});

test('return, delimiter and selector hazards fail closed', () => {
  const c = byId(contract.cases);
  for (const id of [
    'value-without-result-type','nonvoid-fallthrough','void-value-return',
    'mixed-open-brace-close-end','mixed-open-end-close-brace','string-selector'
  ]) assert.equal(c[id].expected, 'reject', id);
});

test('guards cannot mutate, suspend, dispatch, or observe actor state', () => {
  const c = byId(contract.cases);
  assert.equal(c['end-guarded-void-one'].expected, 'accept');
  assert.equal(c['brace-guarded-void-one'].expected, 'accept');
  for (const id of ['effectful-guard','suspending-guard','guard-reads-state']) {
    assert.equal(c[id].expected, 'reject', id);
  }
});

test('state is reserved inside handlers and cannot be shadowed', () => {
  const c = byId(contract.cases);
  assert.equal(c['parameter-named-state'].expected, 'reject');
  assert.equal(c['local-binding-named-state'].expected, 'reject');
});

test('state block is fixed-key and defaults are detached literals in v1', () => {
  const s = byId(contract.state_cases);
  assert.equal(s['state-type-first'].canonical, true);
  assert.equal(s['state-name-first'].canonical, false);
  for (const id of [
    'state-two-blocks','state-duplicate-key','state-effectful-default',
    'state-external-default','state-reference-default','state-escape-borrow',
    'state-dynamic-index','self-state'
  ]) assert.equal(s[id].expected, 'reject', id);
  assert.deepEqual(s['state-direct-read'].required_effects, ['read']);
  assert.deepEqual(s['state-direct-write'].required_effects, ['write']);
  assert.deepEqual(s['state-compound-write'].required_effects, ['read','write']);
});

test('normalized selector plus arity is the only v1 handler identity', () => {
  const d = byId(contract.duplicate_cases);
  assert.equal(d['same-selector-same-arity'].expected, 'reject');
  assert.equal(d['normalized-symbol-collision'].expected, 'reject');
  assert.deepEqual(d['normalized-symbol-collision'].normalized_handlers, [['ready',0],['ready',0]]);
  assert.equal(d['same-selector-different-arity'].expected, 'accept');
  assert.equal(d['different-selector-same-arity'].expected, 'accept');
});

test('ABI is deterministic and independent of concrete body delimiters', () => {
  assert.deepEqual(contract.abi.handler_key, ['normalized_symbol','arity']);
  assert.equal(contract.abi.argument_shape, 'ordered_tuple');
  assert.equal(contract.abi.body_delimiter_is_semantic, false);
  assert.equal(contract.abi.guard_expression_is_abi_identity, false);
  assert.deepEqual(contract.abi.state_schema_fingerprint_fields, ['key_names','key_types']);
});

test('request/reply and dispatch authority remain runtime-owned', () => {
  const r = contract.runtime_obligations;
  assert.equal(r.void_handler, 'event');
  assert.equal(r.nonvoid_handler, 'correlated_request_reply');
  assert.equal(r.selector_carried_by_runtime_envelope, true);
  assert.equal(r.arguments_shape, 'ordered_tuple');
  assert.equal(r.unknown_selector_before_user_code, true);
  assert.equal(r.guard_false_before_user_code, true);
  assert.equal(r.nonvoid_must_not_use_output_stream, true);
  assert.equal(r.guest_reply_token_forgeable, false);
  assert.equal(r.correlation_authority, 'runtime_only');
  assert.equal(r.suspending_handler_requires_continuation_lowering, true);
});

test('all fixture ids are globally unique and outcomes are closed', () => {
  const rows = [...contract.cases,...contract.state_cases,...contract.duplicate_cases];
  const ids = rows.map(row => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of rows) assert.ok(['accept','reject'].includes(row.expected), row.id);
});
