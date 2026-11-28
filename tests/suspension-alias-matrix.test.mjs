import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyDuplicateSuspensionMatrix} from '../scripts/verify-suspension-alias-matrix.mjs';
const manifest = JSON.parse(readFileSync(new URL('../contracts/v1/critical-suspends-v1/cases.json', import.meta.url), 'utf8'));
test('all ordered suspension alias pairs reject duplicate effects', () => {
  assert.equal(verifyDuplicateSuspensionMatrix(manifest), 16);
});
test('missing or accidentally accepted pair fails the corpus gate', () => {
  for (const first of ['suspends','susp','⧖','∂']) for (const second of ['suspends','susp','⧖','∂']) {
    const source = 'pub ' + first + ' ' + second + ' fnc invalid(): void { return; }';
    const mutated = structuredClone(manifest);
    mutated.cases.find(c => c.source === source).expected = 'accept';
    assert.throws(() => verifyDuplicateSuspensionMatrix(mutated), /duplicate suspension pair/);
    mutated.cases = mutated.cases.filter(c => c.source !== source);
    assert.throws(() => verifyDuplicateSuspensionMatrix(mutated), /duplicate suspension pair/);
  }
});
