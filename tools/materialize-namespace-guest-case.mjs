#!/usr/bin/env node
// A source-fixture materializer, not an Oreslang compiler or parity oracle.
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const contractUrl = new URL('../contracts/conformance/namespace-guest-gates-v1.json', import.meta.url);
const namePattern = /^[a-z][a-z0-9-]{0,63}$/;
const expectedCaseClasses = Object.freeze({
  'ns-exit-43': ['pass', 'EXECUTE', 'execution'],
  'missing-pin': ['reject', 'UNDECLARED_ALIAS', 'portable_semantics'],
  'colliding-package-pin': ['reject', 'NO_CROSS_PACKAGE_FALLBACK', 'portable_semantics'],
  'unknown-export': ['reject', 'UNKNOWN_EXPORT', 'portable_semantics'],
  'wrong-arity': ['reject', 'WRONG_ARITY', 'portable_semantics'],
  'wrong-arg-type': ['reject', 'TYPE_MISMATCH', 'portable_semantics'],
  'duplicate-export': ['reject', 'DUPLICATE_PUBLIC_ARITY', 'portable_semantics'],
  'private-export': ['reject', 'VISIBILITY_DENIED', 'portable_semantics'],
  'shadow-import': ['reject', 'SHADOWED_BINDING', 'portable_semantics'],
  'duplicate-import': ['reject', 'DUPLICATE_IMPORT', 'portable_semantics'],
  'ambient-path-selector': ['reject', 'INVALID_SELECTOR', 'portable_semantics'],
  'provider-cycle': ['reject', 'CYCLIC_PROVIDER_CALL', 'profile_capability'],
  'cross-namespace-implicit': ['reject', 'NO_IMPLICIT_NAMESPACE', 'portable_semantics'],
  'provider-init': ['reject', 'UNSUPPORTED_INITIALIZATION', 'profile_capability'],
  'named-arg-call': ['reject', 'UNSUPPORTED_ABI', 'profile_capability'],
  'wrong-bool-type': ['reject', 'TYPE_MISMATCH', 'portable_semantics'],
});

function assert(ok, msg) { if (!ok) throw new Error(msg); }
function safeFilePath(path) {
  assert(typeof path === 'string' && /^[A-Za-z0-9_./-]+[.]ores$/.test(path),
    'unsafe source file path');
  const parts = path.split('/');
  assert(parts.every(p => p && p !== '.' && p !== '..'), 'noncanonical source file path');
  return path;
}

