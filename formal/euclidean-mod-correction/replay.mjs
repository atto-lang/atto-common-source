import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const labels = [
  'P01 correction agrees with widened reference',
  'P02 result is nonnegative and below divisor magnitude',
  'P03 nonnegative remainder unchanged',
  'P04 negative remainder corrected by exactly one divisor magnitude',
  'P05 unit divisor requires zero remainder and modulus',
  'M01 uncorrected negative remainder violates range',
  'M02 always add divisor disagrees for negative divisor',
  'M03 signed abs of minimum cannot represent magnitude',
  'R01 minimum divisor with negative remainder reachable',
  'R02 positive divisor with negative remainder reachable',
];
const expected = labels.flatMap(label => [label, label.startsWith('P') ? 'unsat' : 'sat']).join('\n') + '\n';
export function validateModel(bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== '5c90b4f65e3f012dcea8b5e8fe67b6eabae6d9a2ac2d30f872ed4605263643d0') {
    throw new Error('unreviewed SMT model bytes');
  }
}
export function validateTranscript(output) {
  if (output !== expected) throw new Error('incorrect solver transcript');
}
function run(solver, args, input) {
  const p = spawnSync(solver, args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 65536 });
  if (p.error || p.status !== 0 || p.signal || p.stderr !== '') throw new Error('solver execution failed');
  return p.stdout;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: node replay.mjs /path/to/trusted/z3');
  const bytes = readFileSync(new URL('./model.smt2', import.meta.url));
  validateModel(bytes);
  const solver = process.argv[2];
  const version = run(solver, ['-version']);
  if (!/^Z3 version 4\.13\.3(?:\.0)?(?: - [^\r\n]+)?\r?\n$/.test(version)) throw new Error('expected Z3 4.13.3');
  const output = run(solver, ['-in', '-smt2'], bytes);
  validateTranscript(output);
  process.stdout.write(version + output + 'MODEL_PROVED: 5 UNSAT, 3 mutation SAT, 2 reachability SAT\n');
}
