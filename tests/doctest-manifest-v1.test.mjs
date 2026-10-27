import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractDoctests} from '../tools/doctest-manifest.mjs';

const fence = String.fromCharCode(96).repeat(3);
const block = (header, source, end = true) => [fence + header, source, ...(end ? [fence] : [])].join('\n');

test('illustrative Oreslang source without explicit doctest opt-in is not promoted', () => {
  const data = extractDoctests(block('oreslang', 'fnc foo() -> int\n return 5;\nend'));
  assert.equal(data.entries.length, 0);
  assert.equal(data.status, 'EXTRACTED_NOT_COMPILED');
  assert.equal(data.binary_evidence, false);
});

test('opted-in compile, run, reject examples are accurately extracted with SHA and lines', () => {
  const text = ['Title', '',
    block('oreslang doctest:compile id=first_case', 'return 42;'), '',
    block('ores doctest:run id=second_case', 'return 7;'), '',
    block('oreslang doctest:reject id=third_case', 'unsafe_io()')
  ].join('\n');
  const data = extractDoctests(text, 'docs/example.md');
  assert.deepEqual(data.entries.map(x => [x.id,x.kind,x.source_line]),
    [['first_case','compile',4],['second_case','run',8],['third_case','reject',12]]);
  assert.equal(data.entries[0].source_sha256,
    createHash('sha256').update('return 42;\n').digest('hex'));
  assert.equal(data.entries[0].source, 'return 42;\n');
  assert.equal(data.document, 'docs/example.md');
});

test('rejects duplicate doctest identity', () => {
  const markdown = block('oreslang doctest:run id=dup', 'a;') + '\n' +
    block('oreslang doctest:reject id=dup', 'b;');
  assert.throws(() => extractDoctests(markdown), /duplicate doctest id/);
});

test('malformed directives and other language markers do not bypass fail-closed checking', () => {
  assert.throws(() => extractDoctests(block('oreslang doctest:run id=Bad', 'x')), /malformed/);
  assert.throws(() => extractDoctests(block('javascript doctest:run id=bad', 'alert(1)')), /malformed/);
  assert.throws(() => extractDoctests(block('oreslang doctest:execute id=bad', 'x')), /malformed/);
});

test('empty, unterminated, or malformed source fences reject', () => {
  assert.throws(() => extractDoctests(block('oreslang doctest:compile id=empty', '  ')), /empty doctest/);
  assert.throws(() => extractDoctests(block('oreslang doctest:run id=unterminated', 'x', false)), /unclosed/);
  assert.throws(() => extractDoctests(block('oreslang', 'x', false)), /unclosed/);
});

test('scanner never claims guest compiled execution', () => {
  for (const kind of ['compile','run','reject']) {
    const manifest = extractDoctests(block('oreslang doctest:' + kind + ' id=example', 'x;'));
    assert.equal(manifest.status, 'EXTRACTED_NOT_COMPILED');
    assert.equal(manifest.binary_evidence, false);
    assert.equal(manifest.entries.length, 1);
  }
});
