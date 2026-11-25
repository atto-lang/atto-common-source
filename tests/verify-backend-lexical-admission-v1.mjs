import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateAdmission } from '../scripts/validate-backend-lexical-admission.mjs';

const load = () => JSON.parse(fs.readFileSync(
  new URL('../contracts/editor-syntax/v1/backend-lexical-admission-v1.json', import.meta.url)));
const corpus = fs.readFileSync(new URL(
  '../contracts/editor-syntax/v1/compiler-lexical-differential-v1.tsv', import.meta.url));

test('six-backend matrix validates the exact Git blob but claims no execution', () => {
  const matrix = load();
  assert.deepEqual(validateAdmission(matrix, corpus), {
    checkedBackends: 6,
    expectedCases: 34,
    actualCorpusBlob: 'eeed64b7d33c262b35120662386435575982a9bc'
  });
  for (const entry of matrix.backends) {
    for (const stage of ['lexer', 'parser', 'runtime']) {
      assert.equal(entry[stage], 'NOT_EXECUTED', entry.id + ': ' + stage);
    }
  }
});

test('deny green, skipped, or ambiguous backend outcomes without real receipts', () => {
  for (const bogus of ['PASS', 'FAIL', 'pending', 'skipped', 'success']) {
    const matrix = load();
    matrix.backends[0].lexer = bogus;
    assert.throws(() => validateAdmission(matrix, corpus), /LEXICAL_ADMISSION_REJECTED/);
  }
  const forged = load();
  forged.backends[2].testedHead = 'a'.repeat(40);
  assert.throws(() => validateAdmission(forged, corpus), /fabricated receipt/);
});

test('plausible complete GitHub receipt cannot authenticate test-plan PASS', () => {
  const report=load();
  const java=report.backends[0];
  java.lexer='PASS';
  java.testedHead='a'.repeat(40);
  java.runUrl='https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/123456';
  java.executedSteps=9;
  java.executedCases=34;
  java.receiptSha256='f'.repeat(64);
  assert.throws(()=>validateAdmission(report,corpus),
    /test-plan cannot claim executed PASS\/FAIL evidence/);
  java.lexer='FAIL';
  assert.throws(()=>validateAdmission(report,corpus),
    /test-plan cannot claim executed PASS\/FAIL evidence/);
});

test('reject missing backends, invalid corpus content, and unsupported without explanation', () => {
  const missing = load();
  missing.backends.pop();
  assert.throws(() => validateAdmission(missing, corpus), /backends requires exact own data slots/);
  // Cranelift is an independent backend: do not alias LLVM or Forge.
  assert.deepEqual(load().backends.map(b => b.id),
    ['java', 'llvm', 'wasm', 'cranelift', 'net', 'forge']);
  const duplicated = load();
  duplicated.backends[3].id = 'llvm';
  assert.throws(() => validateAdmission(duplicated, corpus), /backend identities/);
  const reordered = load();
  [reordered.backends[2], reordered.backends[3]] =
    [reordered.backends[3], reordered.backends[2]];
  assert.throws(() => validateAdmission(reordered, corpus), /backend identities/);
  const altered = Buffer.from(corpus);
  altered[altered.length-2] ^= 1;
  assert.throws(() => validateAdmission(load(), altered), /blob mismatch/);
  const unsupported = load();
  unsupported.backends[3].lexer = 'UNSUPPORTED';
  assert.throws(() => validateAdmission(unsupported, corpus), /explicit reason/);
  unsupported.backends[3].unsupportedReason = 'No checked native lexer execution or supported frontend found';
  assert.equal(validateAdmission(unsupported, corpus).checkedBackends, 6);
});

test('Cranelift cannot claim green lexer, parser or runtime evidence in a static plan', () => {
  for (const dimension of ['lexer', 'parser', 'runtime']) {
    const forged = load();
    const cranelift = forged.backends.find(b => b.id === 'cranelift');
    cranelift[dimension] = 'PASS';
    cranelift.testedHead = 'a'.repeat(40);
    cranelift.runUrl = 'https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/actions/runs/123';
    cranelift.executedSteps = 9;
    cranelift.executedCases = 34;
    cranelift.receiptSha256 = 'f'.repeat(64);
    assert.throws(() => validateAdmission(forged, corpus),
      /test-plan cannot claim executed PASS\/FAIL evidence/);
  }
});
