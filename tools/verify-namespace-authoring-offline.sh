#!/usr/bin/env bash
# Local-authorized checkout proof. No network, no tokens, no Oreslang guest.
set -Eeuo pipefail

expected_head="${1:-}"
if [[ ! "$expected_head" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'NAMESPACE_AUTHORING_REJECTED: pass exact 40-hex Git HEAD as argument' >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"
actual_head="$(git rev-parse HEAD)"
actual_tree="$(git rev-parse 'HEAD^{tree}')"
if [[ "$actual_head" != "$expected_head" ]]; then
  echo 'NAMESPACE_AUTHORING_REJECTED: exact HEAD mismatch' >&2
  exit 2
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo 'NAMESPACE_AUTHORING_REJECTED: dirty worktree' >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1 || [[ ! "$(node --version)" =~ ^v22\.[0-9]+\.[0-9]+$ ]]; then
  echo 'NAMESPACE_AUTHORING_REJECTED: Node 22 required' >&2
  exit 2
fi
for path in \
  contracts/conformance/namespace-guest-gates-v1.json \
  tools/materialize-namespace-guest-case.mjs \
  tools/compare-namespace-backend-corpus.mjs \
  tests/namespace-guest-gates-v1.test.mjs \
  tests/namespace-backend-source-identity.test.mjs; do
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "NAMESPACE_AUTHORING_REJECTED: missing or symlinked test input: $path" >&2
    exit 2
  fi
  stored="$(git rev-parse "HEAD:$path")"
  actual="$(git hash-object -- "$path")"
  if [[ "$stored" != "$actual" ]]; then
    echo "NAMESPACE_AUTHORING_REJECTED: input blob changed: $path" >&2
    exit 2
  fi
  printf 'NAMESPACE_SOURCE_BLOB path=%s git_blob_sha1=%s\n' "$path" "$stored"
done

printf 'NAMESPACE_AUTHORING_START head=%s tree=%s node=%s scope=SOURCE_ONLY\n' \
  "$actual_head" "$actual_tree" "$(node --version)"
test_report="$(mktemp "${TMPDIR:-/tmp}/ores-ns-authoring.XXXXXXXX")"
trap 'rm -f "$test_report"' EXIT
node --test --test-reporter=tap \
  tests/namespace-guest-gates-v1.test.mjs \
  tests/namespace-backend-source-identity.test.mjs | tee "$test_report"
# A green process can still contain skipped, cancelled or TODO tests.
# Lock the independently authored 13 + 5 source-only cases to real execution.
for expected_line in \
  '# tests 18' '# pass 18' '# fail 0' \
  '# cancelled 0' '# skipped 0' '# todo 0'; do
  if ! grep -Fxq "$expected_line" "$test_report"; then
    echo "NAMESPACE_AUTHORING_REJECTED: missing TAP summary: $expected_line" >&2
    exit 1
  fi
done
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo 'NAMESPACE_AUTHORING_REJECTED: test execution modified checkout' >&2
  exit 1
fi
printf 'NAMESPACE_AUTHORING_PASS head=%s tree=%s test_count=18 scope=NOT_COMPILER_OR_GUEST\n' \
  "$actual_head" "$actual_tree"