export function validateContract(contract) {
  assert(contract?.schema === 'oreslang-cross-backend-namespace-guest-gates-v1',
    'wrong source corpus contract');
  assert(contract.status === 'PROPOSED_SOURCE_CORPUS_NOT_EXECUTION_EVIDENCE',
    'contract must not claim execution');
  assert(contract.authority?.no_ambient_filesystem_discovery === true,
    'ambient package discovery forbidden');
  assert(Array.isArray(contract.sources) && contract.sources.length === 12,
    'ten providers, collision and entry source required');
  assert(Array.isArray(contract.cases) &&
    contract.cases.length === Object.keys(expectedCaseClasses).length,
    'incomplete or ambiguous conformance gate');
  const paths = new Set();
  for (const s of contract.sources) {
    safeFilePath(s.path);
    assert(!paths.has(s.path), 'duplicate source path');
    paths.add(s.path);
    assert(typeof s.content === 'string' && s.content.length > 0 && s.content.length <= 8192,
      'source size invalid');
    assert(namePattern.test(s.package_instance_id.replace('@1', '')),
      'invalid package identity');
  }
  const foo = contract.sources.filter(s => s.package_instance_id === 'foo@1');
  assert(foo.length === 10, 'not exactly ten foo source units');
  // The collision source must actually be a different pinned package. If an
  // author changes its ownership, a supposed no-fallback negative could pass
  // for the wrong reason (missing package), invalidating the oracle.
  const entryUnit = contract.sources.find(s => s.path === 'app/src/main.ores');
  const collisionUnit = contract.sources.find(s => s.path === 'other/src/collision.ores');
  assert(entryUnit?.package_instance_id === 'app@1' &&
    collisionUnit?.package_instance_id === 'other@1' &&
    collisionUnit.content.startsWith('namespace a;\n') &&
    collisionUnit.content.includes('pub fnc add(int a, int b): int'),
    'entry and same-name collision require exact independent package owners');
  assert(contract.sources.every(s =>
    ['foo@1', 'other@1', 'app@1'].includes(s.package_instance_id)),
    'unlisted package authority in closed guest corpus');
  const counts = {a:0,b:0,c:0};
  for (const s of foo) {
    const m = /^namespace ([abc]);\n/.exec(s.content);
    assert(m !== null, 'provider namespace declaration missing or invalid');
    counts[m[1]]++;
  }
  assert(counts.a === 3 && counts.b === 4 && counts.c === 3,
    'unexpected namespace membership breakdown');
  assert(contract.authority?.alias_pins?.['app@1']?.foo === 'foo@1',
    'base alias pin not exact');
  assert(contract.sources.find(s => s.path === 'app/src/main.ores')?.content.includes(
    'import ns a from "pkg:foo";'), 'missing qualified source import');
  const ids = new Set(), codes = new Set();
  let passing = 0;
  for (const c of contract.cases) {
    assert(namePattern.test(c.id) && !ids.has(c.id), 'duplicate/invalid case ID');
    ids.add(c.id);
    const expectedClass = expectedCaseClasses[c.id];
    assert(expectedClass && c.expected === expectedClass[0] &&
      c.code === expectedClass[1] && c.gate_scope === expectedClass[2],
      'case classification drift: ' + c.id);
    assert(c.expected === 'pass' || c.expected === 'reject', 'invalid expected outcome');
    if (c.expected === 'pass') {
      passing++;
      assert(c.code === 'EXECUTE' && c.id === 'ns-exit-43',
        'unexpected positive proof expectation');
    } else {
      assert(/^[A-Z_]+$/.test(c.code) && c.code !== 'EXECUTE',
        'missing negative classification');
      codes.add(c.code);
    }
    if (c.mutation) {
      assert(paths.has(c.mutation.file), 'mutation file absent from closed source set');
      const [before, after] = c.mutation.replace ?? [];
      assert(typeof before === 'string' && before.length && typeof after === 'string',
        'mutation must have one exact replacement');
      const source = contract.sources.find(s => s.path === c.mutation.file).content;
      assert(source.split(before).length === 2, 'mutation target not unique');
    }
    if (c.alias_override) {
      assert(c.id === 'colliding-package-pin' &&
        c.alias_override?.['app@1']?.foo === 'other@1',
        'unauthorized alias override');
    }
  }
  assert(passing === 1 && codes.size >= 10, 'missing negative semantic coverage');
  // A negative test must not pass for an unrelated missing import, missing
  // consumer member, or an intentionally unreachable duplicate/init source.
  const byId = id => contract.cases.find(c => c.id === id);
  const original = path => contract.sources.find(s => s.path === path)?.content;
  const afterMutation = id => {
    const m = byId(id)?.mutation;
    assert(m && typeof m.file === 'string' && Array.isArray(m.replace),
      'missing semantic mutation: ' + id);
    return original(m.file).replace(m.replace[0], m.replace[1]);
  };
  const crossed = afterMutation('colliding-package-pin');
  assert(byId('colliding-package-pin').alias_override?.['app@1']?.foo ===
    'other@1' && crossed.includes('a.aggregate(21)') &&
    !crossed.includes('import ns c') && !crossed.includes('c.response_delta'),
    'cross-package test must isolate forbidden fallback');
  const duplicate = afterMutation('duplicate-export');
  assert(byId('duplicate-export').mutation.file.startsWith('foo/') &&
    /namespace a;/.test(duplicate) &&
    duplicate.includes('pub fnc aggregate(int value): int { return 0; }') &&
    original('foo/src/compute/aggregation.ores').includes(
      'pub fnc aggregate(int value)'),
    'duplicate-export mutation must collide with reachable provider');
  const init = afterMutation('provider-init');
  assert(byId('provider-init').mutation.file.startsWith('foo/') &&
    init.startsWith('namespace a;') &&
    init.includes('fnc init(): int { return 0; }'),
    'init negative must target a reachable namespace');
  for (const [id, state] of Object.entries(contract.backend_evidence ?? {})) {
    assert(['java','llvm','net','wasm','forge'].includes(id) &&
      state.compiler_executed === false && state.guest_executed === false &&
      state.exact_head_verified === false, 'unsupported parity assertion');
  }
  assert(Object.keys(contract.backend_evidence).length === 5,
    'missing backend evidence states');
  // Extended positive uses all ten provider functions, not only a/c.
  // It is an authored future native guest oracle, not a compiler receipt.
  const expectedAllProviders = [
    'import ns a from "pkg:foo";',
    'import ns b from "pkg:foo";',
    'import ns c from "pkg:foo";',
    'pub fnc main(): int { return a.aggregate(21) + c.response_delta() '
      + '+ b.model_code() + b.query_code() + b.storage_code() '
      + '+ b.validation_code(); }'
  ].join('\n') + '\n';
  const extended = contract.extended_positive;
  assert(extended?.id === 'all-provider-exit-53' &&
    extended.profile === 'pinned_ns' &&
    extended.entry_source === expectedAllProviders &&
    extended.expected_exit === 53 &&
    JSON.stringify(extended.backend_targets) === '["java","llvm"]' &&
    extended.compiler_executed === false &&
    extended.guest_executed === false &&
    extended.evidence === 'NOT_EXECUTED',
    'all-provider guest oracle drift or unsupported execution claim');
  assert(contract.grammar_profiles?.manifest_namespace?.status ===
    'ALTERNATE_DRAFT_NOT_EQUIVALENT', 'do not silently unify import dialects');
  return true;
}

