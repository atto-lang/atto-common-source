import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../fixtures/actor-on-handler-syntax-v1.json', import.meta.url),
  'utf8'
));

const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));

test('schema pins the v1 actor handler surface', () => {
  assert.equal(contract.schema, 'oreslang.actor-on-handler-syntax.v1');
  assert.equal(contract.status, 'SOURCE_CONTRACT_ONLY');
  assert.deepEqual(contract.handler_identity, ['symbol', 'arity']);
  assert.deepEqual(contract.body_forms, ['end', 'brace']);
  assert.deepEqual(contract.state_entry_forms, ['type_first', 'name_first']);
});

test('brace and end forms normalize to the same void/nonvoid decisions', () => {
  const c = byId(contract.cases);
  assert.equal(c['end-implicit-void-zero'].expected, 'accept');
  assert.equal(c['end-implicit-void-zero'].normalized_return, 'void');
  assert.equal(c['brace-explicit-void-zero'].expected, 'accept');
  assert.equal(c['brace-explicit-void-zero'].normalized_return, 'void');
  assert.equal(c['end-nonvoid-zero'].expected, 'accept');
  assert.equal(c['brace-nonvoid-zero'].expected, 'accept');
  assert.equal(c['end-nonvoid-zero'].return_type, c['brace-nonvoid-zero'].return_type);
});

test('return and delimiter hazards fail closed', () => {
  const c = byId(contract.cases);
  for (const id of [
    'value-without-result-type',
    'nonvoid-fallthrough',
    'void-value-return',
    'mixed-open-brace-close-end',
    'mixed-open-end-close-brace',
    'string-selector'
  ]) {
    assert.equal(c[id].expected, 'reject', id);
  }
});

test('guards are pure and non-suspending', () => {
  const c = byId(contract.cases);
  assert.equal(c['end-guarded-void-one'].expected, 'accept');
  assert.equal(c['brace-guarded-void-one'].expected, 'accept');
  assert.equal(c['effectful-guard'].expected, 'reject');
  assert.equal(c['suspending-guard'].expected, 'reject');
});

test('state block has one fixed schema and both field spellings normalize', () => {
  const s = byId(contract.state_cases);
  assert.equal(s['state-type-first'].expected, 'accept');
  assert.equal(s['state-type-first'].canonical, true);
  assert.equal(s['state-name-first'].expected, 'accept');
  assert.equal(s['state-name-first'].canonical, false);
  for (const id of ['state-two-blocks','state-duplicate-key','state-escape-borrow','state-dynamic-index','self-state']) {
    assert.equal(s[id].expected, 'reject', id);
  }
  assert.deepEqual(s['state-direct-read'].required_effects, ['read']);
  assert.deepEqual(s['state-direct-write'].required_effects, ['write']);
  assert.deepEqual(s['state-compound-write'].required_effects, ['read','write']);
});

test('selector plus arity is the only v1 handler identity', () => {
  const d = byId(contract.duplicate_cases);
  assert.equal(d['same-selector-same-arity'].expected, 'reject');
  assert.equal(d['same-selector-different-arity'].expected, 'accept');
  assert.equal(d['different-selector-same-arity'].expected, 'accept');
});

test('nonvoid handlers require real correlated request/reply semantics', () => {
  assert.equal(contract.runtime_obligations.void_handler, 'event');
  assert.equal(contract.runtime_obligations.nonvoid_handler, 'correlated_request_reply');
  assert.equal(contract.runtime_obligations.nonvoid_must_not_use_output_stream, true);
  assert.equal(contract.runtime_obligations.guest_reply_token_forgeable, false);
});

test('all fixture ids are globally unique', () => {
  const ids = [
    ...contract.cases,
    ...contract.state_cases,
    ...contract.duplicate_cases
  ].map(row => row.id);
  assert.equal(new Set(ids).size, ids.length);
});
