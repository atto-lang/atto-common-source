import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const signatures = load('contracts/v1/core-protocol-signatures-v1.json');
const inventory = load('contracts/v1/core-protocols-v1.json');
const source = readFileSync(new URL('library/ores.core/protocols.atto', root), 'utf8');
const normalize = value => value.replace(/\s+/g, '');

function parseDeclarations(input) {
  // Fail closed on unexpected source forms: this is a source-contract lexer,
  // not a substitute for the real Atto compiler or a full language parser.
  const lines = input.replace(/\/\/[^\r\n]*/g, '').split(/\r?\n/);
  const declarations = {};
  let current = null;
  let moduleOpen = false;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (!current && line === 'define module protocols as' && !moduleOpen) {
      moduleOpen = true;
      continue;
    }
    if (!current && line === 'end' && moduleOpen) {
      moduleOpen = false;
      continue;
    }
    if (!moduleOpen) throw new Error('unexpected text outside module: ' + line);
    if (current === null) {
      const decl = /^define pub trait ([A-Za-z]\w*)(?:<([^>]+)>)?(?: extends (.+?))? as$/.exec(line);
      if (!decl) throw new Error('unexpected trait declaration: ' + line);
      if (Object.hasOwn(declarations, decl[1])) throw new Error('duplicate trait: ' + decl[1]);
      current = {
        name: decl[1],
        params: decl[2] ? decl[2].split(',').map(x => x.trim()) : [],
        parents: decl[3] ? decl[3].split(/,(?![^<]*>)/).map(x => x.trim()) : [],
        methods: []
      };
      continue;
    }
    if (line === 'end') {
      declarations[current.name] = {
        params: current.params,
        parents: current.parents,
        methods: current.methods
      };
      current = null;
      continue;
    }
    const method = /^fnc ([a-z_]\w*)\((.*)\)\s*=>\s*(.+);$/.exec(line);
    if (!method) throw new Error('unrecognized trait member: ' + line);
    current.methods.push(method[1] + '(' + method[2] + ') => ' + method[3]);
  }
  if (current || moduleOpen) throw new Error('unclosed trait or module');
  return declarations;
}

function verify(input, model = signatures) {
  assert.equal(model.schema, 'attolang.core-protocol-signatures.v1');
  assert.equal(model.status, 'SOURCE_ONLY_COMPILER_GUEST_EXECUTION_NOT_CERTIFIED');
  const parsed = parseDeclarations(input);
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(model.traits).sort());
  assert.deepEqual(Object.keys(model.traits).sort(), Object.keys(inventory.traits).sort());
  for (const [name, declared] of Object.entries(parsed)) {
    const specification = model.traits[name];
    assert.deepEqual(declared.params, specification.params, 'generic parameters: ' + name);
    assert.deepEqual(declared.parents.map(normalize), specification.parents.map(normalize),
      'inherited contracts: ' + name);
    assert.deepEqual(declared.methods.map(normalize).sort(),
      specification.methods.map(normalize).sort(), 'method signatures: ' + name);
    assert.equal(declared.params.length, inventory.traits[name].arity, name);
    assert.deepEqual(declared.methods.map(x => x.slice(0, x.indexOf('('))).sort(),
      [...inventory.traits[name].methods].sort(), name);
  }
  assert.ok(Object.values(model.backend_evidence).every(v => v === 'NOT_EXECUTED_THIS_CHANGE'));
}

test('all 19 traits have immutable generic and exact parameter/return signature contracts', () => {
  verify(source);
});

test('16 signature, inheritance and authority mutations cannot silently change core APIs', () => {
  const variants = [
    ['equals(T other)', 'equals(int other)'],
    ['compare(T other) => int', 'compare(T other) => bool'],
    ['hash_value() => int', 'hash_value() => bool'],
    ['clone_value() => T', 'clone_value() => int'],
    ['Result<Option<Array<u8>>, E>', 'Result<Array<u8>, E>'],
    ['write_all_async(Array<u8> bytes) => Future<Result<void, E>>',
      'write_all_async(Array<u8> bytes) => Future<Result<int, E>>'],
    ['close() => void', 'close() => bool'],
    ['seek_async(int absolute_offset)', 'seek_async(String absolute_offset)'],
    ['next_async() => Future<Result<Option<T>, E>>',
      'next_async() => Future<Result<T, E>>'],
    ['send_async(T value) => Future<Result<void, E>>',
      'send_async(T value) => Result<void, E>'],
    ['call_async(Request request)', 'call_async(Reply request)'],
    ['try_from(Src value) => Result<Dst, E>', 'try_from(Src value) => Result<Src, E>'],
    ['ReadWrite<E> extends Read<E>, Write<E>', 'ReadWrite<E> extends Read<E>'],
    ['Transform<I, O, E> extends Sink<I, E>, Source<O, E>',
      'Transform<I, O, E> extends Sink<I, E>, Source<I, E>'],
    ['send_batch_async(Array<T> values)', 'send_batch_async(Array<int> values)'],
    ['put_async(K key, V value)', 'put_async(K key, K value)']
  ];
  assert.equal(variants.length, 16);
  for (const [index, [from, to]] of variants.entries()) {
    assert.ok(source.includes(from), 'source precondition ' + index);
    assert.throws(() => verify(source.replace(from, to)), 'signature mutant ' + index);
  }
});

test('unparsed, duplicate and comment-forged declarations reject', () => {
  const injected = source.replace(
    'define pub trait Eq<T> as',
    'define pub trait Eq<T> as\n    fnc injected() => bool;'
  );
  assert.throws(() => verify(injected));
  assert.throws(() => verify(source.replace(
    'define pub trait Eq<T> as',
    'define pub trait Eq<T> as\n  end\n  define pub trait Eq<T> as'
  )));
  assert.throws(() => verify(source.replace(
    'fnc equals(T other) => bool;',
    '// fnc equals(T other) => bool;'
  )));
  assert.throws(() => verify(source.replace(
    'fnc compare(T other) => int;',
    'fnc compare(T other): int;'
  )));
  const falsified = structuredClone(signatures);
  falsified.backend_evidence.llvm = 'PASSED';
  assert.throws(() => verify(source, falsified));
});
