import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {javaCorpus, llvmCorpus, verifyBackendSourceIdentity}
  from '../tools/compare-namespace-backend-corpus.mjs';

const contract = JSON.parse(readFileSync(new URL(
  '../contracts/conformance/namespace-guest-gates-v1.json',import.meta.url),'utf8'));

// These tests exercise only the comparator with synthetic copies of our own
// proposed corpus. They do NOT substitute for independent Java/LLVM checkouts.
function javaMirror() {
  return 'private static Corpus sourceCorpus() {\n' +
    contract.sources.map(s =>
      'sources.put('+JSON.stringify(s.path)+', '+JSON.stringify(s.content)+');\n' +
      'owners.put('+JSON.stringify(s.path)+', '+
        JSON.stringify(s.package_instance_id)+');').join('\n') +
    '\nreturn new Corpus(sources, owners);';
}
function llvmMirror() {
  return 'input.sources = {\n' +
    contract.sources.map(s=>'{' + JSON.stringify(s.path) + ', ' +
      JSON.stringify(s.package_instance_id) + ', ' +
      JSON.stringify(s.content) + '}').join(',\n') +
    '\n};\n    return input;';
}
test('synthetic source triples agree exactly with the proposed inventory',()=>{
  assert.equal(javaCorpus(javaMirror()).length,12);
  assert.equal(llvmCorpus(llvmMirror()).length,12);
  assert.deepEqual(verifyBackendSourceIdentity(contract,javaMirror(),llvmMirror()),
    {java:12,llvm:12,evidence:'SOURCE_IDENTITY_ONLY_NOT_COMPILER_OR_GUEST'});
});
test('source-byte and package-owner changes reject cross-backend identity',()=>{
  const javaWrong=javaMirror().replace('return a + b;', 'return a - b;');
  assert.throws(()=>verifyBackendSourceIdentity(contract,javaWrong,llvmMirror()),
    /java source identity or bytes drift/);
  const llvmWrong=llvmMirror().replace('"other@1"', '"wrong@1"');
  assert.throws(()=>verifyBackendSourceIdentity(contract,javaMirror(),llvmWrong),
    /llvm source identity or bytes drift/);
});
test('missing and duplicate source-unit inventory rejects',()=>{
  const javaShort=javaMirror().replaceAll(
    'sources.put("foo/src/data/models.ores"', 'sources.put("foo/src/data/unlisted.ores"');
  assert.throws(()=>verifyBackendSourceIdentity(contract,javaShort,llvmMirror()),
    /identity or bytes drift/);
  const twice=llvmMirror().replace('"other/src/collision.ores"',
    '"foo/src/compute/math.ores"');
  assert.throws(()=>verifyBackendSourceIdentity(contract,javaMirror(),twice),
    /identity or bytes drift/);
});
test('fixtures cannot be promoted as backend evidence',()=>{
  assert.ok(contract.backend_evidence.java.guest_executed===false &&
    contract.backend_evidence.llvm.guest_executed===false);
  assert.notEqual(verifyBackendSourceIdentity(contract,javaMirror(),llvmMirror()).evidence,
    'GUEST_EXECUTED');
});
