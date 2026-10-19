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
