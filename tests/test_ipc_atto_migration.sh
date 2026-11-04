#!/usr/bin/env sh
# Source-only migration fidelity check: NOT a compiled AttoLang guest.
set -eu
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
legacy_module="$repo_root/experiments/ipc_receipts.ores"
modern_module="$repo_root/experiments/ipc_receipts.atto"
legacy_guest="$repo_root/tests/ipc_receipts_guest.ores"
modern_guest="$repo_root/tests/ipc_receipts_guest.atto"

for file in "$legacy_module" "$modern_module" "$legacy_guest" "$modern_guest"; do
  if [ ! -f "$file" ] || [ -L "$file" ]; then
    echo "NOT_RUN: missing or symlinked IPC migration fixture" >&2
    exit 69
  fi
done
if ! cmp -s "$legacy_module" "$modern_module"; then
  echo "FAIL: canonical .atto module differs from legacy source" >&2
  exit 1
fi
if ! grep -Fqx 'import module ipc_receipts from "../experiments/ipc_receipts.ores";' "$legacy_guest"; then
  echo "FAIL: legacy guest import identity changed" >&2
  exit 1
fi
if ! sed 's|../experiments/ipc_receipts\.ores|../experiments/ipc_receipts.atto|' "$legacy_guest" | cmp -s - "$modern_guest"; then
  echo "FAIL: canonical .atto guest has unreviewed semantic differences" >&2
  exit 1
fi
printf 'IPC_ATTO_SOURCE_MIGRATION_BYTES_MATCH\n'
printf 'NOT_COMPILED_GUEST_OR_NETWORK_TRANSPORT_PROOF\n'
