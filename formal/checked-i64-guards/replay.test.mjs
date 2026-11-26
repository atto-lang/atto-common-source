import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateModel, validateTranscript } from './replay.mjs';
const model = readFileSync(new URL('./model.smt2', import.meta.url));
test('reviewed bytes accepted', () => validateModel(model));
for (const [label, bytes] of [
  ['empty', Buffer.alloc(0)],
  ['appended whitespace', Buffer.concat([model, Buffer.from(' ')])],
  ['changed assertion', Buffer.from(model.toString().replace('(assert add_overflow)', '(assert true)'))],
  ['echo-only replacement', Buffer.from('(echo "P01 add overflow iff widened result outside range")\n(echo "unsat")\n')],
]) test(`reject model: ${label}`, () => assert.throws(() => validateModel(bytes), /unreviewed SMT model bytes/));
const transcript = [...model.toString().matchAll(/\(echo "([^"\n]+)"\)/g)].flatMap(([,label]) => [label, label.startsWith('P') ? 'unsat' : 'sat']).join('\n') + '\n';
test('expected transcript accepted', () => validateTranscript(transcript));
for (const [label, output] of [
  ['missing', transcript.slice(0, -4)],
  ['extra', transcript + 'sat\n'],
  ['unknown', transcript.replace('unsat', 'unknown')],
  ['wrong proof result', transcript.replace('unsat', 'sat')],
  ['wrong mutant result', transcript.replace('\nsat\n', '\nunsat\n')],
  ['error', 'error\n' + transcript],
]) test(`reject transcript: ${label}`, () => assert.throws(() => validateTranscript(output), /incorrect solver result/));
