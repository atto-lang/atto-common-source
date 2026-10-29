import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// SOURCE-FREE MODEL ONLY: not an Oreslang parser, compiler, or actor runtime.
const contract = JSON.parse(readFileSync(
  new URL('../fixtures/actor-init-spawn-v1.json', import.meta.url),
  'utf8'
));

function sameUniqueNames(provided, required) {
  return provided.length === required.length &&
    new Set(provided).size === provided.length &&
    new Set(required).size === required.length &&
    provided.every(name => required.includes(name));
}

// Deliberately minimal reference admission model: it checks the contract's
// complete-state, explicit dependency and lifecycle rules without pretending
// to recognize Oreslang syntax or execute a guest actor.
function admit(overrides) {
  const a = {...contract.defaults, ...overrides};
  if (a.actor_constructor || a.actor_external_init || ![0, 1].includes(a.init_count)) return 'reject';
  if (a.init_count === 1 && a.has_on_start) return 'reject';
  if (a.rebind_immutable_dependency) return 'reject';
  if (!a.arg_types_match || a.implicit_conversion || !a.dep_generation_valid ||
      !a.dep_tenant_authorized || !a.dep_cross_isolate_brokered ||
      !a.deps_capability_authorized || !a.deps_ownership_safe) return 'reject';
  if (!a.budget_ok || a.graph_cycle || a.ambient_resolution ||
      !a.mutation_via_sealed_write || (a.hard_rt && !a.init_bounded)) return 'reject';

  if (a.init_count === 0) {
    if (a.spawn_args.length !== 0 || !a.state_has_defaults) return 'reject';
  } else {
    if (!sameUniqueNames(a.spawn_args, a.init_params)) return 'reject';
    if (a.init_effect !== 'pure' || !a.state_types_match ||
        !a.state_builder_private ||
        !sameUniqueNames(a.state_return_keys, a.state_keys)) return 'reject';
  }

  if (a.restoring) {
    if (a.init_runs !== 0 || !a.restore_rebound_authorized) return 'reject';
  } else if (a.init_count === 1 && a.init_runs !== 1) {
    return 'reject';
  }

  if (a.published_before_commit || (a.init_failed && !a.rollback_complete)) return 'reject';
  return 'accept';
}

test('canonical contract is a proposal, never an executable backend claim', () => {
  assert.equal(contract.schema, 'oreslang.actor-init-spawn.v1');
  assert.equal(contract.status, 'PROPOSED_SOURCE_FREE_NOT_EXECUTED');
  for (const [key, value] of Object.entries(contract.evidence)) {
    if (key === 'reference_model_is_compiler_evidence' ||
        key === 'private_source_transfer_authorized') assert.equal(value, false);
    else assert.equal(value, 'NOT_EXECUTED', key);
  }
});

test('spawn binds init without an actor constructor or reflection container', () => {
  const d = contract.design;
  assert.equal(d.initialization_hook, 'init');
  assert.equal(d.actor_constructor_allowed, false);
  assert.equal(d.initializer_invoked_through, 'spawn Actor(named arguments)');
  assert.equal(d.reflective_service_locator_allowed, false);
  assert.equal(d.async_init_allowed, false);
  assert.equal(d.implicit_future_or_option_flattening, false);
});

test('all vectors have unique IDs and their expected admission matches the model', () => {
  const seen = new Set();
  for (const row of contract.cases) {
    assert.ok(!seen.has(row.id), 'duplicate ID ' + row.id);
    seen.add(row.id);
    assert.ok(['accept', 'reject'].includes(row.expected), row.id);
    assert.equal(admit(row.overrides), row.expected, row.id);
  }
  assert.ok(seen.size >= 35, 'adversarial coverage not accidentally removed');
});

test('publication, abort and restore cannot re-run init or expose partial state', () => {
  for (const id of ['public-ref-before-commit','run-init-twice',
                    'failed-init-leaked-resources','restore-reruns-init',
                    'restore-unfenced-capability']) {
    assert.equal(contract.cases.find(row => row.id === id)?.expected, 'reject', id);
  }
  assert.equal(contract.cases.find(row => row.id === 'failed-init-clean-rollback')?.expected, 'accept');
  assert.equal(contract.cases.find(row => row.id === 'restore-skips-init')?.expected, 'accept');
});

test('actor state retains dependencies and later writes require sealed critical mode', () => {
  assert.equal(contract.design.initialized_state_location, 'single compiler-owned state schema');
  assert.equal(contract.design.mutation_method, 'self.handle_state(critical[write] ...)');
  assert.equal(admit({mutation_via_sealed_write: false}), 'reject');
  assert.equal(admit({state_return_keys: ['store', 'gateway']}), 'reject');
  assert.equal(admit({state_return_keys: ['store', 'store', 'gateway', 'phase']}), 'reject');
});

test('init cannot coexist with on_start or rebind an immutable dependency', () => {
  assert.equal(contract.design.init_on_start_coexistence_allowed, false);
  assert.equal(contract.design.dependency_binding_kind, 'val');
  assert.equal(contract.design.mutable_business_state_binding_kind, 'let');
  assert.equal(admit({has_on_start: true}), 'reject');
  assert.equal(admit({rebind_immutable_dependency: true}), 'reject');
});

test('authorization, ownership, capabilities and graph budget fail closed', () => {
  for (const key of [
    'dep_generation_valid', 'dep_tenant_authorized', 'dep_cross_isolate_brokered',
    'deps_capability_authorized', 'deps_ownership_safe', 'budget_ok'
  ]) assert.equal(admit({[key]: false}), 'reject', key);
  assert.equal(admit({graph_cycle: true}), 'reject');
  assert.equal(admit({ambient_resolution: true}), 'reject');
  assert.equal(admit({hard_rt: true, init_bounded: false}), 'reject');
});

test('forbidden init effects fail without running a guest actor', () => {
  for (const effect of ['suspend', 'io', 'send', 'spawn', 'handle_state', 'self_escape']) {
    assert.equal(admit({init_effect: effect}), 'reject', effect);
  }
});

test('design-target .ores manifest pins exact Git blobs without claiming guest execution', () => {
  const manifest = JSON.parse(readFileSync(
    new URL('../fixtures/actor-init-spawn-v1/manifest.json', import.meta.url),
    'utf8'
  ));
  assert.equal(manifest.schema, 'oreslang.actor-init-guest-fixtures.v1');
  assert.equal(manifest.status, 'DESIGN_TARGET_NOT_EXECUTED');
  const seen = new Set();
  for (const row of manifest.cases) {
    assert.match(row.path, /^[a-z][a-z0-9-]+\\.ores$/);
    assert.ok(!seen.has(row.path), row.path);
    seen.add(row.path);
    assert.ok(['accept', 'reject'].includes(row.expected), row.path);
    assert.equal(row.evidence, 'NOT_EXECUTED', row.path);
    const bytes = readFileSync(
      new URL('../fixtures/actor-init-spawn-v1/' + row.path, import.meta.url)
    );
    const hash = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\\0'))
      .update(bytes)
      .digest('hex');
    assert.equal(hash, row.blob_sha, 'exact-source blob mismatch: ' + row.path);
  }
  assert.equal(seen.size, 6);
  assert.equal(manifest.cases.filter(row => row.expected === 'accept').length, 1);
});
