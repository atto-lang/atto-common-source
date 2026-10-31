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
      assert.equal(result.gate_scope,expected.gate_scope);
      assert.equal(result.expected_exit,expected.expected==='pass'?43:null,
        'negative compilation must not inherit a successful guest exit oracle');
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

test('cross-package rejection is not caused by absent second namespace',()=>{
  const c=contract.cases.find(x=>x.id==='colliding-package-pin');
  const result=materializeCase(contract,c.id);
  try {
    const entry=readFileSync(join(result.root,'app/src/main.ores'),'utf8');
    assert.match(entry,/import ns a from "pkg:foo"/);
    assert.doesNotMatch(entry,/import ns c|c\.response_delta/);
    assert.match(entry,/a\.aggregate\(21\)/);
    assert.equal(JSON.parse(readFileSync(join(result.root,'pinned-aliases.json'),'utf8'))
      ['app@1'].foo,'other@1');
    assert.equal(result.expected_exit,null);
  } finally {rmSync(result.root,{force:true,recursive:true});}
});

test('duplicate export and init negatives target reachable namespace a',()=>{
  for(const id of ['duplicate-export','provider-init']){
    const result=materializeCase(contract,id);
    try {
      const c=contract.cases.find(x=>x.id===id);
      const mutated=readFileSync(join(result.root,c.mutation.file),'utf8');
      assert.match(mutated,/^namespace a;/);
      if(id==='duplicate-export'){
        assert.match(mutated,/pub fnc aggregate\(int value\)/);
        assert.match(readFileSync(join(result.root,
          'foo/src/compute/aggregation.ores'),'utf8'),/pub fnc aggregate\(int value\)/);
      } else {
        assert.match(mutated,/fnc init\(\): int/);
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

test('unsupported scalar ABI is not mislabeled a portable language rejection',()=>{
  const restricted=['named-arg-call','provider-init','provider-cycle'];
  for(const id of restricted){
    assert.equal(contract.cases.find(x=>x.id===id).gate_scope,'profile_capability',id);
  }
  const portable=['wrong-arity','wrong-arg-type','duplicate-export',
    'colliding-package-pin','private-export','ambient-path-selector'];
  for(const id of portable){
    assert.equal(contract.cases.find(x=>x.id===id).gate_scope,'portable_semantics',id);
  }
  const invalid=structuredClone(contract);
  invalid.cases.find(x=>x.id==='named-arg-call').gate_scope='portable_semantics';
  assert.throws(()=>validateContract(invalid),/classification drift/);
});

test('fail closed on wrong negative classifications and missing cases',()=>{
  const wrong=structuredClone(contract);
  wrong.cases.find(x=>x.id==='wrong-arity').code='TYPE_MISMATCH';
  assert.throws(()=>validateContract(wrong),/classification drift/);
  const absent=structuredClone(contract);
  absent.cases.pop();
  assert.throws(()=>validateContract(absent),/incomplete or ambiguous/);
});

test('fail closed on duplicate provider file and mutation alias', () => {
  const duplicate=structuredClone(contract);
  duplicate.sources[1].path=duplicate.sources[0].path;
  assert.throws(()=>validateContract(duplicate),/duplicate source path/);
  const bad=structuredClone(contract);
  bad.cases[1].mutation.replace[0]='not present';
  assert.throws(()=>validateContract(bad),/mutation target not unique/);
});

test('colliding namespace remains owned by a separately verified package',()=>{
  const forged=structuredClone(contract);
  forged.sources.find(s=>s.path==='other/src/collision.ores').package_instance_id='unlisted@1';
  assert.throws(()=>validateContract(forged),
    /closed source inventory path\/package authority drift/);
  const drift=structuredClone(contract);
  drift.sources.find(s=>s.path==='app/src/main.ores').package_instance_id='unknown@1';
  assert.throws(()=>validateContract(drift),/closed source inventory path\/package authority drift/);
});

test('closed provider inventory does not accept an renamed or re-owned source',()=>{
  const renamed=structuredClone(contract);
  renamed.sources.find(s=>s.path==='foo/src/compute/math.ores').path=
    'foo/src/compute/alternate.ores';
  assert.throws(()=>validateContract(renamed),
    /closed source inventory path\/package authority drift/);
  const reowned=structuredClone(contract);
  reowned.sources.find(s=>s.path==='foo/src/data/models.ores').package_instance_id='other@1';
  assert.throws(()=>validateContract(reowned),
    /closed source inventory path\/package authority drift/);
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
