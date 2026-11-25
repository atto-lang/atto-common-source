#!/usr/bin/env node
/** Read-only memory/AOT profile query; never certifies executable support. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BACKENDS = ['java', 'llvm', 'wasm', 'forge', 'net'];

export function queryMemoryProfiles(contract, backend = null) {
  const fail = what => { throw new Error('E_MEMORY_PROFILE: ' + what); };
  if (!contract || contract.schema !== 'atto.aot-memory-isolation.v1' ||
      contract.status !== 'SPECIFICATION_ONLY_NOT_EXECUTED') {
    fail('contract is unsupported or falsely promoted');
  }
  if (backend !== null && !BACKENDS.includes(backend)) fail('unknown backend');
  if (!contract.backend_status || !contract.profiles ||
      BACKENDS.some(b => contract.backend_status[b] !== 'NOT_EXECUTED') ||
      Object.keys(contract.backend_status).length !== BACKENDS.length) {
    fail('backend baseline must remain NOT_EXECUTED');
  }
  const rows = [];
  for (const [id, profile] of Object.entries(contract.profiles).sort(([a], [b]) => a.localeCompare(b))) {
    if (!profile || !BACKENDS.includes(profile.backend) ||
        typeof profile.native_machine_aot !== 'boolean' ||
        typeof profile.runtime_jit !== 'boolean' ||
        !['allowed', 'forbidden', 'profile-dependent', 'managed-or-profile-dependent'].includes(profile.tracing_gc)) {
      fail('malformed target profile: ' + id);
    }
    if (profile.native_machine_aot && profile.runtime_jit) {
      fail('full native AOT profile cannot require a runtime JIT: ' + id);
    }
    if (backend && profile.backend !== backend) continue;
    rows.push({
      id, backend: profile.backend,
      native_machine_aot: profile.native_machine_aot,
      runtime_jit: profile.runtime_jit,
      tracing_gc_policy: profile.tracing_gc,
      selected_gc: profile.selected_gc ?? 'profile-dependent',
      execution_status: 'NOT_EXECUTED'
    });
  }
  if (!rows.length) fail('empty matching profile set');
  return {
    schema: 'atto.memory-profile-query.v1',
    source_contract: contract.schema,
    verification: 'SPECIFICATION_ONLY_NOT_EXECUTED',
    profiles: rows
  };
}

function main(args) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--backend')) {
    console.error('usage: node reference/query-memory-profiles.mjs [--backend java|llvm|wasm|forge|net]');
    return 2;
  }
  try {
    const contract = JSON.parse(readFileSync(new URL('../contracts/aot-memory-isolation-v1.json', import.meta.url), 'utf8'));
    process.stdout.write(JSON.stringify(queryMemoryProfiles(contract, args[1] ?? null), null, 2) + '\n');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
