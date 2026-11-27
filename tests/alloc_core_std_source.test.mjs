import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { elaborateQuantityDeclarations, evaluateQuantityMain } from '../reference/verified-core/quantities.mjs';
import { constrain, checkedRefinement, full, signedI32 } from '../reference/verified-core/intervals.mjs';

// Source-level only: these checks do NOT parse/compile/link/execute .atto.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('contracts/canonical-stdlib-v1.json'));
const sourcePaths = [
  'stdlib/alloc/byte_region.atto',
  'stdlib/core/byte_bounds.atto',
  'stdlib/core/identity.atto',
  'stdlib/core/measure.atto',
  'stdlib/core/size_math.atto',
  'stdlib/core/u32_endian.atto',
  'stdlib/std/buffer.atto',
  'stdlib/std/byte_ops.atto'
];
const core = read('stdlib/core/size_math.atto');
const alloc = read('stdlib/alloc/byte_region.atto');
const std = read('stdlib/std/byte_ops.atto');

test('all canonical Atto sources are pinned by exact bytes and layer inventory', () => {
  assert.deepEqual(manifest.sources.map(s => s.path), sourcePaths);
  for (const entry of manifest.sources) {
    const bytes = Buffer.from(read(entry.path), 'utf8');
    assert.equal(bytes.byteLength, entry.bytes, entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
  assert.equal(manifest.status, 'CANDIDATE_NOT_COMPILED');
  assert.ok(manifest.targets.every(x => x.execution === 'NOT_EXECUTED'));
});

test('layer DAG is core -> alloc -> std only; no ambient host capabilities', () => {
  for (const path of sourcePaths) {
    const text = read(path);
    const layer = path.split('/')[1];
    const imports = [...text.matchAll(/^import module [a-z_]+ from "(stdlib\/[^"]+)";$/gm)].map(m=>m[1]);
    assert.equal((text.match(/^import module /gm) || []).length, imports.length, path);
    for (const dep of imports) {
      assert.ok(sourcePaths.includes(dep), path + ' missing import ' + dep);
      const target = dep.split('/')[1];
      if (layer === 'core') assert.fail('core must not import: ' + dep);
      if (layer === 'alloc') assert.equal(target, 'core');
      if (layer === 'std') assert.ok(target === 'alloc' || target === 'core' || target === 'std');
    }
    assert.doesNotMatch(text, /\b(?:stdio|process|socket|syscall|ffi)\s*\./);
  }
});
test('freestanding size helpers reject signed inputs before subtract/divide', () => {
  assert.match(core, /if a < 0 \|\| b < 0 \|\| limit < 0 then return false; fi/g);
  assert.match(core, /return b <= limit - a;/);
  assert.match(core, /return a <= limit \/ b;/);
  assert.doesNotMatch(core, /\b(?:new|alloc|await|spawn)\b/);
});
test('alloc ByteRegion is sealed-backed, checks bounds and requires mutable receiver', () => {
  assert.match(alloc, /private let mut OwnedBytes storage = OwnedBytes\.empty\(\);/);
  assert.match(alloc, /OwnedBytes\.allocate_zeroed\(count\)/);
  assert.match(alloc, /pub static fnc empty\(\): ByteRegion/);
  assert.match(alloc, /pub mtd \(mut self: ByteRegion\) write_byte/);
  assert.match(alloc, /bounds\.byte_range_valid/);
  assert.match(alloc, /bounds\.byte_u8_valid/);
  assert.doesNotMatch(alloc, /\b(?:Pointer|malloc|free|Unsafe)\b/);
});
test('std byte equality builds on alloc without host I/O', () => {
  assert.match(std, /import module alloc_bytes from "stdlib\/alloc\/byte_region.atto";/);
  assert.match(std, /pub fnc bytes_equal/);
  assert.match(std, /left\.read_byte\(index\) != right\.read_byte\(index\)/);
});

test('measurement source declarations elaborate in the existing host reference oracle', () => {
  const declarations = [], aliases = new Map();
  for (const line of read('stdlib/core/measure.atto').split('\n')) {
    if (!line || line.startsWith('//')) continue;
    let m;
    if ((m = /^define dimension (\w+);$/.exec(line))) {
      declarations.push({kind:'dimension', name:m[1]});
    } else if ((m = /^define unit (\w+): (\w+)(?: = (\w+) ([*/]) (\d+))?;$/.exec(line))) {
      declarations.push({kind:'unit', name:m[1], dimension:m[2],
        ...(m[3] ? {relativeTo:m[3], divide:m[4]==='/', factor:m[5]} : {})});
    } else if ((m = /^type (\w+) = (int|i32) where self (>=|<=|>|<) 0;$/.exec(line))) {
      assert.ok(!aliases.has(m[1]));
      aliases.set(m[1], constrain(m[2]==='int'?full:signedI32,m[3],0n));
    } else assert.fail('unknown catalog declaration: '+line);
  }
  const u = elaborateQuantityDeclarations(declarations);
  const scales = [['Centimeter','Meter',1n,100n],['Millis','Second',1n,1000n],
    ['Micros','Second',1n,1000000n],['Nanos','Second',1n,1000000000n],
    ['Gram','Kilogram',1n,1000n],['Byte','Bit',8n,1n],
    ['Kilobyte','Byte',1000n,1n],['Kibibyte','Byte',1024n,1n],
    ['Hour','Second',3600n,1n],['Day','Second',86400n,1n]];
  assert.equal(declarations.filter(d=>d.kind==='dimension').length,8);
  for (const [from,to,n,d] of scales) {
    const a=u.get(from), b=u.get(to);
    assert.deepEqual(a.powers,b.powers);
    assert.equal(a.n*b.d*d,b.n*a.d*n);
  }
  const lit=(value,unit)=>({op:'literal',value,unit});
  const div=(left,right)=>({op:'divide',left,right});
  const convert=(value,unit)=>({op:'convert',value,unit});
  assert.equal(evaluateQuantityMain(declarations,div(convert(lit('4200','Centimeter'),'Meter'),lit('1','Meter'))),42n);
  assert.throws(()=>evaluateQuantityMain(declarations,convert(lit('1','Centimeter'),'Meter')),{code:'E_UNIT_INEXACT'});
  assert.throws(()=>evaluateQuantityMain(declarations,{op:'add',left:lit('1','Meter'),right:lit('1','Second')}),{code:'E_UNIT_DIMENSION'});
  assert.throws(()=>evaluateQuantityMain(declarations,{op:'add',left:lit('1','Meter'),right:lit('1','Centimeter')}),{code:'E_UNIT_SCALE'});
  assert.equal(aliases.size,8);
  for (const [suffix,carrier] of [['Int',full],['I32',signedI32]]) {
    const [min,max]=carrier;
    for (const [name,accepted,rejected] of [
      ['Positive',[1n,max],[0n,-1n]],
      ['Negative',[-1n,min],[0n,1n]],
      ['NonNegative',[0n,max],[-1n]],
      ['NonPositive',[0n,min],[1n]]
    ]) {
      const bounds=aliases.get(name+suffix);
      for (const v of accepted) assert.equal(checkedRefinement(bounds,v),v);
      for (const v of [...rejected,min-1n,max+1n]) assert.throws(()=>checkedRefinement(bounds,v),/E_REFINEMENT_CHECK_FAILED/);
    }
  }
});

test('measurement catalog: every declared linear scale and dimension is independently pinned', () => {
  // Independent expected inventory, not derived from the declaration under test.
  const expected = new Map(Object.entries({
    Meter:['Length',1n,1n], Millimeter:['Length',1n,1000n], Centimeter:['Length',1n,100n],
    Kilometer:['Length',1000n,1n], Micrometer:['Length',1n,1000000n], Nanometer:['Length',1n,1000000000n],
    Second:['Time',1n,1n], Millis:['Time',1n,1000n], Micros:['Time',1n,1000000n], Nanos:['Time',1n,1000000000n],
    Minute:['Time',60n,1n], Hour:['Time',3600n,1n], Day:['Time',86400n,1n],
    Kilogram:['Mass',1n,1n], Gram:['Mass',1n,1000n], Milligram:['Mass',1n,1000000n],
    Ampere:['ElectricCurrent',1n,1n], Milliampere:['ElectricCurrent',1n,1000n],
    Kelvin:['Temperature',1n,1n], Mole:['AmountOfSubstance',1n,1n], Candela:['LuminousIntensity',1n,1n],
    Bit:['Information',1n,1n], Byte:['Information',8n,1n],
    Kilobyte:['Information',8000n,1n], Megabyte:['Information',8000000n,1n], Gigabyte:['Information',8000000000n,1n],
    Kibibyte:['Information',8192n,1n], Mebibyte:['Information',8388608n,1n], Gibibyte:['Information',8589934592n,1n],
  }));
  const declarations=[];
  for (const line of read('stdlib/core/measure.atto').split('\n')) {
    let m;
    if ((m=/^define dimension (\w+);$/.exec(line))) declarations.push({kind:'dimension',name:m[1]});
    else if ((m=/^define unit (\w+): (\w+)(?: = (\w+) ([*/]) (\d+))?;$/.exec(line))) {
      declarations.push({kind:'unit',name:m[1],dimension:m[2],...(m[3]?{relativeTo:m[3],divide:m[4]==='/',factor:m[5]}:{})});
    } else if (line.startsWith('define ')) assert.fail('unrecognized measure declaration: '+line);
  }
  const actual=elaborateQuantityDeclarations(declarations);
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [name,[dimension,n,d]] of expected) {
    const unit=actual.get(name);
    assert.deepEqual(unit.powers,[[dimension,1]],name);
    assert.equal(unit.n,n,name);
    assert.equal(unit.d,d,name);
  }
  const lit=(value,unit)=>({op:'literal',value,unit});
  const cv=(value,unit)=>({op:'convert',value,unit});
  const div=(left,right)=>({op:'divide',left,right});
  const run=expr=>evaluateQuantityMain(declarations,expr);
  assert.equal(run(div(cv(lit('-100','Centimeter'),'Meter'),lit('1','Meter'))),-1n);
  assert.equal(run(div(cv(lit('1000','Millis'),'Second'),lit('1','Second'))),1n);
  assert.equal(run(div(cv(lit('1','Kibibyte'),'Byte'),lit('1','Byte'))),1024n);
  assert.equal(run(div(cv(lit('1','Kilobyte'),'Byte'),lit('1','Byte'))),1000n);
  assert.throws(()=>run(cv(lit('1','Bit'),'Byte')),{code:'E_UNIT_INEXACT'});
  assert.throws(()=>run(cv(lit('9223372036854775807','Byte'),'Bit')),{code:'E_UNIT_RANGE'});
  assert.throws(()=>run(cv(lit('-9223372036854775808','Byte'),'Bit')),{code:'E_UNIT_RANGE'});
  assert.throws(()=>run(div(lit('1','Second'),lit('1','Millis'))),{code:'E_UNIT_ERASURE'});
  assert.throws(()=>run(div(lit('1','Meter'),lit('0','Meter'))),{code:'E_I64_DIV_ZERO'});
  assert.throws(()=>run(div(lit('-9223372036854775808','Meter'),lit('-1','Meter'))),{code:'E_I64_OVERFLOW'});
  assert.throws(()=>run(cv(lit('1','Second'),'Meter')),{code:'E_UNIT_DIMENSION'});
});

test('unit declaration admission fails closed on duplicate, unknown, nonpositive and oversized declarations', () => {
  const base=[{kind:'dimension',name:'Length'},{kind:'unit',name:'Meter',dimension:'Length'}];
  const derived=(name,relativeTo,factor)=>({kind:'unit',name,dimension:'Length',relativeTo,factor});
  const rejects=(d,code)=>assert.throws(()=>elaborateQuantityDeclarations(d),{code});
  rejects([...base,{kind:'dimension',name:'Meter'}],'E_UNIT_DUPLICATE');
  rejects([...base,{kind:'unit',name:'OtherBase',dimension:'Length'}],'E_UNIT_DUPLICATE');
  rejects([...base,derived('Cycle','Cycle','1')],'E_UNIT_NAME');
  rejects([...base,derived('Missing','MissingBase','1')],'E_UNIT_NAME');
  rejects([...base,derived('Zero','Meter','0')],'E_UNIT_SCALE');
  rejects([...base,derived('Negative','Meter','-1')],'E_UNIT_SCALE');
  rejects([...base,derived('Wide','Meter','9223372036854775808')],'E_UNIT_SCALE');
  const many=Array.from({length:129},(_,i)=>({kind:'dimension',name:'D'+i}));
  rejects(many,'E_UNIT_LIMIT');
  const long=[...base];
  let previous='Meter';
  for(let i=0;i<5;i++) {
    const name='Wide'+i;
    long.push(derived(name,previous,'9223372036854775807'));
    previous=name;
  }
  rejects(long,'E_UNIT_LIMIT');
});
