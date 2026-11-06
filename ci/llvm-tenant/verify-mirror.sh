#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 - <<'PY'
import json
import subprocess
from pathlib import Path
manifest=json.loads(Path("ci/llvm-tenant/mirror-manifest.json").read_text())
for path, sha in manifest["source_blobs"].items():
    actual=subprocess.check_output(["git","hash-object",path],text=True).strip()
    if sha != actual:
        raise SystemExit(f"SOURCE_BLOB_MISMATCH: {path}: {actual} != {sha}")
print("verified_exact_source_blobs=" + str(len(manifest["source_blobs"])))
print("source_commit=" + manifest["origin"]["commit"])
print("scope=native_host_actors_only_no_guest_lowering")
PY

cmake -S tests/tenant-vm -B build/tv-plain -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DWAT2WASM=NOTFOUND -DWASM2C=NOTFOUND
cmake --build build/tv-plain --target tenant_vm_test -j2
TENANT_VM_FUZZ_ROUNDS=80 ctest --test-dir build/tv-plain --output-on-failure -R '^tenant_vm_test$'

cmake -S tests/tenant-vm -B build/tv-asan -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DTENANT_VM_SANITIZE=ON -DWAT2WASM=NOTFOUND -DWASM2C=NOTFOUND
cmake --build build/tv-asan --target tenant_vm_test -j2
for case in \
  equal_offsets_are_different_memory \
  messaging_stays_inside_the_vm \
  authority_is_bound_to_host_and_generation \
  host_can_kill_a_spinning_vm \
  actor_churn_reuses_slots_and_scrubs_memory \
  tenant_recycling_restores_heap_quota_and_fences_aliases \
  shutdown_drains_then_retires
do
  echo "ASAN_UBSAN_CASE=$case"
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 \
    build/tv-asan/tenant_vm_test "$case"
done
echo 'LLVM_NATIVE_HOST_TENANT_ARENA_TESTS=PASSED'
echo 'EVIDENCE_SCOPE=TRUSTED_HOST_NATIVE_ONLY_NOT_EXACT_SOURCE_TREE_GUEST_PARITY_OR_OS_SANDBOX'
