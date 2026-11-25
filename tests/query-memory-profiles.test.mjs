import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { queryMemoryProfiles } from '../reference/query-memory-profiles.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/aot-memory-isolation-v1.json', import.meta.url)));
const clone = () => structuredClone(contract);

test('query exposes all seven backend profiles but no execution claims', () => {
  const result = queryMemoryProfiles(contract);
  assert.equal(result.verification, 'SPECIFICATION_ONLY_NOT_EXECUTED');
  assert.equal(result.profiles.length, Object.keys(contract.profiles).length);
  assert.ok(result.profiles.every(x => x.execution_status === 'NOT_EXECUTED'));
  assert.equal(new Set(result.profiles.map(x => x.id)).size, result.profiles.length);
});

test('profiles keep native AOT, JVM JIT and Epsilon distinctions', () => {
  const java = queryMemoryProfiles(contract, 'java').profiles;
  assert.equal(java.length, 3);
  const jvm = java.find(x => x.id === 'java-jvm-low-gc');
  assert.equal(jvm.native_machine_aot, false);
  assert.equal(jvm.runtime_jit, true);
  const epsilon = java.find(x => x.id === 'graal-native-epsilon-aot');
  assert.equal(epsilon.native_machine_aot, true);
  assert.equal(epsilon.runtime_jit, false);
  assert.equal(epsilon.selected_gc, 'epsilon');
  assert.equal(epsilon.execution_status, 'NOT_EXECUTED');
  assert.equal(queryMemoryProfiles(contract, 'llvm').profiles.length, 1);
  assert.throws(() => queryMemoryProfiles(contract, 'unsupported'), /unknown backend/);
});

test('promoted status, unknown GC policy and impossible AOT/JIT combination fail closed', () => {
  for (const mutate of [
    x => { x.status = 'PASSED'; },
    x => { x.backend_status.java = 'PASSED'; },
    x => { x.profiles['llvm-native-aot'].tracing_gc = 'magic'; },
    x => { x.profiles['llvm-native-aot'].runtime_jit = true; }
  ]) {
    const x = clone();
    mutate(x);
    assert.throws(() => queryMemoryProfiles(x), /E_MEMORY_PROFILE/);
  }
});

test('read-only CLI emits JSON and rejects bad arguments', () => {
  const script = new URL('../reference/query-memory-profiles.mjs', import.meta.url).pathname;
  const ok = spawnSync(process.execPath, [script, '--backend', 'net'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(JSON.parse(ok.stdout).profiles.every(x => x.backend === 'net'));
  const unknown = spawnSync(process.execPath, [script, '--backend', 'fake'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, '');
  const usage = spawnSync(process.execPath, [script, '--claims'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
