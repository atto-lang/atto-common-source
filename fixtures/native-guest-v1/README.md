# Native guest parity v1 — executable-source contract

**Status:** source contract and offline verifier only. No Oreslang compiler has been run by this PR. Passing the verifier's synthetic unit tests is **not** a native guest-AOT attestation.

This version starts the shared one-language/two-implementations track without renaming a host interpreter compiled by Native Image to "compiled Oreslang."

## Frozen source cases

| Fixture | Oracle | LLVM native AOT | Graal JVM guest | Graal application guest AOT |
| --- | --- | --- | --- | --- |
| scalar-main.ores | main() returns 42 | required test | required test | pending |
| owned-array-main.ores | Owned class with Array<int>, mutation, returns 42 | required test | pending | pending |
| private-array-negative.ores | Compile rejection: private class field, zero IR | required test | pending | pending |

"Required test" means a target acceptance obligation, **not that a test has passed**. Source fixture SHA-256 digests are stored in manifest.json and checked by the verifier.

The owned-array source matches the *currently exposed subset* of native source-to-LLVM class/array lowering. It does not demonstrate full borrow checking, deterministic failure/cancellation cleanup, general object lowering, cross-file imports or Result types. Those remain separate stages.

## Run the validator's offline unit tests

From the common-source checkout:

    python3 -m unittest discover -s tests -p 'test_native_guest_parity_gate.py' -v

## Capture real raw guest observations

Build the production compiler first. For LLVM, the source root must provide
src/main/cpp/oreslang/runtime/NativeIntArrayRegion.c and the actual LLVM compiler
binary must be built. With Clang available:

    python3 scripts/run_native_guest_v1.py \
      --profile llvm-native-aot \
      --compiler-source-root /absolute/path/to/oreslang-source.llvm \
      --compiler /absolute/path/to/oreslang-llvmc \
      --clang /absolute/path/to/clang \
      --report llvm-raw.json

For JVM guest execution (not application-specific native AOT), build the Java
Maven launcher first, including its Maven-resolved classpath:

    python3 scripts/run_native_guest_v1.py \
      --profile graal-jvm-guest \
      --compiler-source-root /absolute/path/to/oreslang-source.java \
      --java-probe /absolute/path/to/oreslang-source.java/contracts/v1/java_probe.py \
      --java-class-artifact /absolute/path/to/oreslang-source.java/target/classes/dev/oreslang/launcher/OresMain.class \
      --report graal-jvm-raw.json

The runner invokes actual compiler processes on SHA-pinned source files and,
for LLVM, links the generated IR with Clang and the real native array runtime.
It fingerprints generated IR and each linked binary before and after execution.
For a negative fixture, it requires a compiler failure, expected diagnostic
and **zero emitted IR**. The JVM profile is explicitly guest execution under
the real launcher; it cannot certify full guest-code AOT.

Both outputs are **raw process observations**, not complete attested CI records.
They intentionally omit run_id, job_id, runner_id and workflow conclusions.
Never fill those in from guesses; retrieve exact-head job/step and checkout
evidence from GitHub. The full record checker requires one compiler-artifact
fingerprint and, for every native-execution case, separately matching before/
after executable SHA-256 plus emitted IR SHA-256. Captured results still do
not prove complete garbage-collector reachability, allocation claims, or
deterministic cleanup on exception/cancellation paths.

An independently obtained compiler report can be checked with:

    python3 scripts/native_guest_parity_gate.py --report llvm-record.json
    python3 scripts/native_guest_parity_gate.py --report llvm-record.json --report graal-jvm-record.json

The record validator checks fixture identities, strict result shape, expected return/diagnostic values, mandatory cases, positive CI identifiers, execution-stage labels, and artifact-kind/fallback declarations. It rejects a missing required case, a pending case reported as complete, a zero-case profile, an interpreter fallback or a mismatched output. **It does not fetch or authenticate CI records.** A report must be produced by real production compilers executing the byte-exact fixture; never construct success records by hand. To claim an actual result, also independently verify the exact Git tree and pinned fixture blobs, workflow run/job/step identities, compiler and binary hashes, raw execution logs and native link provenance. Use the existing scripts/exact_source_gate.py for the exact-tree/workflow portion and inspect guest-to-machine-code proof separately. A self-reported artifact_kind or guest_lowering string cannot establish real AOT.

The "Graal native guest AOT" profile has **no required cases yet** and therefore cannot pass, even with a fabricated report. Native Image of the Truffle interpreter does not qualify. Any activation of Graal application-specific guest AOT requires a reviewed v2 contract and a real generated-code-to-binary proof.

## Next source-to-native vertical slices

1. LLVM: execute this v1 fixture set with the real compiler and Clang, collecting actual source/compile/linked-binary/exit evidence, not host-only unit tests.
2. Java/Graal: run the same exact scalar fixture via the production guest launcher; avoid asserting that this is application-specific guest AOT.
3. Resolve the canonical cross-module import syntax, nominal Result/Error types and ownership/borrow ABI. Add an **independent v2 fixture** importing another module, constructing an owned object and returning a typed Result. Do not mark its compiler stages complete until both frontends lower and execute it.
4. Add explicit normal/error/cancellation/actor retirement cleanup event observations and native resource accounting. Exit value 42 alone cannot prove exact-once drops.
5. Add suspended Tasks and actor-owned compiled invocations only after cancellation, physical completion and actor-private lifetime checks pass. Prove LLVM native code has no tracing-GC or interpreter fallback and Graal's native image includes compiled *guest* methods.

Related blockers: LLVM #341 (modules), #45 (ownership/continuations), #143 (effects/cleanup), #14 (actors), #651 (Tasks) and #593 (zero-GC release evidence); Java #1268 (guest allocations). These are not completed by this suite.
