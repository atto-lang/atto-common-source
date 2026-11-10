import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';

const root = new URL('../fixtures/macro-declaration-aot-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const semantics = JSON.parse(readFileSync(new URL('../fixtures/macro-semantics-v1.json', import.meta.url), 'utf8'));

function source(caseInfo) {
  assert.match(caseInfo.source, /^[a-z][a-z0-9-]*\.atto$/);
  const url = new URL(caseInfo.source, root);
  const stat = lstatSync(url);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), caseInfo.source);
  const bytes = readFileSync(url);
  assert.ok(bytes.length > 0 && bytes.length <= 1_048_576, caseInfo.source);
  assert.equal(bytes.at(-1), 10, caseInfo.source);
  const gitSha = createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
  assert.equal(gitSha, caseInfo.blob_sha1, `stale/tampered fixture: ${caseInfo.source}`);
  return bytes.toString('utf8');
}

test('macro declaration AOT contract is proposal-only, not guest proof', () => {
  assert.equal(manifest.schema, 'attolang.macro-declaration-aot-v1');
  assert.equal(manifest.status, 'SOURCE_CONTRACT_ONLY_NOT_EXECUTED');
  assert.equal(manifest.stage, 'TARGET_SYNTAX_NOT_YET_ADMITTED');
  assert.equal(manifest.language_extension, '.atto');
  assert.equal(manifest.semantics_reference, 'fixtures/macro-semantics-v1.json');
  assert.deepEqual(manifest.macro_result_kinds, ['Syntax<Decl>', 'SyntaxList<Decl>']);
  assert.ok(semantics.meta_types.includes('Syntax<Decl>'));
  assert.ok(semantics.meta_types.includes('SyntaxList<Decl>'));
  assert.deepEqual(manifest.compile_order, semantics.phase_order);
  assert.deepEqual(manifest.limits, {
    max_expansions_per_consumer_unit: 128,
    max_nesting_depth: 64,
    compile_time_only: true,
  });
});

test('canonical eight fixture blobs are immutable and expectations are unambiguous', () => {
  const files = new Set();
  const ids = new Set();
  assert.equal(manifest.cases.length, 8);
  let positives = 0;
  let negatives = 0;
  for (const c of manifest.cases) {
    assert.match(c.id, /^MA-D-00[1-8]$/);
    assert.ok(!ids.has(c.id), c.id);
    assert.ok(!files.has(c.source), c.source);
    ids.add(c.id);
    files.add(c.source);
    assert.match(c.blob_sha1, /^[0-9a-f]{40}$/);
    const text = source(c);
    assert.match(text, /define macro /);
    assert.match(text, /-> Syntax<(Decl|Expr)>|-> SyntaxList<Decl>/);
    assert.match(text, /return quote/);
    assert.match(text, /!\(/);
    if (c.expected === 'compile_and_execute') {
      positives += 1;
      assert.equal(c.expected_guest_int, '42', c.id);
      assert.ok(['Syntax<Decl>', 'SyntaxList<Decl>'].includes(c.result_kind));
      assert.equal(Object.hasOwn(c, 'emitted_ir_bytes'), false);
    } else {
      negatives += 1;
      assert.equal(c.expected, 'reject_before_codegen', c.id);
      assert.match(c.diagnostic_class, /^[a-z_]+$/);
      assert.equal(c.emitted_ir_bytes, 0, c.id);
      assert.equal(c.emitted_artifacts, 0, c.id);
      assert.equal(Object.hasOwn(c, 'expected_guest_int'), false);
    }
  }
  assert.equal(ids.size, 8);
  assert.equal(positives, 2);
  assert.equal(negatives, 6);
  assert.deepEqual([...ids].sort(), Array.from({length: 8}, (_, i) => `MA-D-00${i + 1}`));
});

test('two accepted shapes generate entrypoint or internally bound helper', () => {
  const entries = new Map(manifest.cases.map(c => [c.source, c]));
  const entry = source(entries.get('generated-entry-42.atto'));
  const pair = source(entries.get('generated-pair-42.atto'));
  assert.match(entry, /generate_entry\(\) -> Syntax<Decl>/);
  assert.match(entry, /generate_entry!\(\)/);
  assert.match(entry, /fnc main\(\) -> int/);
  assert.match(entry, /return 42/);
  assert.match(pair, /generate_pair\(\) -> SyntaxList<Decl>/);
  assert.match(pair, /fnc generated_helper\(\) -> int/);
  assert.match(pair, /return generated_helper\(\)/);
  assert.match(pair, /generate_pair!\(\)/);
  assert.doesNotMatch(entry + pair, /Compiler\.compile\(|eval\(|import \* as /);
});

test('negative fixture categories are anchored to deliberate language violations', () => {
  const cases = new Map(manifest.cases.map(c => [c.source, c]));
  const checked = (filename, category, shape) => {
    const c = cases.get(filename);
    assert.equal(c.diagnostic_class, category);
    assert.match(source(c), shape);
  };
  checked('decl-result-in-expr-reject.atto', 'macro_result_kind', /return make_helper!\(\)/);
  checked('generated-import-reject.atto', 'macro_generated_authority', /import \* as hidden/);
  checked('generated-macro-reject.atto', 'macro_generated_macro', /define macro injected/);
  checked('duplicate-main-reject.atto', 'macro_generated_duplicate', /make_main!\(\)/);
  checked('generated-type-error-reject.atto', 'generated_type_check', /return "not an int"/);
  checked('generated-cycle-reject.atto', 'macro_expansion_cycle', /cycle!\(\)/);
  assert.equal(semantics.generated_namespace.imports_or_aliases, false);
  assert.equal(semantics.generated_namespace.macros, false);
  assert.equal(semantics.ast.typed_not_text, true);
  assert.equal(semantics.ast.hygienic_by_default, true);
});

test('all backends explicitly remain unexecuted until independent AOT evidence exists', () => {
  assert.deepEqual(manifest.backend_states.map(s => s.backend).sort(), [
    'cranelift', 'forge', 'java', 'llvm', 'net', 'wasm'
  ]);
  for (const backend of manifest.backend_states) {
    assert.equal(backend.evidence, 'NOT_EXECUTED');
    assert.equal(backend.acceptance, 'PROGRAM_SPECIFIC_AOT_GUEST_REQUIRED');
  }
  const p = manifest.evidence_policy;
  for (const key of [
    'compiler_execution_required',
    'strict_aot_guest_required',
    'source_tree_head_and_blob_sha_required',
    'verified_stepful_job_required',
    'compiler_and_artifact_sha256_required',
    'backend_adapter_must_not_interpret_macro_at_runtime',
  ]) {
    assert.equal(p[key], true, key);
  }
  for (const key of [
    'zero_step_is_execution',
    'source_only_is_guest_proof',
    'synthetic_receipt_is_guest_proof',
    'runtime_macro_fallback_allowed',
    'source_transfer_allowed_without_independent_approval',
  ]) {
    assert.equal(p[key], false, key);
  }
});
