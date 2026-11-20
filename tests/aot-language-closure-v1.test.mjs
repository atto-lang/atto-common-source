import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const c = JSON.parse(readFileSync(
  new URL('../fixtures/aot-language-closure-v1.json', import.meta.url),
  'utf8'
));
const byId = rows => Object.fromEntries(rows.map(x => [x.id, x]));

test('full AOT closure is the normal language profile', () => {
  assert.equal(c.schema, 'oreslang.aot-language-closure.v1');
  assert.equal(c.status, 'SOURCE_CONTRACT_ONLY');
  assert.equal(c.closure_requirements.includes('no_runtime_code_generation'), true);
  assert.equal(c.runtime.runtime_jit_required, false);
  assert.equal(c.runtime.runtime_reflection_required, false);
  assert.equal(c.runtime.eval_source_strings, false);
  assert.equal(c.macro_contract, 'oreslang.macro-semantics.v1');
});

test('nonvoid non-lambda callables require explicit return', () => {
  const k=byId(c.cases);
  assert.equal(c.explicit_returns.nonvoid_nonlambda_requires_explicit_return, true);
  assert.equal(c.explicit_returns.tail_expression_returns, false);
  assert.equal(c.explicit_returns.lambda_expression_body_exception, true);
  assert.equal(k['nonvoid-tail-expression'].expected,'reject');
  assert.equal(k['nonvoid-explicit-return'].expected,'accept');
  assert.equal(k['lambda-expression-body'].expected,'accept');
});

test('value match keeps function and arm result returns distinct', () => {
  const k=byId(c.cases);
  assert.equal(c.explicit_returns.value_dispatch_outer_return,'FUNCTION_RETURN');
  assert.equal(c.explicit_returns.value_dispatch_block_arm_return,'ARM_RESULT');
  assert.equal(c.match_arms.expression,'on pattern [when guard] -> expression;');
  assert.equal(c.match_arms.block,'on pattern [when guard] -> :: statements end');
  assert.equal(k['match-expression-arm'].expected,'accept');
  assert.equal(k['match-block-explicit-arm-result'].expected,'accept');
  assert.equal(k['match-block-tail-expression'].expected,'reject');
});

test('Elixir-inspired features all have static AOT lowerings', () => {
  for (const f of c.features) assert.equal(f.aot,'required',f.id);
  const f=byId(c.features);
  assert.equal(f['with'].runtime_interpreter,false);
  assert.equal(f['comprehension'].runtime_code_compile,false);
  assert.equal(f['traits_protocols'].runtime_registry,false);
  assert.equal(f['struct_update_typed_path'].runtime_reflection,false);
  assert.equal(f['sigils'].runtime_parser_required,false);
  assert.equal(f['comptime'].survives_to_runtime,false);
  assert.equal(f['define_macro'].survives_to_runtime,false);
});

test('compile-time execution is hermetic and cannot mint authority', () => {
  const a=c.compile_time_authority;
  for (const key of ['ambient_network','ambient_wall_clock','ambient_random','undeclared_environment','arbitrary_host_files','runtime_capability_minting']) {
    assert.equal(a[key],false,key);
  }
  assert.equal(a.generated_code_rechecked,true);
  assert.equal(a.hygienic_by_default,true);
  assert.equal(a.resource_bounded,true);
  assert.equal(a.fallback_to_runtime_on_exhaustion,false);
});

test('generic specialization graph is finite', () => {
  assert.equal(c.generics.finite_reachable_instantiations,true);
  assert.equal(c.generics.runtime_new_instantiation,false);
  assert.deepEqual(c.generics.permitted.sort(),['explicit_specialization','monomorphization','shape_sharing','static_witness'].sort());
});

test('runtime data generation is distinct from runtime executable generation', () => {
  const k=byId(c.cases);
  assert.equal(c.runtime.generated_data_allowed,true);
  assert.equal(c.runtime.generated_oreslang_code_execution,false);
  assert.equal(k['runtime-data-generation'].expected,'accept');
  for (const id of ['runtime-eval','runtime-protocol-registry','runtime-source-hot-reload']) {
    assert.equal(k[id].expected,'reject',id);
  }
});

test('hot reload stages a precompiled AOT image', () => {
  const k=byId(c.cases);
  assert.equal(c.hot_reload.candidate_is_precompiled_aot_image,true);
  assert.equal(c.hot_reload.abi_validation_before_admission,true);
  assert.equal(c.hot_reload.runtime_source_compiler_required,false);
  assert.equal(k['precompiled-hot-reload'].expected,'accept');
});

test('all case ids are unique and outcomes are closed', () => {
  const ids=c.cases.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for (const row of c.cases) assert.ok(['accept','reject'].includes(row.expected),row.id);
});
