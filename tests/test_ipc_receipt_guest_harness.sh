#!/usr/bin/env sh
# Synthetic controls for the host harness only; NEVER compiler/guest parity.
set -eu
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
harness="$repo_root/scripts/run_ipc_guest_parity.sh"
export IPC_GOLDEN="$repo_root/tests/ipc_receipts_guest.expected"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat > "$tmp/java" <<'RUNNER'
#!/usr/bin/env sh
case "$1" in
  *ipc_receipts_reject.ores) echo 'synthetic compiler syntax error' >&2; exit 1 ;;
  *ipc_receipts_guest.ores) cat "$IPC_GOLDEN" ;;
  *) exit 2 ;;
esac
RUNNER
cp "$tmp/java" "$tmp/llvm"
printf '\n# distinct synthetic llvm wrapper; not a real compiler\n' >> "$tmp/llvm"
chmod +x "$tmp/java" "$tmp/llvm"
assert_refuse() {
  if sh "$harness" "$1" "$2" > "$tmp/check.out" 2> "$tmp/check.err"; then
    echo "FAIL: negative host-harness mutant passed: $3" >&2; exit 1
  fi
}
sh "$harness" "$tmp/java" "$tmp/llvm" > "$tmp/green.out"
grep -q '^GUEST_RECEIPT_REFERENCE_TEST_PASS$' "$tmp/green.out"
assert_refuse "$tmp/java" "$tmp/java" 'identical runners'

cat > "$tmp/alwaysgreen" <<'RUNNER'
#!/usr/bin/env sh
cat "$IPC_GOLDEN"
RUNNER
chmod +x "$tmp/alwaysgreen"
assert_refuse "$tmp/java" "$tmp/alwaysgreen" 'always-green fake compiler'

cat > "$tmp/silenterror" <<'RUNNER'
#!/usr/bin/env sh
case "$1" in
  *ipc_receipts_reject.ores) exit 1 ;;
  *) cat "$IPC_GOLDEN" ;;
esac
RUNNER
chmod +x "$tmp/silenterror"
assert_refuse "$tmp/java" "$tmp/silenterror" 'silent compiler negative'

cat > "$tmp/stderrpositive" <<'RUNNER'
#!/usr/bin/env sh
case "$1" in
  *ipc_receipts_reject.ores) echo 'synthetic error' >&2; exit 1 ;;
  *) echo 'unexpected positive warning' >&2; cat "$IPC_GOLDEN" ;;
esac
RUNNER
chmod +x "$tmp/stderrpositive"
assert_refuse "$tmp/java" "$tmp/stderrpositive" 'extra positive stderr'

cat > "$tmp/badexit" <<'RUNNER'
#!/usr/bin/env sh
case "$1" in
  *ipc_receipts_reject.ores) echo 'runner infrastructure failure' >&2; exit 125 ;;
  *) cat "$IPC_GOLDEN" ;;
esac
RUNNER
chmod +x "$tmp/badexit"
assert_refuse "$tmp/java" "$tmp/badexit" 'infrastructure failure as compiler rejection'

cat > "$tmp/oversized" <<'RUNNER'
#!/usr/bin/env sh
case "$1" in
  *ipc_receipts_reject.ores) head -c 4097 /dev/zero >&2; exit 1 ;;
  *) cat "$IPC_GOLDEN" ;;
esac
RUNNER
chmod +x "$tmp/oversized"
assert_refuse "$tmp/java" "$tmp/oversized" 'oversized error diagnostic'

echo 'IPC_SOURCE_FREE_HARNESS_SELFTEST_PASS scenarios=7'
echo 'NOT_COMPILER_PROOF'
