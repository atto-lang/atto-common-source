#!/usr/bin/env bash
# Focused native-image Epsilon experimental host/JNI arena soak.
# DO NOT call this an AttoLang guest AOT, production sandbox, or steady-state proof.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
python3 - <<'PY'
import json, subprocess
m=json.load(open("ci/java-arena/source-provenance.json"))
for path,sha in m["source_blobs"].items():
    seen=subprocess.check_output(["git","hash-object",path],text=True).strip()
    if seen!=sha: raise SystemExit("SOURCE_GIT_BLOB_MISMATCH: "+path)
print("GRAAL_SOURCE_GIT_BLOBS_VERIFIED="+str(len(m["source_blobs"])))
print("GRAAL_SOURCE_PR_HEAD="+m["origin"]["head_sha"])
PY
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/native-image" ]]; then
  echo 'GRAAL_EPSILON_NOT_EXECUTED: actual GraalVM Native Image toolchain required' >&2
  exit 2
fi
"$JAVA_HOME/bin/native-image" --version
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/classes"
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
  -I "$JAVA_HOME/include" -I "$JAVA_HOME/include/linux" \
  src/main/c/oresarena.c -o "$tmp/liboresarena.so"
"$JAVA_HOME/bin/javac" -d "$tmp/classes" \
  src/main/java/dev/oreslang/runtime/ActorNativeArena.java \
  src/main/java/dev/oreslang/runtime/ActorLinearMemory.java \
  src/main/java/dev/oreslang/runtime/OresSymbol.java \
  src/main/java/dev/oreslang/runtime/NativeCarrierExecutor.java \
  src/test/java/dev/oreslang/runtime/ActorNativeArenaSoak.java
"$JAVA_HOME/bin/native-image" --no-fallback --gc=epsilon \
  -H:Name=atto-native-arena-epsilon -cp "$tmp/classes" \
  dev.oreslang.runtime.ActorNativeArenaSoak
test -s atto-native-arena-epsilon && test -x atto-native-arena-epsilon || {
  echo 'GRAAL_EPSILON_NOT_EXECUTED: no native executable' >&2; exit 1;
}
file atto-native-arena-epsilon | grep -E 'ELF|Mach-O' >/dev/null || {
  echo 'GRAAL_EPSILON_NOT_EXECUTED: artifact not a native OS binary' >&2; exit 1;
}
binary="$repo/atto-native-arena-epsilon"
mv "$binary" "$tmp/atto-native-arena-epsilon"
(
  unset JAVA_HOME CLASSPATH JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS
  "$tmp/atto-native-arena-epsilon" -Datto.max.rss.kib=262144 \
    "$tmp/liboresarena.so" > "$tmp/native-output" 2> "$tmp/native-stderr"
)
if [[ -s "$tmp/native-stderr" ]]; then
  echo 'GRAAL_EPSILON_NOT_EXECUTED: native guest emitted unexpected stderr' >&2
  cat "$tmp/native-stderr" >&2
  exit 1
fi
cat "$tmp/native-output"
grep -Fx 'ATTO_NATIVE_ARENA_SOAK=PASS' "$tmp/native-output"
grep -Fx 'actor_operations=102400' "$tmp/native-output"
grep -Fx 'actor_arena_restarts=128' "$tmp/native-output"
grep -Fx 'native_charge_after=0' "$tmp/native-output"
grep -Fx 'tenant_restarts=NOT_TESTED' "$tmp/native-output"
grep -Fx 'EVIDENCE_SCOPE=JNI_NATIVE_ARENA_HOST_ONLY_NO_ATTO_GUEST_OR_GRAAL_EPSILON_PROOF' "$tmp/native-output"
echo 'GRAAL_EPSILON_NATIVE_IMAGE_HOST_JNI_SOAK=PASSED'
echo 'EVIDENCE_SCOPE=REAL_EPSILON_NATIVE_IMAGE_HOST_ONLY_NO_ATTO_GUEST_OR_TENANT_PARITY'
