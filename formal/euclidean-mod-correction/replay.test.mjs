import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateModel, validateTranscript } from './replay.mjs';
const model = readFileSync(new URL('./model.smt2', import.meta.url));
const transcript = [...model.toString().matchAll(/\(echo "([^"\n]+)"\)/g)].flatMap(([,label]) => [label, label.startsWith('P') ? 'unsat' : 'sat']).join('\n') + '\n';
test('approved model bytes', () => validateModel(model));
test('exact transcript', () => validateTranscript(transcript));
for (const [name, bytes] of [
  ['empty', Buffer.alloc(0)],
  ['appended bytes', Buffer.concat([model, Buffer.from(' ')])],
  ['modified proof', Buffer.from(model.toString().replace('(assert admitted)', '(assert false)'))],
  ['echo-only substitute', Buffer.from(transcript.split('\n').filter(Boolean).map(x => `(echo "${x}")`).join('\n'))],
]) test('reject ' + name, () => assert.throws(() => validateModel(bytes), /unreviewed/));
for (const [name, result] of [
  ['missing', transcript.slice(0,-4)],
  ['extra', transcript+'sat\n'],
  ['unknown', transcript.replace('unsat','unknown')],
  ['bad proof result', transcript.replace('unsat','sat')],
  ['bad mutation result', transcript.replace('\nsat\n','\nunsat\n')],
  ['diagnostic', 'error\n'+transcript],
  ['reordered labels', transcript.replace('P01','P02')],
]) test('reject ' + name, () => assert.throws(() => validateTranscript(result), /incorrect/));
