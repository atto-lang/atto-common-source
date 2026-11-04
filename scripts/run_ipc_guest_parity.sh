#!/usr/bin/env sh
# Two-compiler guest reference check, not an authenticated proof of transport
# semantics or independently trusted compiler provenance.
set -eu
umask 077
if [ "$#" -ne 2 ]; then
  echo "usage: $0 /absolute/path/to/java-oreslang-runner /absolute/path/to/llvm-oreslang-runner" >&2
  exit 64
fi
java_runner="$1"
llvm_runner="$2"
for candidate in "$java_runner" "$llvm_runner"; do
  case "$candidate" in
    /*) ;;
    *) echo "NOT_RUN: runner path must be absolute" >&2; exit 64 ;;
  esac
  if [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then
    echo "NOT_RUN: missing regular executable Oreslang runner: $candidate" >&2
    exit 69
  fi
done
# A byte-identical runner cannot independently establish two compiler paths.
# Distinct binaries alone do NOT authenticate a genuine compiler.
if cmp -s "$java_runner" "$llvm_runner"; then
  echo "NOT_RUN: Java/LLVM runners are byte-identical" >&2
  exit 69
fi
command -v timeout >/dev/null 2>&1 || {
  echo "NOT_RUN: timeout command required" >&2; exit 69;
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "NOT_RUN: sha256sum required" >&2; exit 69;
}
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source="$repo_root/experiments/ipc_receipts.ores"
fixture="$repo_root/tests/ipc_receipts_guest.ores"
invalid="$repo_root/tests/ipc_receipts_reject.atto"
expected="$repo_root/tests/ipc_receipts_guest.expected"
for item in "$source" "$fixture" "$invalid" "$expected"; do
  if [ ! -f "$item" ] || [ -L "$item" ]; then
    echo "NOT_RUN: missing or linked guest fixture: $item" >&2
    exit 69
  fi
done
sha_file() { sha256sum "$1" | awk '{print $1}'; }
source_sha="$(sha_file "$source")"
fixture_sha="$(sha_file "$fixture")"
invalid_sha="$(sha_file "$invalid")"
expected_sha="$(sha_file "$expected")"
java_sha="$(sha_file "$java_runner")"
llvm_sha="$(sha_file "$llvm_runner")"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT HUP INT TERM

# Positive control: real source must execute successfully with byte-exact
# output and no extra diagnostics; a compiler-only IR dump is not a pass.
timeout 90 "$java_runner" "$fixture" > "$workspace/java.stdout" 2> "$workspace/java.stderr"
timeout 90 "$llvm_runner" "$fixture" > "$workspace/llvm.stdout" 2> "$workspace/llvm.stderr"
for backend in java llvm; do
  if [ -s "$workspace/$backend.stderr" ]; then
    echo "FAIL: $backend runner emitted unexpected positive stderr" >&2
    exit 1
  fi
  if ! cmp -s "$expected" "$workspace/$backend.stdout"; then
    echo "FAIL: $backend guest stdout differs from golden fixture" >&2
    diff -u "$expected" "$workspace/$backend.stdout" >&2 || true
    exit 1
  fi
done

# Negative control: an always-accepting fake runner must NOT pass by printing
# the hard-coded 18-line expected answer for every input. The malformed guest
# must be rejected with bounded, nonempty diagnostic and without stdout.
for backend in java llvm; do
  if [ "$backend" = java ]; then runner="$java_runner"; else runner="$llvm_runner"; fi
  set +e
  timeout 30 "$runner" "$invalid" > "$workspace/$backend.negative.stdout" 2> "$workspace/$backend.negative.stderr"
  status=$?
  set -e
  diagnostic_size="$(wc -c < "$workspace/$backend.negative.stderr")"
  if [ "$status" -eq 0 ] || [ "$status" -ge 124 ] ||
     [ -s "$workspace/$backend.negative.stdout" ] ||
     [ "$diagnostic_size" -eq 0 ] || [ "$diagnostic_size" -gt 4096 ]; then
    echo "FAIL: $backend did not reject the invalid source as a bounded compiler failure (exit=$status)" >&2
    exit 1
  fi
done

# Confirm no program or runner input changed while checks were in progress.
for spec in "$source:$source_sha" "$fixture:$fixture_sha" "$invalid:$invalid_sha" "$expected:$expected_sha" "$java_runner:$java_sha" "$llvm_runner:$llvm_sha"; do
  path="${spec%:*}"
  digest="${spec##*:}"
  if [ "$(sha_file "$path")" != "$digest" ]; then
    echo "FAIL: source, fixture or runner changed during validation" >&2
    exit 1
  fi
done
printf 'GUEST_RECEIPT_REFERENCE_TEST_PASS\n'
printf 'SOURCE_SHA256 %s\n' "$source_sha"
printf 'FIXTURE_SHA256 %s\n' "$fixture_sha"
printf 'INVALID_FIXTURE_SHA256 %s\n' "$invalid_sha"
printf 'JAVA_RUNNER_SHA256 %s\n' "$java_sha"
printf 'LLVM_RUNNER_SHA256 %s\n' "$llvm_sha"
printf 'NOT_A_NETWORK_TRANSPORT_OR_DURABLE_COMMIT_PROOF\n'
