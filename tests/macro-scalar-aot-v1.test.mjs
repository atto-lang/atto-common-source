import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../fixtures/macro-scalar-aot-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const cases = new Map(manifest.cases.map(c => [c.id, c]));
const source = name => readFileSync(new URL(name, root), 'utf8');

test('macro scalar AOT fixture manifest is explicitly source-only', () => {
  assert.equal(manifest.schema, 'attolang.macro-scalar-aot-v1');
  assert.equal(manifest.status, 'SOURCE_CONTRACT_ONLY_NOT_EXECUTED');
  assert.deepEqual(manifest.limits, {
    max_macro_declarations: 8,
    max_macro_expansions: 128,
    max_const_visits: 512,
    max_const_depth_inclusive: 64
  });
  assert.equal(manifest.evidence_policy.expected_guest_value_is_process_exit, false);
  assert.equal(manifest.evidence_policy.compiler_execution_required, true);
  assert.equal(manifest.evidence_policy.native_guest_execution_required, true);
  assert.equal(manifest.evidence_policy.exact_source_sha_and_tree_required, true);
  assert.equal(manifest.evidence_policy.zero_step_workflow_pass, false);
  assert.equal(manifest.evidence_policy.synthetic_host_test_is_macro_guest_evidence, false);
  assert.equal(manifest.evidence_policy.source_transfer_allowed_without_independent_approval, false);
  assert.equal(manifest.evidence_policy.macro_runtime_fallback_allowed, false);
});

test('seven unique and bounded .atto guest fixtures map to one immutable semantic expectation', () => {
  assert.equal(cases.size, manifest.cases.length);
  assert.equal(cases.size, 7);
  assert.deepEqual([...cases.keys()], [
    'MA-S-001', 'MA-S-002', 'MA-S-003', 'MA-S-004',
    'MA-S-005', 'MA-S-006', 'MA-S-007'
  ]);
  let accepts = 0;
  let rejects = 0;
  for (const c of cases.values()) {
    assert.match(c.source, /^[a-z][a-z0-9-]*\.atto$/);
    assert.ok(c.feature.length > 8);
    const content = source(c.source);
    assert.ok(content.endsWith('\n'), c.id);
    assert.ok(Buffer.byteLength(content, 'utf8') <= 1_048_576, c.id);
    assert.match(content, /pub fnc main\(\) -> int/);
    assert.match(content, /!\(/);
    if (c.expected === 'accept') {
      ++accepts;
      assert.equal(c.expected_guest_int, '42', c.id);
    } else {
      ++rejects;
      assert.equal(c.expected, 'reject_before_codegen', c.id);
      assert.equal(Object.hasOwn(c, 'expected_guest_int'), false, c.id);
    }
  }
  assert.equal(accepts, 3);
  assert.equal(rejects, 4);
});

test('accepted compiler-only scalar quote and single-splice shapes remain explicit', () => {
  assert.match(source('literal-42.atto'), /literal!\(const 40 \+ 2\)/);
  assert.match(source('identity-42.atto'), /identity!\(syntax expr 42\)/);
  assert.match(source('nested-42.atto'), /identity!\(syntax expr literal!\(const 6 \* 7\)\)/);
  for (const name of ['literal-42.atto', 'identity-42.atto', 'nested-42.atto']) {
    assert.match(source(name), /define macro /);
  }
});

test('rejected shapes remain explicit instead of becoming runtime calls', () => {
  assert.match(source('overflow-reject.atto'), /9223372036854775807 \+ 1/);
  assert.match(source('wrong-kind-reject.atto'), /identity!\(const 42\)/);
  assert.match(source('dynamic-const-reject.atto'), /literal!\(const runtime_value\)/);
  assert.match(source('unresolved-reject.atto'), /missing!\(syntax expr 42\)/);
  assert.doesNotMatch(source('unresolved-reject.atto'), /define macro /);
});
