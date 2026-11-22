#!/usr/bin/env sh
# Exact guest test: requires two independently supplied, executable Oreslang
# source runners. Never silently substitute Python or a JavaScript model.
set -eu
if [ "$#" -ne 2 ]; then
  echo "usage: $0 /absolute/path/to/java-oreslang-runner /absolute/path/to/llvm-oreslang-runner" >&2
  exit 64
fi
java_runner="$1"
llvm_runner="$2"
for candidate in "$java_runner" "$llvm_runner"; do
  if [ ! -x "$candidate" ]; then
    echo "NOT_RUN: missing executable Oreslang runner: $candidate" >&2
    exit 69
  fi
done
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fixture="$repo_root/tests/ipc_receipts_guest.ores"
expected="$repo_root/tests/ipc_receipts_guest.expected"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT HUP INT TERM

# A complete compiler/runtime invocation must terminate successfully and
# produce exactly the expected 18 booleans. A compiler-only IR dump fails.
timeout 90 "$java_runner" "$fixture" > "$workspace/java.stdout"
timeout 90 "$llvm_runner" "$fixture" > "$workspace/llvm.stdout"
if ! cmp -s "$expected" "$workspace/java.stdout"; then
  echo "FAIL: Java guest receipt stdout differs from golden fixture" >&2
  diff -u "$expected" "$workspace/java.stdout" >&2 || true
  exit 1
fi
if ! cmp -s "$expected" "$workspace/llvm.stdout"; then
  echo "FAIL: LLVM native guest receipt stdout differs from golden fixture" >&2
  diff -u "$expected" "$workspace/llvm.stdout" >&2 || true
  exit 1
fi
if ! cmp -s "$workspace/java.stdout" "$workspace/llvm.stdout"; then
  echo "FAIL: source-level Java/LLVM output mismatch" >&2
  exit 1
fi
printf 'GUEST_RECEIPT_REFERENCE_TEST_PASS\n'
printf 'SOURCE_SHA256 '
sha256sum "$repo_root/experiments/ipc_receipts.ores" | awk '{print $1}'
printf 'FIXTURE_SHA256 '
sha256sum "$fixture" | awk '{print $1}'
printf 'JAVA_RUNNER_SHA256 '
sha256sum "$java_runner" | awk '{print $1}'
printf 'LLVM_RUNNER_SHA256 '
sha256sum "$llvm_runner" | awk '{print $1}'
printf 'NOT_A_NETWORK_TRANSPORT_OR_DURABLE_COMMIT_PROOF\n'