export function materializeCase(contract, id) {
  validateContract(contract);
  const selected = contract.cases.find(c => c.id === id);
  assert(selected, 'unknown case id');
  const root = mkdtempSync(join(tmpdir(), 'ores-ns-guest-'));
  try {
    for (const source of contract.sources) {
      const relative = safeFilePath(source.path);
      const abs = resolve(root, relative);
      assert(abs.startsWith(root + sep), 'source escaped temporary root');
      mkdirSync(dirname(abs), {recursive:true});
      let bytes = source.content;
      if (selected.mutation?.file === relative) {
        const [before, after] = selected.mutation.replace;
        bytes = bytes.replace(before, after);
      }
      writeFileSync(abs, bytes, {flag:'wx', mode:0o600});
    }
    const pins = selected.alias_override ?? contract.authority.alias_pins;
    writeFileSync(join(root,'pinned-aliases.json'),
      JSON.stringify(pins,null,2)+'\n',{flag:'wx',mode:0o600});
    return {root, id, expected:selected.expected, code:selected.code,
      profile:'pinned_ns', entry:'app/src/main.ores',
      // A compile-negative case never has a guest exit oracle; running a
      // leftover executable from another case would be a false pass.
      expected_exit:selected.expected === 'pass' ? 43 : null,
      gate_scope:selected.gate_scope,
      evidence:'NOT_EXECUTED'};
  } catch(error) {
    rmSync(root,{recursive:true,force:true});
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3, 'usage: node tools/materialize-namespace-guest-case.mjs <case-id>');
    const contract = JSON.parse(readFileSync(contractUrl,'utf8'));
    const materialized = materializeCase(contract,process.argv[2]);
    process.stdout.write(JSON.stringify(materialized)+'\n');
  } catch (error) {
    process.stderr.write('NAMESPACE_FIXTURE_REJECTED: '+error.message+'\n');
    process.exitCode = 1;
  }
}
