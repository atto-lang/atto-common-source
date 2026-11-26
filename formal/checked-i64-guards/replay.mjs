import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const obligations = [
  'P01 add overflow iff widened result outside range',
  'P02 subtract overflow iff widened result outside range',
  'P03 negation overflow iff operand is minimum',
  'P04 accepted add preserves mathematical result',
  'P05 accepted subtract preserves mathematical result',
  'P06 division error cases disjoint',
  'P07 substituted divisor never invalid even on rejected paths',
  'P08 accepted division retains original divisor',
  'P09 remainder substituted divisor never zero or min over minus one',
  'P10 accepted non-minus-one remainder retains original divisor',
  'M01 mutant add ignores overflow',
  'M02 mutant subtract uses addition predicate',
  'M03 mutant division substitutes only zero',
  'M04 mutant division substitutes only overflow',
  'M05 mutant remainder substitutes only minus one',
  'R01 valid division reachable',
  'R02 zero division reachable',
  'R03 overflow division reachable',
];
const expected = obligations.flatMap(label => [label, label.startsWith('P') ? 'unsat' : 'sat']).join('\n') + '\n';
export function validateTranscript(output) {
  if (output !== expected) throw new Error('missing, extra, reordered or incorrect solver result');
}
export function validateModel(bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== '460ffe9878ea2fc84e207592fae72f6c0f6b1d455dd5a65e6370daeda25c53cd') {
    throw new Error('unreviewed SMT model bytes');
  }
}
function run(solver, args, input) {
  const r = spawnSync(solver, args, { input, encoding: 'utf8', timeout: 200000, maxBuffer: 65536 });
  if (r.error || r.status !== 0 || r.signal || r.stderr !== '') throw new Error('solver execution failed');
  return r.stdout;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const solver = process.argv[2] ?? 'z3';
  const model = process.argv[3] ?? fileURLToPath(new URL('./model.smt2', import.meta.url));
  const bytes = readFileSync(model);
  validateModel(bytes);
  const version = run(solver, ['-version']);
  if (!/^Z3 version 4\.13\.3(?:\.0)?(?: - [^\r\n]+)?\r?\n$/.test(version)) throw new Error('expected Z3 version 4.13.3');
  const output = run(solver, ['-in', '-smt2'], bytes);
  validateTranscript(output);
  process.stdout.write(version + output + 'MODEL_PROVED: 10 UNSAT, 5 mutant SAT, 3 reachability SAT\n');
}
