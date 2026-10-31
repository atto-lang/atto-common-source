#!/usr/bin/env node
// Byte-for-byte source corpus comparison across independently obtained,
// authorized local checkouts. No network, no GitHub tokens, no compiler.
// This is SOURCE IDENTITY evidence only, never proof of guest execution.
import {readFileSync, openSync, closeSync, fstatSync, constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateContract} from './materialize-namespace-guest-case.mjs';

const stringLiteral = String.raw`"(?:\\.|[^"\\])*"`;
const esc = stringLiteral;
const javaPattern = new RegExp(
  'sources\\.put\\(('+esc+'),\\s*('+esc+')\\);\\s*' +
  'owners\\.put\\(('+esc+'),\\s*('+esc+')\\);', 'g');
const cppPattern = new RegExp(
  '\\{\\s*('+esc+'),\\s*('+esc+'),\\s*('+esc+')\\s*\\}', 'g');

function fail(message) { throw Error('NAMESPACE_SOURCE_IDENTITY_REJECTED: '+message); }
function decode(raw) {
  try { return JSON.parse(raw); }
  catch { fail('noncanonical serialized Java/C++ ASCII string literal'); }
}
function segment(text, start, end) {
  const from = text.indexOf(start);
  const to = from === -1 ? -1 : text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) fail('missing or ambiguous fixture source section');
  if (text.indexOf(start, from + start.length) !== -1) fail('duplicate fixture source section');
  return text.slice(from + start.length, to);
}

export function javaCorpus(text) {
  const block = segment(text, 'private static Corpus sourceCorpus() {',
    'return new Corpus(sources, owners);');
  const sources = [];
  for (const match of block.matchAll(javaPattern)) {
    const [path, source, ownerPath, owner] = match.slice(1).map(decode);
    if (path !== ownerPath) fail('Java source ownership path disagrees');
    sources.push({path, content: source, package_instance_id: owner});
  }
  if ((block.match(/sources\.put\(/g) ?? []).length !== sources.length ||
      (block.match(/owners\.put\(/g) ?? []).length !== sources.length)
    fail('unparsed Java source/owner binding');
  return sources;
}

export function llvmCorpus(text) {
  const block = segment(text, 'input.sources = {', '};\n    return input;');
  const sources = [];
  for (const match of block.matchAll(cppPattern)) {
    const [path, owner, source] = match.slice(1).map(decode);
    sources.push({path, content: source, package_instance_id: owner});
  }
  if ((block.match(/\{\s*"/g) ?? []).length !== sources.length)
    fail('unparsed LLVM pinned source binding');
  return sources;
}

export function verifyBackendSourceIdentity(contract, javaText, llvmText) {
  validateContract(contract);
  const expected = new Map(contract.sources.map(s => [s.path, s]));
  for (const [backend, observed] of [
    ['java', javaCorpus(javaText)], ['llvm', llvmCorpus(llvmText)]
  ]) {
    if (observed.length !== expected.size)
      fail(backend+' inventory count mismatch: '+observed.length);
    const seen = new Set();
    for (const unit of observed) {
      const expectedUnit = expected.get(unit.path);
      if (!expectedUnit || seen.has(unit.path) ||
          unit.content !== expectedUnit.content ||
          unit.package_instance_id !== expectedUnit.package_instance_id)
        fail(backend+' source identity or bytes drift: '+unit.path);
      seen.add(unit.path);
    }
  }
  return {java:expected.size, llvm:expected.size,
    evidence:'SOURCE_IDENTITY_ONLY_NOT_COMPILER_OR_GUEST'};
}

function readPinnedRegularFile(path) {
  if (typeof path !== 'string' || !path || path.includes('\0'))
    fail('missing or invalid local fixture filename');
  if (!Number.isInteger(constants.O_NOFOLLOW) ||
      !Number.isInteger(constants.O_NONBLOCK))
    fail('local no-follow input support unavailable');
  const fd = openSync(path, constants.O_RDONLY|constants.O_NOFOLLOW|
    constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > 256*1024)
      fail('backend fixture is not a bounded regular file');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== before.size || after.size !== before.size ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs)
      fail('local fixture changed during read');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally { closeSync(fd); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      fail('usage: node tools/compare-namespace-backend-corpus.mjs <java-local-test-file> <llvm-local-test-file>');
    const contract = JSON.parse(readFileSync(
      new URL('../contracts/conformance/namespace-guest-gates-v1.json',
        import.meta.url),'utf8'));
    const result = verifyBackendSourceIdentity(contract,
      readPinnedRegularFile(process.argv[2]),
      readPinnedRegularFile(process.argv[3]));
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    process.stderr.write(String(error.message)+'\n');
    process.exitCode=1;
  }
}
