import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {validateContract, materializeCase} from '../tools/materialize-namespace-guest-case.mjs';

const contract = JSON.parse(readFileSync(new URL(
  '../contracts/conformance/namespace-guest-gates-v1.json', import.meta.url),'utf8'));

test('ten physical source files form only three package-owned namespaces', () => {
  assert.equal(validateContract(contract), true);
  assert.equal(contract.sources.filter(s=>s.package_instance_id==='foo@1').length,10);
  assert.equal(contract.backend_evidence.java.compiler_executed,false);
  assert.equal(contract.backend_evidence.llvm.guest_executed,false);
  assert.equal(contract.grammar_profiles.manifest_namespace.status,'ALTERNATE_DRAFT_NOT_EQUIVALENT');
});

test('each authored positive or rejection case materializes a closed source inventory', () => {
  for(const expected of contract.cases){
    const result = materializeCase(contract,expected.id);
    try {
      assert.equal(result.evidence,'NOT_EXECUTED');
      assert.equal(result.expected,expected.expected);
      assert.equal(result.code,expected.code);
      const entry = readFileSync(join(result.root,'app/src/main.ores'),'utf8');
      assert.match(entry,/pub fnc main/);
      const alias=JSON.parse(readFileSync(join(result.root,'pinned-aliases.json'),'utf8'));
      assert.equal(alias['app@1'].foo,expected.id==='colliding-package-pin'?'other@1':'foo@1');
      const normalized=contract.sources.find(x=>x.path===expected.mutation?.file);
      if(normalized){
        const path=join(result.root,normalized.path);
        const file=readFileSync(path,'utf8');
        assert.notEqual(file,normalized.content);
        assert.ok(file.includes(expected.mutation.replace[1]));
      }
    } finally {rmSync(result.root,{force:true,recursive:true});}
  }
});

test('fail closed on fabricated execution receipts or inflated parity status', () => {
  const invalid=structuredClone(contract);
  invalid.backend_evidence.llvm.guest_executed=true;
  assert.throws(()=>validateContract(invalid),/unsupported parity assertion/);
  const invalid2=structuredClone(contract);
  invalid2.grammar_profiles.manifest_namespace.status='EQUIVALENT';
  assert.throws(()=>validateContract(invalid2),/silently unify/);
});

test('fail closed on duplicate provider file and mutation alias', () => {
  const duplicate=structuredClone(contract);
  duplicate.sources[1].path=duplicate.sources[0].path;
  assert.throws(()=>validateContract(duplicate),/duplicate source path/);
  const bad=structuredClone(contract);
  bad.cases[1].mutation.replace[0]='not present';
  assert.throws(()=>validateContract(bad),/mutation target not unique/);
});

test('source path cannot escape materialized case root', () => {
  const bad=structuredClone(contract);
  bad.sources[0].path='../outside.ores';
  assert.throws(()=>validateContract(bad),/unsafe|noncanonical/);
});

test('unsupported import profiles are not promoted by fixture authorship', () => {
  assert.equal(contract.authority.no_ambient_filesystem_discovery,true);
  assert.match(contract.promotion,/nonzero steps/);
  assert.ok(Object.values(contract.backend_evidence).every(x=>!x.compiler_executed && !x.guest_executed));
  assert.equal(contract.grammar_profiles.pinned_ns.syntax,'import ns a from "pkg:foo";');
});
